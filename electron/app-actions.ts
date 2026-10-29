import { archiveStreamCommand, finalizeArchiveStream, checkDataTarget, planData, clearExternal, type DeviceShell } from './app-data-backup.js'
import { createReadStream } from 'node:fs'
import { mkdtemp, realpath, rename, rm, writeFile, open } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { validateAppTarget } from './app-details-protocol.js'
import { appActionIds, batchActionIds, batchSkipReason, cleanupParts, cleanupLabels, type CleanupPart, type BatchActionRequest, type BatchActionItem, type AppActionId, type AppActionState, type AppActionTarget } from './app-actions-protocol.js'
import type { AndroidApp, AppsSnapshot } from './apps-protocol.js'
import type { ConnectionSnapshot } from './contracts.js'
import { checked, run, type Runner } from './process.js'
import { changePermission, type PermissionAccess } from './app-permissions.js'
import { validatePermissionChange, type PermissionChange } from './app-permissions-protocol.js'
import { ApkTransferSession, type ApkTransferInfo } from './apk-transfer.js'
import { packageActionIds, validatePackageOptions, type PackageAction, type PackageActionOptions } from './package-actions-protocol.js'
import { runPackageAction, runRestoreExisting, PackageActionError, type PackageActionAccess } from './package-actions.js'
import { launchApplication } from './app-launch.js'

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
export function validateBatchAction(value: BatchActionRequest) {
  validatePackageOptions(value?.options, value?.action)
  if (!value || typeof value.id !== 'string' || !value.id.length || value.id.length > 512 || /[\x00-\x1f]/.test(value.id) || !batchActionIds.includes(value.action) || !Array.isArray(value.packages) || !value.packages.length || value.packages.length > 10000 || new Set(value.packages).size !== value.packages.length) throw new Error('Invalid batch action selection.')
  if (value.action === 'clear-storage') {
    if (!Array.isArray(value.cleanup) || !value.cleanup.length || value.cleanup.length > 4 || new Set(value.cleanup).size !== value.cleanup.length || value.cleanup.some(p => !cleanupParts.includes(p))) throw new Error('Choose valid cleanup categories.')
  } else if (value.cleanup !== undefined) throw new Error('Cleanup categories require Clear storage.')
  value.packages.forEach(p => validateAppTarget(p, value.userId))
}
export function parseApkPaths(output: string): string[] {
  const lines = output.trim().split(/\r?\n/).filter(Boolean)
  if (!lines.length || lines.length > 512 || lines.some(line => !line.startsWith('package:'))) throw new Error('Android did not return the installed APK files for this profile.')
  const paths = lines.map(line => line.slice(8))
  if (paths.some(file => !file.startsWith('/') || !file.endsWith('.apk') || file.length > 4096 || /[\x00-\x1f]/.test(file) || file.split('/').includes('..')) || new Set(paths).size !== paths.length) throw new Error('Invalid APK paths returned by Android.')
  return paths
}
export function actionOutput(output: string) {
  if (/(?:^|\n)\s*(?:Error(?:\s+type\s+\d+)?[:\s]|Failure\b|Exception\b|SecurityException\b)|Permission Denial|java\.[\w.]+Exception|Status:\s*(?:timeout|error)/i.test(output)) throw new Error(output.slice(0, 1200))
  return output
}
interface ActionDialogs {
  confirmBatch?: (state: AppActionState) => Promise<boolean>
  confirm: (action: AppActionId, app: AndroidApp, deviceName: string, profileName: string, options?: PackageActionOptions) => Promise<boolean>
  exportFolder: () => Promise<string | null>
}
export class AppActionsService {
  state: AppActionState | null = null
  private controller?: AbortController
  private pending?: Promise<void | 'skipped'>
  private targetTransport?: string
  private targetSerial?: string
  private targetHardware?: string
  get busy() { return !!this.controller }
  async waitForPermission() { if (this.busy && this.state?.action === 'permission') await this.pending }
  constructor(
    private adb: () => string | null, private connection: () => ConnectionSnapshot,
    private apps: () => AppsSnapshot, private publish: (state: AppActionState) => void,
    private log: (text: string, tone: 'success' | 'warning' | 'info') => void,
    private dialogs: ActionDialogs, private refresh: (target: AppActionTarget) => Promise<void>,
    private runner: Runner = run,
    private permissions?: PermissionAccess,
    private apkTransfer: () => ApkTransferSession = () => new ApkTransferSession(false),
    private packageAccess?: PackageActionAccess,
  ) {}
  private update(patch: Partial<AppActionState>) { this.state = { ...this.state!, ...patch }; this.publish(this.state) }
  cancel() { if (this.busy && this.state?.batch) { this.update({ batch: { ...this.state.batch, stopRequested: true } }); return }; if (this.state?.action === 'export') this.controller?.abort() }
  shutdown() { this.controller?.abort(); return this.pending || Promise.resolve() }
  contextChanged() {
    if (!this.controller || !this.state) return
    const connection = this.connection(), apps = this.apps()
    const device = connection.devices.find(d => d.id === this.state!.id && d.status === 'connected')
    if (connection.activeDeviceId !== this.state.id || !device || device.serial !== this.targetSerial || device.transportId !== this.targetTransport || device.hardwareId !== this.targetHardware || apps.deviceId !== this.state.id || apps.userId !== this.state.userId) this.controller.abort()
  }
  execute(target: AppActionTarget, action: AppActionId, exportLayout?: 'apk' | 'apks', scanNames = false, options?: PackageActionOptions) {
    validatePackageOptions(options, action)
    if (!this.packageAccess && (options?.root || options?.method === 'api')) throw new Error('Package action helper is unavailable. No alternate method was attempted.')
    if (this.busy) return Promise.reject(new Error('Wait for the current application action.'))
    const task = this.perform(target, action, exportLayout, scanNames, undefined, options)
    this.pending = task
    void task.then(() => { if (this.pending === task) this.pending = undefined }, () => { if (this.pending === task) this.pending = undefined })
    return task
  }
  executePermission(request: PermissionChange) {
    validatePermissionChange(request)
    if (this.busy) return Promise.reject(new Error('Wait for the current application action.'))
    const task = this.perform(request, 'permission', undefined, false, request)
    this.pending = task
    void task.then(() => { if (this.pending === task) this.pending = undefined }, () => { if (this.pending === task) this.pending = undefined })
    return task
  }
  executeBatch(request: BatchActionRequest, retryParts?: Map<string, CleanupPart[]>) {
    if (this.busy) throw new Error('Wait for the current application action.')
    validateBatchAction(request)
    const snapshot = this.apps(), device = this.connection().devices.find(d => d.id === request.id && d.status === 'connected')
    if (!device || this.connection().activeDeviceId !== request.id || snapshot.status !== 'ready' || snapshot.deviceId !== request.id || snapshot.userId !== request.userId) throw new Error('Select the current connected profile.')
    const cleanup = request.cleanup ? cleanupParts.filter(p => request.cleanup!.includes(p) && !(p === 'cache' && request.cleanup!.includes('data'))) : undefined
    const items: BatchActionItem[] = request.packages.map(packageName => {
      const app = snapshot.apps.find(a => a.packageName === packageName && a.userId === request.userId)
      if (!app) throw new Error('A selected application is no longer in this profile. Review the selection.')
      const reason = batchSkipReason(request.action, app, snapshot.apps)
      return { packageName, label: app.label, uid: app.uid, versionCode: app.versionCode, system: app.system, status: reason ? 'skipped' : 'pending', message: reason || '', ...(cleanup ? { steps: (retryParts?.get(packageName) || cleanup).map(part => ({ part, status: 'pending' as const, message: '' })) } : {}) }
    })
    if (!items.some(i => i.status === 'pending')) throw new Error('This action is unavailable for all selected applications.')
    const controller = new AbortController(); this.controller = controller
    this.targetTransport = device.transportId; this.targetSerial = device.serial; this.targetHardware = device.hardwareId
    this.state = { operationId: randomUUID(), startedAt: new Date().toISOString(), id: request.id, userId: request.userId, packageName: '', action: request.action, options: request.options, status: 'running', message: 'Review the selected applications and confirm.', completed: 0, total: items.length, batch: { items, cleanup, stopRequested: false, deviceName: device.name, profileName: snapshot.profiles.find(p => p.id === request.userId)?.name || String(request.userId) } }
    this.publish(this.state)
    const current = () => { this.contextChanged(); controller.signal.throwIfAborted() }
    const publish = () => this.update({ completed: items.filter(i => !['pending', 'running'].includes(i.status)).length, batch: { ...this.state!.batch!, items: items.map(i => ({ ...i, steps: i.steps?.map(s => ({ ...s })) })) } })
    const task = (async () => {
      let failure = ''
      try {
        if (!await this.dialogs.confirmBatch?.(this.state!)) { items.forEach(i => { if (i.status === 'pending') { i.status = 'cancelled'; i.message = 'Cancelled before device access'; i.steps?.forEach(s => { s.status = 'cancelled'; s.message = i.message }) } }); publish(); this.update({ status: 'cancelled', message: 'Action cancelled. No applications were changed.' }); return }
        current()
        for (const item of items) {
          if (item.status === 'skipped') continue
          if (this.state!.batch!.stopRequested) break
          current()
          const app = this.apps().apps.find(a => a.packageName === item.packageName)
          if (!app || app.uid !== item.uid || app.versionCode !== item.versionCode) { item.status = 'skipped'; item.message = 'Application changed since confirmation. Review it again.'; publish(); continue }
          const reason = batchSkipReason(request.action, app, this.apps().apps)
          if (reason) { item.status = 'skipped'; item.message = reason; publish(); continue }
          item.status = 'running'; this.update({ packageName: item.packageName }); publish()
          const actions = item.steps?.map(step => ({ action: ('clear-' + step.part) as AppActionId, step })) || [{ action: request.action as AppActionId, step: undefined }]
          for (const { action, step } of actions) {
            if (step) { item.status = 'running'; step.status = 'running'; publish() }
            let uncertain = false, wrote = false, externalDeletionAttempted = false
            const child = new AppActionsService(this.adb, () => { current(); return this.connection() }, this.apps,
              s => this.update({ message: `${item.label}: ${s.message}` }), this.log, { confirm: async () => { current(); return true }, exportFolder: async () => null }, item.steps ? async () => {} : this.refresh,
              async (...args) => {
                current()
                const command = args[1].join(' ')
                const externalDeletion = (action === 'clear-obb' || action === 'clear-media') && command.includes('-exec rm -rf --')
                const mutation = externalDeletion || /'am' 'force-stop'|'pm' '(?:clear|enable|disable-user|uninstall|suspend|unsuspend)'|helper\.PackageActions '(?:clear-data|clear-cache|enable|disable|uninstall)'/.test(command)
                try {
                  if (mutation) wrote = true
                  if (externalDeletion) externalDeletionAttempted = true
                  const result = await this.runner(...args)
                  if (/device.*(?:offline|not found)|no devices|connection.*(?:closed|reset|lost)|protocol fault|transport.*(?:error|closed)|timed out/i.test(result.stdout + result.stderr)) { uncertain = wrote; this.update({ batch: { ...this.state!.batch!, stopRequested: true } }) }
                  current(); return result
                } catch (error) { uncertain = wrote; this.update({ batch: { ...this.state!.batch!, stopRequested: true } }); throw error }
              }, this.permissions, this.apkTransfer, this.packageAccess)
            const abort = () => { void child.shutdown() }; controller.signal.addEventListener('abort', abort, { once: true })
            try {
              const options = packageActionIds.includes(action as PackageAction) ? { ...request.options, ...(action === 'uninstall' ? {} : { keepData: undefined }) } : undefined
              await child.execute({ id: request.id, userId: request.userId, packageName: item.packageName }, action, undefined, false, options)
              item.status = child.state?.status === 'success' ? 'success' : 'error'; item.message = child.state?.message || 'Action failed.'
              // A directory cleanup can remove some files before failing, even with Permission denied.
              item.uncertain = child.state?.uncertain ?? (item.status === 'error' && (uncertain || externalDeletionAttempted || (wrote && !/Failure|Permission|SecurityException|not allowed|not supported|denied/i.test(item.message))))
              if (item.uncertain) this.update({ batch: { ...this.state!.batch!, stopRequested: true } })
            } catch (error) { item.status = 'error'; item.uncertain = wrote; item.message = String(error); this.update({ batch: { ...this.state!.batch!, stopRequested: true } }) }
            finally {
              if (step) { step.status = item.status === 'success' ? 'success' : 'error'; step.message = item.message; step.uncertain = item.uncertain }
              controller.signal.removeEventListener('abort', abort); await child.shutdown(); if (!item.steps) publish() }
            if (item.uncertain || controller.signal.aborted || (this.state!.batch!.stopRequested && item.status === 'error')) break
          }
          if (item.steps) {
            for (const step of item.steps) if (step.status === 'pending') { step.status = 'cancelled'; step.message = 'Not started. Queue stopped.' }
            item.status = item.steps.some(s => s.status === 'error') ? 'error' : item.steps.some(s => s.status === 'cancelled') ? 'cancelled' : 'success'
            item.uncertain = item.steps.some(s => s.uncertain)
            item.message = item.steps.map(s => cleanupLabels[s.part] + ': ' + s.message).join('\n')
            try { current(); await this.refresh({ id: request.id, userId: request.userId, packageName: item.packageName }) } catch { /* Keep results; context checks stop the queue. */ }
            publish()
          }
        }
      } catch (error) { failure = ` Queue stopped: ${error instanceof Error ? error.message : String(error)}` }
      finally {
        for (const item of items) if (item.status === 'pending') { item.status = 'cancelled'; item.message = 'Not started. Queue stopped.'; item.steps?.forEach(s => { s.status = 'cancelled'; s.message = item.message }) }
        publish()
        if (this.state!.status === 'running') {
          const count = (status: BatchActionItem['status']) => items.filter(i => i.status === status).length
          this.update({ status: count('error') ? 'error' : count('cancelled') ? 'cancelled' : 'success', message: `${count('success')} completed · ${count('skipped')} skipped · ${count('error')} failed · ${count('cancelled')} not started.${failure}` })
        }
        this.controller = undefined
      }
    })()
    this.pending = task; void task.finally(() => { if (this.pending === task) this.pending = undefined }); return task
  }
  retryBatch() {
    const s = this.state
    if (this.busy || !s?.batch || !batchActionIds.includes(s.action as BatchActionRequest['action'])) throw new Error('No batch action to retry.')
    const retry = s.batch.items.filter(i => ['error', 'cancelled'].includes(i.status) && !i.uncertain)
    return this.executeBatch({ id: s.id, userId: s.userId, action: s.action as BatchActionRequest['action'], cleanup: s.batch.cleanup, options: s.options, packages: retry.map(i => i.packageName) }, new Map(retry.map(i => [i.packageName, i.steps?.filter(step => ['error', 'cancelled'].includes(step.status) && !step.uncertain).map(step => step.part) || []])))
  }
  private async perform(target: AppActionTarget, action: AppActionId | 'permission', exportLayout?: 'apk' | 'apks', scanNames = false, permissionChange?: PermissionChange, options?: PackageActionOptions) {
    validateAppTarget(target.packageName, target.userId)
    if (action !== 'permission' && !appActionIds.includes(action)) throw new Error('Unknown application action.')
    if (this.busy) throw new Error('Wait for the current application action.')
    const snapshot = this.apps(), connection = this.connection()
    const device = connection.devices.find(d => d.id === target.id && d.status === 'connected')
    const application = (action === 'install-existing' ? snapshot.removedApps || [] : snapshot.apps).find(a => a.packageName === target.packageName && a.userId === target.userId)
    if (!device || connection.activeDeviceId !== target.id || snapshot.status !== 'ready' || snapshot.deviceId !== target.id || snapshot.userId !== target.userId || !application) throw new Error('Select an application from the current connected profile.')
    const adb = this.adb(); if (!adb) throw new Error('ADB is unavailable.')
    const transferSession = action === 'export' ? this.apkTransfer() : undefined
    const controller = new AbortController(); this.controller = controller
    this.targetTransport = device.transportId; this.targetSerial = device.serial; this.targetHardware = device.hardwareId
    this.state = { operationId: randomUUID(), startedAt: new Date().toISOString(), id: target.id, userId: target.userId, packageName: target.packageName, action, options, permission: permissionChange?.permission, status: 'running', message: 'Preparing action…' }; this.publish(this.state)
    const ensureCurrent = () => {
      this.contextChanged()
      if (controller.signal.aborted) throw new Error('Action cancelled or device/profile changed. Refresh Apps before retrying.')
    }
    const command = async (args: string[], timeout = 15000, structured = false) => {
      ensureCurrent()
      const result = await this.runner(adb, [...(device.transportId ? ['-t', device.transportId] : ['-s', device.serial]), ...args], timeout, undefined, undefined, { signal: controller.signal, maxOutputBytes: 2_000_000 })
      checked(result)
      ensureCurrent()
      const output = [result.stdout, result.stderr].filter(Boolean).join('\n')
      return structured ? output : actionOutput(output)
    }
    const shell = (args: string[], timeout?: number) => command(['shell', args.map(quote).join(' ')], timeout)
    const user = String(target.userId), pkg = target.packageName
    const getPaths = async () => parseApkPaths(await shell(['pm', 'path', '--user', user, pkg]))
    let temporary: string | undefined, destination: string | undefined
    let changed = false
    try {
      if (action === 'permission') {
        if (!this.permissions || !permissionChange) throw new Error('Permission management is unavailable.')
        this.update({ message: `Checking ${permissionChange.permission}…` })
        await changePermission(permissionChange, application, this.permissions, command)
        ensureCurrent()
        this.update({ status: 'success', message: `${permissionChange.permission}: ${permissionChange.granted ? 'Granted' : 'Denied'} · User ${user}.` })
        this.log(`${pkg} · ${this.state!.message}`, 'success')
        return
      }
      if (['install-existing', 'force-stop', 'suspend', 'disable', 'uninstall', 'clear-cache', 'clear-data', 'clear-obb', 'clear-media'].includes(action)) {
        this.update({ message: 'Waiting for confirmation…' })
        if (!await this.dialogs.confirm(action, application, device.name, snapshot.profiles.find(p => p.id === target.userId)?.name || `User ${user}`, options)) {
          this.update({ status: 'cancelled', message: 'Action cancelled.' }); return
        }
      }
      if (action === 'export') {
        this.update({ message: 'Choose an export folder…' })
        const chosen = await this.dialogs.exportFolder()
        if (!chosen) { this.update({ status: 'cancelled', message: 'Export cancelled.' }); return }
        ensureCurrent()
        destination = await realpath(chosen)
      }
      ensureCurrent()
      // Read current installation paths after dialogs; never use a cached path for an action.
      const paths = action === 'install-existing' ? [] : await getPaths()
      // Decide from the live installation before checksums or transfers, not cached split counts.
      if (action === 'export' && ((exportLayout === 'apk' && paths.length > 1) || (exportLayout === 'apks' && paths.length === 1))) {
        this.update({ status: 'cancelled', message: exportLayout === 'apk' ? 'Skipped: split application; APK mode saves single APK applications only.' : 'Skipped: single APK application; APKS mode saves split applications only.' })
        return 'skipped' as const
      }
      if (action === 'install-existing') {
        if (!this.packageAccess) throw new Error('Package verification helper is unavailable.')
        const message = await runRestoreExisting(application, this.packageAccess, (args, timeout) => command(args, timeout, true), () => { changed = true })
        this.update({ message })
      } else if (packageActionIds.includes(action as PackageAction) && this.packageAccess) {
        const root = options?.root === true
        if (root && !(snapshot.options.root && device.root?.status === 'available' && device.root.method)) throw new Error('Confirm root access for this phone in Connection and enable root in Apps before selecting this method.')
        const actionShell = (script: string, timeout?: number) => command(['shell', '-T', root && device.root?.method !== 'adb' ? `su -c ${quote(script)}` : script], timeout, script.startsWith('CLASSPATH=/data/local/tmp/android-manager/manager-server.jar app_process / dev.adbvault.helper.PackageActions '))
        if (root && !/^uid=0\b/.test(await actionShell('id'))) throw new Error('Root access was not granted to Shell.')
        if (action.startsWith('clear-')) await checkDataTarget(application, script => actionShell(script))
        const message = await runPackageAction(application, action as PackageAction, options || {}, this.packageAccess, command, actionShell)
        changed = true; this.update({ message, uncertain: false })
      } else if (action.startsWith('clear-')) {
        const deviceShell: DeviceShell = (cmd, root = false) => command(['shell', '-T', root && device.root?.method !== 'adb' ? `su -c ${quote(cmd)}` : cmd], 120000)
        // A global preference does not establish root access on a newly selected phone.
        const canUseRoot = snapshot.options.root === true && device.root?.status === 'available' && !!device.root.method
        await checkDataTarget(application, deviceShell)
        if (action === 'clear-cache' || action === 'clear-data') {
          // Never probe an unsupported cache flag by executing clear: some old builds ignore it.
          if (action === 'clear-cache') {
            const help = await shell(['pm', 'help'])
            if (!/clear\s+[^\r\n]*--cache-only/.test(help)) throw new Error('This Android version does not advertise safe per-app cache clearing. No data was deleted.')
          }
          const args = ['pm', 'clear', '--user', user, ...(action === 'clear-cache' ? ['--cache-only'] : []), pkg]
          const useRoot = action === 'clear-cache' && canUseRoot
          if (useRoot && !/^uid=0\b/.test(await deviceShell('id', true))) throw new Error('Root access was not granted to Shell.')
          const output = useRoot ? await deviceShell(args.map(quote).join(' '), true) : await shell(args, 120000)
          if (!/^Success\s*$/m.test(output)) throw new Error(output || 'Android did not confirm cleanup.')
        } else {
          const root = canUseRoot
          if (root && !/^uid=0\b/.test(await deviceShell('id', true))) throw new Error('Root access was not granted to Shell.')
          const plan = await planData(application, action === 'clear-obb' ? 'obb' : 'media', root, deviceShell)
          if (plan.roots.length) {
            await shell(['am', 'force-stop', '--user', user, pkg]); changed = true
            await clearExternal(plan, deviceShell)
          }
        }
        changed = true
        this.update({ message: `${({ 'clear-cache': 'Cache cleared', 'clear-data': 'App data cleared', 'clear-obb': 'OBB folder cleared', 'clear-media': 'Media folder cleared' } as Record<string, string>)[action]} for this profile.` })
      } else if (action === 'launch') {
        if (!application.enabled || application.suspended) throw new Error('Enable or resume this application before launching it.')
        this.update({ message: 'Finding the application’s launchable screen…' })
        await launchApplication(pkg, target.userId, shell)
        changed = true
        this.update({ message: `Android confirmed the launch in profile ${user}. Check the phone screen; unlock it or switch to that Android user if needed.` })
      } else if (action === 'settings') {
        await shell(['am', 'start', '-W', '--user', user, '-a', 'android.settings.APPLICATION_DETAILS_SETTINGS', '-d', `package:${pkg}`], 30000)
        this.update({ message: 'Application settings opened on the device.' })
      } else if (action === 'notifications' || action === 'open-links') {
        const notifications = action === 'notifications'
        const label = notifications ? 'Notification settings' : 'Open by default settings'
        const sdkText = (await shell(['getprop', 'ro.build.version.sdk'])).trim()
        const sdk = /^\d+$/.test(sdkText) ? Number(sdkText) : 0
        if (!sdk) throw new Error('Cannot determine the Android version. Use Open app settings instead.')
        if (sdk < (notifications ? 26 : 31)) throw new Error(`${label} requires Android ${notifications ? '8' : '12'} or later. Use Open app settings instead.`)
        const intent = notifications
          ? ['-a', 'android.settings.APP_NOTIFICATION_SETTINGS', '--es', 'android.provider.extra.APP_PACKAGE', pkg]
          : ['-a', 'android.settings.APP_OPEN_BY_DEFAULT_SETTINGS', '-d', `package:${pkg}`]
        this.update({ message: `Checking ${label.toLowerCase()} availability…` })
        const resolved = await shell(['cmd', 'package', 'resolve-activity', '--brief', '--user', user, ...intent])
        const component = resolved.split(/\r?\n/).map(line => line.trim()).find(line => /^[A-Za-z0-9_.$]+\/[A-Za-z0-9_.$]+$/.test(line))
        if (!component || component.endsWith('/com.android.internal.app.ResolverActivity')) throw new Error(`${label} is unavailable in this Android profile. Use Open app settings instead.`)
        await shell(['am', 'start', '-W', '--user', user, ...intent, '-n', component], 30000)
        this.update({ message: `${label} opened on the device.` })
      } else if (action === 'force-stop') {
        await shell(['am', 'force-stop', '--user', user, pkg]); changed = true
        this.update({ message: 'Force-stop completed for this profile.' })
      } else if (action === 'suspend' || action === 'unsuspend') {
        const help = await shell(['pm', 'help'])
        if (!new RegExp(`^\\s*${action}\\s+\\[--user\\s+[^\\]]+\\]`, 'm').test(help)) throw new Error('This Android version does not advertise Freeze/Unfreeze for a specific profile. No change was sent.')
        changed = true
        let output: string
        try { output = await shell(['pm', action, '--user', user, pkg]) }
        catch (error) {
          const detail = error instanceof Error ? error.message : String(error)
          if (/device.*(?:offline|not found)|no devices|no device with transport|connection.*(?:closed|reset|lost)|protocol fault|transport.*(?:error|closed)|timed out|cancelled|profile changed/i.test(detail)) throw new PackageActionError(detail, 'uncertain')
          throw error
        }
        const prefix = `Package ${pkg} new suspended state: `
        const states = output.split(/\r?\n/).map(line => line.trim()).filter(line => line.startsWith(prefix)).map(line => line.slice(prefix.length))
        if (states.length !== 1 || !['true', 'false'].includes(states[0])) throw new PackageActionError('Android did not confirm the frozen state for this application. Refresh applications before retrying.', 'uncertain')
        if (states[0] !== String(action === 'suspend')) throw new PackageActionError(action === 'suspend' ? 'Android did not freeze this application. It may be protected or restricted by policy.' : 'The application is still frozen. A device administrator or another app may also have suspended it.', 'denied')
        this.update({ message: action === 'suspend' ? 'Application frozen in this profile · Android suspension confirmed. App data is retained.' : 'Application unfrozen in this profile · Android suspension removed. Its enabled/disabled setting is unchanged.', uncertain: false })
      } else if (action === 'enable' || action === 'disable') {
        const output = await shell(['pm', action === 'enable' ? 'enable' : 'disable-user', '--user', user, pkg])
        if (!output.includes(`new state: ${action === 'enable' ? 'enabled' : 'disabled-user'}`)) throw new Error('Android did not confirm the new enabled state. Refresh Apps before retrying.')
        changed = true; this.update({ message: `Application ${action === 'enable' ? 'enabled' : 'disabled'} for this profile.` })
      } else if (action === 'uninstall') {
        const output = await shell(['pm', 'uninstall', ...(options?.keepData ? ['-k'] : []), '--user', user, pkg], 60000)
        if (!/^Success\s*$/m.test(output)) throw new Error(output || 'Android did not confirm removal. Refresh Apps before retrying.')
        changed = true; this.update({ message: 'Application removed from this profile.' })
      } else if (action === 'export') {
        this.update({ message: 'Preparing APK files…', completed: 0, total: paths.length })
        temporary = await mkdtemp(path.join(destination!, '.adb-vault-export-'))
        const files: { file: string; source: string; sha256: string; bytes: number; transfer: ApkTransferInfo; timingsMs: { deviceChecksum: number; transfer: number; localVerification: number } }[] = []
        for (const [index, remote] of paths.entries()) {
          ensureCurrent()
          let transferInfo = await transferSession!.prepare(device.method, command)
          ensureCurrent()
          const mainApk = paths.length === 1 || remote === application.sourceDir || remote.endsWith('/base.apk')
          const name = scanNames ? `${pkg}${mainApk ? '' : `.split-${String(index).padStart(3, '0')}`}.apk` : index === 0 ? 'base.apk' : `split-${String(index).padStart(3, '0')}.apk`
          const fileLabel = `${name} (${index + 1}/${paths.length})`
          this.update({ message: `Reading checksum on device: ${fileLabel}…` })
          const checksumStarted = performance.now()
          const digest = (await shell(['sha256sum', remote], 120000)).match(/^([a-f0-9]{64})\s/i)?.[1]?.toLowerCase()
          const deviceChecksum = Math.round(performance.now() - checksumStarted)
          if (!digest) throw new Error('Cannot verify APK integrity: Android did not return a SHA-256 checksum.')
          const local = path.join(temporary, name)
          this.update({ message: `Copying to computer${transferInfo.compression === 'zstd' ? ' (Zstd)' : ''}: ${fileLabel}…` })
          const transferStarted = performance.now()
          try {
            try { await command(['pull', ...(transferInfo.compression === 'zstd' ? ['-z', 'zstd'] : []), remote, local], 300000) }
            catch (error) {
              const fallback = transferSession!.unsupported(error)
              if (!fallback) throw error
              ensureCurrent(); await rm(local, { force: true })
              transferInfo = fallback
              this.update({ message: `Zstd unavailable. Copying normally: ${fileLabel}…` })
              await command(['pull', remote, local], 300000)
            }
          }
          catch (error) {
            // Some vendor APKs are readable through shell but denied to ADB sync.
            // Keep the same transport, user and integrity checks.
            const detail = error instanceof Error ? error.message : String(error)
            const remoteDenied = /^adb: error: (?:failed to (?:stat|open) remote object '[^\r\n]+'|failed to copy '[^\r\n]+' to '[^\r\n]+': remote open failed): Permission denied\s*$/i.test(detail)
            if (!remoteDenied) throw error
            ensureCurrent()
            await rm(local, { force: true })
            this.update({ message: `Copying through Android shell: ${fileLabel}…` })
            const token = randomUUID()
            const result = await this.runner(adb, [...(device.transportId ? ['-t', device.transportId] : ['-s', device.serial]), 'exec-out', archiveStreamCommand(`cat -- ${quote(remote)}`, token)], 300000, undefined, undefined, { signal: controller.signal, stdoutFile: local })
            checked(result); ensureCurrent()
            if (result.stderr.trim()) throw new Error('APK shell copy was not complete: ' + result.stderr.slice(0, 1000))
            await finalizeArchiveStream(local, token)
            transferInfo = { method: 'exec-out', compression: 'none', fallbackReason: 'APK readable through Android shell but denied to ADB pull.' }
          }
          const transfer = Math.round(performance.now() - transferStarted)
          this.update({ message: `Verifying copied APK: ${fileLabel}…` })
          const verificationStarted = performance.now()
          const handle = await open(local, 'r'); let bytes = 0
          try {
            bytes = (await handle.stat()).size
            const magic = Buffer.alloc(4); await handle.read(magic, 0, 4, 0)
            if (magic.toString('hex') !== '504b0304') throw new Error('Exported file is not an APK archive.')
          } finally { await handle.close() }
          const hash = createHash('sha256')
          for await (const chunk of createReadStream(local, { signal: controller.signal })) hash.update(chunk)
          if (hash.digest('hex') !== digest) throw new Error('APK verification failed. The package may have changed during export.')
          files.push({ file: name, source: remote, sha256: digest, bytes, transfer: transferInfo, timingsMs: { deviceChecksum, transfer, localVerification: Math.round(performance.now() - verificationStarted) } })
          this.update({ completed: index + 1 })
        }
        this.update({ message: 'Checking that the installed APK set has not changed…' })
        if (JSON.stringify(paths) !== JSON.stringify(await getPaths())) throw new Error('The installed APK set changed during export. Refresh Apps and try again.')
        await writeFile(path.join(temporary, 'manifest.json'), JSON.stringify({ format: 'adb-vault-apk-export', formatVersion: 1, packageName: pkg, userId: target.userId, exportedAt: new Date().toISOString(), files, includesApplicationData: false }, null, 2))
        ensureCurrent()
        const output = path.resolve(destination!, `${pkg}-user${user}-${randomUUID().slice(0, 8)}`)
        if (path.dirname(output) !== destination) throw new Error('Invalid export destination.')
        await rename(temporary, output); temporary = undefined
        this.update({ exportPath: output, message: `Exported ${files.length} verified APK ${files.length === 1 ? 'file' : 'files'}.` })
      }
      if (changed) {
        const result = this.state!.message
        this.update({ message: `${result} Updating application state…` })
        try { await this.refresh(target); this.update({ message: result }) }
        catch { this.update({ message: `${result} The list could not be refreshed; use Refresh applications.` }) }
      }
      this.update({ status: 'success' })
      this.log(`${pkg} · User ${user}: ${this.state!.message}`, 'success')
    } catch (error) {
      if (changed && !controller.signal.aborted) { try { await this.refresh(target) } catch { /* Preserve the original failure. */ } }
      const cancelled = controller.signal.aborted && action === 'export'
      const detail = error instanceof Error ? error.message : String(error)
      const transportFailure = /device.*(?:offline|not found)|no devices|no device with transport|connection.*(?:closed|reset|lost)|protocol fault|transport.*(?:error|closed)|timed out/i.test(detail)
      const message = cancelled ? 'Export cancelled. No incomplete export was kept.' : `${detail}${action.startsWith('clear-') && changed ? ' Cleanup may be partial; already deleted files cannot be recovered by retrying.' : action !== 'export' && transportFailure ? ' Check the app state before repeating the action; the connection did not confirm the result.' : ''}`
      this.update({ status: cancelled ? 'cancelled' : 'error', ...(error instanceof PackageActionError ? { uncertain: error.outcome === 'uncertain' } : {}), message: action === 'permission' ? `${permissionChange?.permission}: ${message}` : message })
      this.log(`${pkg} · User ${user}: ${message}`, cancelled ? 'info' : 'warning')
    } finally {
      if (temporary && destination && path.dirname(path.resolve(temporary)) === destination && path.basename(temporary).startsWith('.adb-vault-export-')) {
        try { await rm(temporary, { recursive: true, force: true }) }
        catch { this.update({ status: 'error', message: `Could not remove incomplete export: ${temporary}` }) }
      }
      this.controller = undefined
    }
  }
}
