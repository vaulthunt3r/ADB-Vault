import { dialog } from "./localized-dialog.js"
import { AppNotes } from './app-notes.js'
import { validateAppNoteDraft, validNoteId, validNoteDate, type AppNoteDraft, type AppNoteOrigin } from './app-notes-protocol.js'
import { FileClipboardService } from './file-clipboard.js'
import { ApkInspectorService } from './apk-inspector.js'
import { compareApks, validateInspectorRequest } from './apk-inspector-protocol.js'
import { Confirmations } from './confirmations.js'
import { singleActionConfirmation, batchActionConfirmation, restoreConfirmation } from './app-confirmations.js'
import { PhoneNetworkService, validateNetworkTarget, validateTraceAddress } from './phone-network.js'
import { GeoIpService } from './geoip.js'
import { AdbConsoleService } from './adb-console.js'
import { PhoneToolsService } from './phone-tools.js'
import { validatePhoneToolsRequest } from './phone-tools-protocol.js'
import { validateConsoleRun } from './adb-console-protocol.js'
import { AndroidDiagnosticsService } from './android-diagnostics.js'
import { FilePreviewService } from './file-preview.js'
import { NetworkDiscovery } from './file-network-discovery.js'
import { NetworkFolders } from './file-network.js'
import { networkPath } from './file-locations.js'
import { FileSearchService, validateSearchQuery } from './file-search.js'
import { defaultSearchQuery } from './file-search-protocol.js'
import { FileIO, FilesService, validateFilePlan, validateLocation } from './files.js'
import { openManagedFile, fileThumbnail } from './files-desktop.js'
import { prepareFileInstallSource, validateFileInstallSelection } from './file-install.js'
import { AppRestoreService, validateRestoreBatch } from './app-restore.js'
import { MonitorService } from './monitor.js'
import { validateDevicePower } from './device-power.js'
import { FastbootService } from './fastboot.js'
import { validateFastbootMode, validateFastbootTarget } from './fastboot-protocol.js'
import { validateScreenLaunch, cameraCommands, validateCameraUpdate } from './screen-protocol.js'
import { DeviceScreenService, screenActions } from './device-screen.js'
import { safeWebUrl } from './web-services.js'
import { readFile, writeFile, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { monitorTabs } from './monitor-protocol.js'
import { BackupCatalog } from './backup-catalog.js'
import type { AppsSnapshot } from './apps-protocol.js'
import { validatePackageOptions, evidenceKey, type PackageActionEvidence } from './package-actions-protocol.js'
import { AppActionsService, validateBatchAction } from './app-actions.js'
import { ExportDestination } from './export-destination.js'
import { AppBackupService, validateBackupRequest } from './app-backup.js'
import { appActionIds } from './app-actions-protocol.js'
import { AdbLifecycle } from './adb-lifecycle.js'
import { DatabaseService } from './databases.js'
import { isDatabaseId, databaseIds } from './database-protocol.js'
import { BrowserWindow, shell } from 'electron'
import type { BackendEvent, BackendReply, BackendRequest, BackendSnapshot, ComponentId } from './contracts.js'
import { Storage } from './storage.js'
import { notificationSettings, validateNotificationSettings } from './notifications-protocol.js'
import { ApkTransferSession } from './apk-transfer.js'
import { ComponentsService } from './components.js'
import { ConnectionService } from './connections.js'
import { installationTargets } from './catalog.js'
import { AppsService } from './apps.js'
import { AdbDiagnosticsService } from './adb-diagnostics.js'
import { validateAppTarget } from './app-details-protocol.js'
import { validatePermissionChange } from './app-permissions-protocol.js'
import { FailureDiagnosticsService } from './failure-diagnostics.js'
import { collectExitOperations, requestExitOperation, exitOperationLabels, type ExitOperation } from './exit-operations.js'
import { OperationHistory } from './operation-history.js'
export function validateRequest(input: unknown): BackendRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid request.')
  const r = input as Record<string, unknown>
  const text = (key: string, max = 1024) => { if (typeof r[key] !== 'string' || !(r[key] as string).length || (r[key] as string).length > max || /[\x00-\x1f]/.test(r[key] as string)) throw new Error(`Invalid ${key}.`) }
  const component = () => { if (!['adb', 'fastboot', 'driver', 'runtime', 'scrcpy', 'geoip', ...databaseIds].includes(String(r.id))) throw new Error('Unknown component.') }
  switch (r.type) {
    case 'apps.notesSave': { const note = r.note as AppNoteDraft; validateAppNoteDraft(note); if (note.target) { validateAppTarget(note.target.packageName, note.target.userId); if (typeof note.target.id !== 'string' || !note.target.id || note.target.id.length > 512 || note.target.packageName !== note.packageName) throw new Error('Invalid record target.'); } break }
    case 'apps.notesDelete': if (!validNoteId(r.id) || !validNoteDate(r.expectedUpdatedAt)) throw new Error('Invalid personal record.'); break
    case 'apps.notesImport': case 'apps.notesExport': break
    case 'inspector.open': case 'inspector.clear': case 'inspector.cancel': case 'inspector.swap': case 'inspector.export': validateInspectorRequest(r); break
    case 'confirmation.answer': text('id', 36); if (typeof r.accepted !== 'boolean') throw new Error('Invalid confirmation answer.'); break
    case 'console.run': validateConsoleRun(r); break
    case 'console.stop': text('id', 36); break
    case 'console.clear': break
    case 'phoneTools.read': case 'phoneTools.clipboard.read': case 'phoneTools.clipboard.write':
    case 'phoneTools.export': case 'phoneTools.cancel': case 'phoneTools.reveal': case 'phoneTools.clear': validatePhoneToolsRequest(r); break
    case 'history.list': case 'history.clear': break
    case 'history.read': text('sessionId', 36); if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(String(r.sessionId))) throw new Error('Invalid history session.'); break
    case 'network.connections': case 'network.trace': validateNetworkTarget(r.target); text('requestId', 64); if (r.type === 'network.trace') validateTraceAddress(r.address); break
    case 'network.cancel': text('requestId', 64); break
    case 'androidDiagnostics.start': {
      if (!['logcat', 'bugreport', 'battery'].includes(String(r.kind))) throw new Error('Unsupported Android diagnostic.')
      const t = r.target as Record<string, unknown> | undefined
      if (!t || typeof t !== 'object' || ['id', 'serial'].some(k => typeof t[k] !== 'string' || !(t[k] as string).length || (t[k] as string).length > 512 || /[\x00-\x1f]/.test(t[k] as string))) throw new Error('Invalid diagnostic device.')
      if (t.transportId !== undefined && (typeof t.transportId !== 'string' || !/^\d+$/.test(t.transportId))) throw new Error('Invalid diagnostic transport.')
      if (r.buffer !== undefined && !['default', 'crash'].includes(String(r.buffer))) throw new Error('Invalid log buffer.')
      break
    }
    case 'androidDiagnostics.cancel': case 'androidDiagnostics.reveal': text('jobId', 36); break
    case 'androidDiagnostics.exportLog': text('capturedAt', 40); break
    case 'diagnostics.read': case 'diagnostics.export': text('id', 36); if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(String(r.id))) throw new Error('Invalid diagnostic report ID.'); break
    case 'files.search': validateLocation(r.location); validateSearchQuery(r.query); break
    case 'files.search.cancel': text('id', 64); break
    case 'files.index.info': case 'files.index.build': case 'files.index.delete': validateLocation(r.location); break
    case 'files.clipboard.write': {
      const selection = r.selection as import('./files-protocol.js').FileInstallSelection
      if (!selection || typeof selection !== 'object') throw new Error('Invalid clipboard selection.')
      validateFilePlan({ action: 'copy', source: selection.source, destination: selection.source, items: selection.items, conflict: 'ask', confirmed: true })
      if (!['copy', 'move'].includes(String(r.mode))) throw new Error('Invalid clipboard action.')
      break
    }
    case 'files.clipboard.read': break
    case 'files.clipboard.paste': text('token', 64); validateLocation(r.destination); if (r.confirmed !== true) throw new Error('Confirm the file transfer.'); break
    case 'files.list': validateLocation(r.location, true); if (r.recursive !== undefined && typeof r.recursive !== 'boolean') throw new Error('Invalid search mode.'); if (r.pattern !== undefined) text('pattern', 200); break
    case 'files.properties': validateLocation(r.location); if (r.calculate !== undefined && typeof r.calculate !== 'boolean') throw new Error('Invalid size option.'); break
    case 'files.storages': if (validateLocation(r.location).kind !== 'device') throw new Error('Choose a phone.'); break
    case 'files.open': validateLocation(r.location); if (r.withApp !== undefined && typeof r.withApp !== 'boolean') throw new Error('Invalid opening option.'); break
    case 'files.preview': validateLocation(r.location); text('fingerprint', 1000); text('requestId', 64); break
    case 'files.thumbnail': validateLocation(r.location); text('fingerprint', 1000); text('requestId', 64); break
    case 'files.preview.close': case 'files.thumbnail.cancel': text('requestId', 64); break
    case 'files.chooseFolder': break
    case 'files.network.scan': case 'files.network.scan.cancel': text('requestId', 64); break
    case 'files.network.connect': text('address', 4096); networkPath(r.address as string); if (typeof r.prompt !== 'boolean') throw new Error('Invalid network sign-in option.'); break
    case 'files.enqueue': validateFilePlan(r.plan); break
    case 'files.control': text('id', 64); if (!['cancel', 'pause', 'resume', 'retry', 'undo'].includes(String(r.action))) throw new Error('Invalid task action.'); break
    case 'files.resolve': text('id', 64); if (!['skip', 'keep-both', 'replace', 'merge'].includes(String(r.choice)) || typeof r.all !== 'boolean') throw new Error('Invalid conflict resolution.'); break
    case 'connection.fastboot.scan': break
    case 'connection.fastboot.inspect': validateFastbootTarget(r.serial, r.token); break
    case 'connection.fastboot.reboot': validateFastbootTarget(r.serial, r.token); validateFastbootMode(r.mode, r.confirmed); break
    case 'apps.permission': validatePermissionChange(r as unknown as import('./app-permissions-protocol.js').PermissionChange); break
    case 'web.open': safeWebUrl(r.url); break
    case 'apps.prepareScan': text('id', 512); validateAppTarget(r.packageName as string, r.userId as number); safeWebUrl(r.url); break
    case 'monitor.read': text('id', 512); if (!monitorTabs.includes(r.tab as typeof monitorTabs[number])) throw new Error('Invalid monitor tab.'); break
    case 'apps.batchAction': validateBatchAction(r.plan as import('./app-actions-protocol.js').BatchActionRequest); break
    case 'apps.retryBatchAction': break
    case 'apps.installOpen': text('id', 512); validateAppTarget('install', r.userId as number); if (r.files !== undefined) validateFileInstallSelection(r.files); break
    case 'apps.restoreOpen': text('id', 512); validateAppTarget('restore', r.userId as number); break
    case 'apps.restorePrepare': validateAppTarget(r.packageName as string, 0); break
    case 'apps.restoreInstall': text('token', 64); break
    case 'apps.restoreFiles': text('token', 64); if (!Array.isArray(r.components) || !r.components.length || r.components.length > 4 || new Set(r.components).size !== r.components.length || r.components.some(c => !['data', 'cache', 'obb', 'media'].includes(String(c)))) throw new Error('Invalid restore components.'); break
    case 'apps.restoreCancel': break
    case 'apps.restoreBatch': validateRestoreBatch(r.plan as import('./app-restore-protocol.js').RestoreBatchRequest); break
    case 'apps.restoreRetry': break
    case 'apps.backup': case 'apps.savePreset': if (!r.selection || typeof r.selection !== 'object') throw new Error('Missing selection.'); validateBackupRequest(r.selection as import('./app-backup-protocol.js').BackupRequest, r.type === 'apps.savePreset'); break
    case 'apps.loadPreset': text('id', 512); validateAppTarget('preset', r.userId as number); break
    case 'apps.refreshBackups': case 'apps.cancelBackup': case 'apps.openBackup': break
    case 'apps.revealBackup': text('file', 4096); break
    case 'apps.action': validatePackageOptions(r.options as import('./package-actions-protocol.js').PackageActionOptions, String(r.action)); text('id', 512); validateAppTarget(r.packageName as string, r.userId as number); if (!appActionIds.includes(r.action as typeof appActionIds[number])) throw new Error('Invalid app action.'); break
    case 'apps.cancelBadges': case 'apps.cancelAction': case 'apps.openExport': case 'snapshot': case 'apps.cancel': case 'components.detect': case 'components.installAll': case 'components.adbDiagnostics': case 'connection.scan': case 'connection.qr': case 'connection.cancelQr': case 'connection.find': break
    case 'connection.confirmReconnect': text('token', 64); break
    case 'components.action': component(); if (!['detect', 'install', 'repair'].includes(String(r.action))) throw new Error('Invalid component action.'); break
    case 'components.locate': component(); text('folder', 4096); break
    case 'components.open': case 'components.source': component(); break
    case 'connection.connect': text('host', 100); text('port', 5); break
    case 'connection.pair': text('host', 100); text('port', 5); text('code', 6); break
    case 'settings.stopAdbOnExit': if (typeof r.enabled !== 'boolean') throw new Error('Invalid ADB exit setting.'); break
    case 'settings.notifications': validateNotificationSettings(r.settings); break
    case 'notifications.test': break
    case 'settings.apkZstd': if (typeof r.enabled !== 'boolean') throw new Error('Invalid APK transfer setting.'); break
    case 'settings.exportMode': if (r.mode !== 'ask' && r.mode !== 'fixed') throw new Error('Invalid export destination mode.'); break
    case 'settings.exportFolder': break
    case 'apps.loadingMode': if (r.mode !== 'selected' && r.mode !== 'preload') throw new Error('Invalid Apps loading mode.'); break
    case 'apps.scan': case 'apps.details': text('id', 512); validateAppTarget(r.packageName as string, r.userId as number); break
    case 'apps.options': if (!r.options || typeof r.options !== 'object' || !['icons', 'early', 'storage'].every(key => typeof (r.options as Record<string, unknown>)[key] === 'boolean') || ('root' in r.options && typeof r.options.root !== 'boolean')) throw new Error('Invalid Apps options.'); break
    case 'apps.badges': case 'apps.selectProfile': if (r.userId === undefined) throw new Error('Missing Android profile ID.');
    case 'apps.refresh': text('id', 512); if (r.userId !== undefined && (!Number.isInteger(r.userId) || Number(r.userId) < 0 || Number(r.userId) > 99999)) throw new Error('Invalid Android profile ID.'); break
    case 'connection.screenCapabilities': break
    case 'connection.cameraModes': case 'connection.screenApplications': text('id', 512); text('serial', 512); if (r.transportId !== undefined && (typeof r.transportId !== 'string' || !/^\d+$/.test(r.transportId))) throw new Error('Invalid device transport.'); break
    case 'connection.screenStop': case 'connection.cameraPanel': case 'connection.touchControls': text('sessionId', 64); break
    case 'connection.screenOnTop': text('sessionId', 64); if (typeof r.enabled !== 'boolean') throw new Error('Invalid window pin setting.'); break
    case 'connection.cameraControl': text('sessionId', 64); if (!cameraCommands.includes(r.command as typeof cameraCommands[number])) throw new Error('Unsupported live camera command.'); break
    case 'connection.cameraZoom': text('sessionId', 64); if (typeof r.value !== 'number' || !Number.isFinite(r.value) || r.value <= 0) throw new Error('Invalid camera zoom.'); break
    case 'connection.cameraUpdate': text('sessionId', 64); validateCameraUpdate(r.update); if (r.confirmedSplit !== undefined && typeof r.confirmedSplit !== 'boolean') throw new Error('Invalid recording confirmation.'); break
    case 'connection.screen': if (r.options !== undefined) { if (r.action !== 'open') throw new Error('Screen launch settings require Open.'); validateScreenLaunch(r.options) }; text('id', 512); text('serial', 512); if (r.transportId !== undefined && (typeof r.transportId !== 'string' || !/^\d+$/.test(r.transportId))) throw new Error('Invalid device transport.'); if (!screenActions.includes(r.action as typeof screenActions[number])) throw new Error('Unsupported screen action.'); break
    case 'connection.power': text('id', 512); text('serial', 512); if (r.transportId !== undefined && (typeof r.transportId !== 'string' || !/^\d+$/.test(r.transportId))) throw new Error('Invalid device transport.'); validateDevicePower(r.mode, r.confirmed); break
    case 'connection.root': text('id', 512); if (r.requestAccess !== undefined && typeof r.requestAccess !== 'boolean') throw new Error('Invalid root check option.'); break
    case 'connection.info': case 'connection.select': case 'connection.disconnect': case 'connection.reconnect': case 'connection.forget': text('id', 512); break
    default: throw new Error('Unsupported request.')
  }
  return input as BackendRequest
}
export class Backend {
  history: OperationHistory
  fileSearch: FileSearchService
  private networkFolders = new NetworkFolders()
  private networkDiscovery = new NetworkDiscovery()
  files: FilesService
  fileClipboard: FileClipboardService
  adbConsole: AdbConsoleService
  phoneTools: PhoneToolsService
  androidDiagnostics: AndroidDiagnosticsService
  monitor: MonitorService
  phoneNetwork: PhoneNetworkService
  geoip: GeoIpService
  components: ComponentsService
  databases: DatabaseService
  connection: ConnectionService
  apps: AppsService
  appActions: AppActionsService
  restores: AppRestoreService
  backups: AppBackupService
  diagnostics: AdbDiagnosticsService
  failureDiagnostics: FailureDiagnosticsService
  screens: DeviceScreenService
  fastboot: FastbootService
  exportDestination: ExportDestination
  private backupCatalogue: BackupCatalog
  private backupTimer?: ReturnType<typeof setInterval>
  private lifecycle = new AdbLifecycle()
  private installPending = false
  private componentRequest = false
  closing = false
  readonly appNotes: AppNotes
  readonly confirmations: Confirmations
  private shutdownPromise?: Promise<void>
  private initialization?: Promise<void>
  private requests = new Map<symbol, { operation: ExitOperation | null; done: Promise<void> }>()
  readonly previews: FilePreviewService
  readonly inspector: ApkInspectorService
  private thumbnailRequests = new Map<string, { controller: AbortController; done: Promise<string | undefined> }>()
  constructor(private storage: Storage, private emit: (event: BackendEvent) => void, helperDirectory: string, private testNotification?: () => Promise<void>) {
    this.confirmations = new Confirmations(state => emit({ type: 'confirmation', state }))
    this.history = new OperationHistory(storage.root, overview => emit({ type: 'history', overview }))
    this.emit = event => { this.history.capture(event, { connection: this.connection?.state, apps: this.apps?.state }); emit(event) }
    this.appNotes = new AppNotes(storage.root, state => this.emit({ type: 'appNotes', state }))
    this.backupCatalogue = new BackupCatalog(storage.root)
    const publish = (event: BackendEvent) => this.emit(event.type === 'apps' ? { ...event, apps: this.withBackups(event.apps) } : event)
    const runner = this.lifecycle.runner
    this.geoip = new GeoIpService(storage.root, () => publish({ type: 'components', components: [...this.components.records, ...this.databases.records, this.geoip.record] }))
    this.phoneNetwork = new PhoneNetworkService(() => this.components.adbPath(), () => this.connection.state, this.geoip, runner)
    this.failureDiagnostics = new FailureDiagnosticsService(storage.root, () => this.connection.state,
      id => this.apps.state.profiles.find(p => p.id === id)?.name || `Profile ${id}`, () => storage.data.apkZstd === true,
      diagnostic => publish({ type: 'failureDiagnostic', diagnostic }))
    this.files = new FilesService(new FileIO(() => this.components.adbPath(), () => this.connection.state, runner), publish, () => this.phoneTools?.phoneBusy || this.adbConsole?.busy || this.androidDiagnostics?.busy || this.fileSearch?.phoneBusy || this.screens?.busy || this.fastboot?.state.busy || this.connection?.powerBusy || this.appActions?.busy || this.backups?.busy || this.restores?.busy || this.apps?.readingBadges || this.apps?.state.status === 'loading' || this.apps?.state.backgroundUserId !== null && this.apps?.state.backgroundUserId !== undefined, () => this.history.flush())
    this.previews = new FilePreviewService(this.files.io)
    this.fileClipboard = new FileClipboardService(this.files, publish)
    this.fileSearch = new FileSearchService(this.files.io, path.join(storage.root, 'file-indexes'), publish, () => !!this.phoneTools?.phoneBusy || !!this.adbConsole?.busy || !!this.androidDiagnostics?.busy || this.files.deviceBusy || !!this.screens?.busy || !!this.fastboot?.state.busy || !!this.connection?.powerBusy || !!this.appActions?.busy || !!this.backups?.busy || !!this.restores?.busy || !!this.apps?.readingBadges || this.apps?.state.status === 'loading' || this.apps?.state.backgroundUserId != null)
    this.monitor = new MonitorService(() => this.components.adbPath(), () => this.connection.state, runner)
    this.exportDestination = new ExportDestination(storage, async current => {
      const result = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0], { title: 'Choose export destination', ...(current ? { defaultPath: current } : {}), properties: ['openDirectory', 'createDirectory'] })
      return result.canceled ? null : result.filePaths[0] || null
    })
    this.databases = new DatabaseService(storage.root, () => publish({ type: 'components', components: [...this.components.records, ...this.databases.records, this.geoip.record] }))
    this.inspector = new ApkInspectorService(storage.root, () => this.databases.data, state => publish({ type: 'apkInspector', state }))
    this.components = new ComponentsService(storage, event => publish(event.type === 'activity' ? { ...event, source: 'components' } : event.type === 'components' ? { ...event, components: [...event.components, ...this.databases.records, this.geoip.record] } : event), runner)
    this.connection = new ConnectionService(storage, () => this.components.adbPath(), event => { if (event.type === 'connection' && !this.closing) { this.phoneTools?.contextChanged(); this.adbConsole?.contextChanged(); this.phoneNetwork?.contextChanged(); this.androidDiagnostics?.contextChanged(); this.failureDiagnostics.connectionChanged(); this.files.connectionChanged(event.connection); this.fileSearch.connectionChanged(); this.apps.connectionChanged(event.connection); this.appActions?.contextChanged(); this.backups?.contextChanged(); this.restores?.contextChanged() } publish(event) }, runner)
    this.apps = new AppsService(helperDirectory, () => this.components.adbPath(), () => this.connection.state, event => publish(event.type === 'activity' ? { ...event, source: 'apps' } : event), runner, () => this.databases.data)
    this.androidDiagnostics = new AndroidDiagnosticsService(() => this.components.adbPath(), () => this.connection.state, publish, async (name, extension) => {
      const pick = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0], { title: extension === 'zip' ? 'Save Android bug report' : 'Save Android log', defaultPath: name, filters: [{ name: extension === 'zip' ? 'ZIP report' : 'Text log', extensions: [extension] }], properties: ['showOverwriteConfirmation'] })
      return pick.canceled ? null : pick.filePath || null
    }, runner)
    this.adbConsole = new AdbConsoleService(() => this.components.adbPath(), () => this.connection.state, publish, runner)
    this.phoneTools = new PhoneToolsService(helperDirectory, () => this.components.adbPath(), () => this.connection.state, publish, async (name, extension) => {
      const pick = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0], {
        title: 'Save phone data export', defaultPath: name, filters: [{ name: extension.toUpperCase(), extensions: [extension] }], properties: ['showOverwriteConfirmation'],
      })
      return pick.canceled ? null : pick.filePath || null
    }, runner)
    this.diagnostics = new AdbDiagnosticsService(() => this.components.adbPath(), publish, runner)
    this.fastboot = new FastbootService(() => {
      const record = this.components.records.find(r => r.id === 'fastboot')
      return record?.location && ['Detected', 'Installed', 'Update available'].includes(record.status) ? path.join(record.location, 'fastboot.exe') : null
    }, publish, runner)
    this.screens = new DeviceScreenService(() => this.components.adbPath(), () => {
      const record = this.components.records.find(r => r.id === 'scrcpy')
      return record?.location && ['Detected', 'Installed', 'Update available'].includes(record.status) ? path.join(record.location, 'scrcpy.exe') : null
    }, () => this.connection.state, publish, async name => {
      const result = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0], { title: name.endsWith('.png') ? 'Save screenshot' : 'Save recording as a new file', defaultPath: name, filters: [{ name: name.endsWith('.png') ? 'PNG image' : 'Video recording', extensions: [path.extname(name).slice(1)] }], properties: ['showOverwriteConfirmation'] })
      return result.canceled ? null : result.filePath || null
    }, runner)
    this.appActions = new AppActionsService(() => this.components.adbPath(), () => this.connection.state, () => this.apps.state,
      state => publish({ type: 'appAction', state }),
      () => {}, {
        confirmBatch: state => this.confirmations.ask(batchActionConfirmation(state, this.apps.state.apps)),
        confirm: (action, application, deviceName, profileName, options) => this.confirmations.ask(singleActionConfirmation(action, application, deviceName, profileName, options)),
        exportFolder: () => this.exportDestination.resolve(),
      }, target => this.closing ? Promise.resolve() : this.apps.refreshAfterAction(target.id, target.userId, target.packageName), runner, { directory: helperDirectory, publish: (target, state) => this.apps.applyPermissions(target, state) }, () => new ApkTransferSession(storage.data.apkZstd === true), { directory: helperDirectory, observe: (application, action, options, context, outcome, message) => {
        const device = this.connection.state.devices.find(d => d.id === this.apps.state.deviceId)
        if (!device) return
        const evidence: PackageActionEvidence = { device: device.hardwareId || device.id, fingerprint: context.fingerprint, userId: application.userId, packageName: application.packageName, versionCode: application.versionCode, action, method: options.method || 'shell', root: options.root === true, keepData: options.keepData === true, outcome, message: message.slice(0, 1600), at: new Date().toISOString() }
        storage.data.packageActionEvidence = [...(storage.data.packageActionEvidence || []).filter(e => evidenceKey(e) !== evidenceKey(evidence)), evidence].slice(-1000)
        void storage.save().catch(() => publish({ type: 'notice', text: 'Action completed, but its capability history could not be saved.' }))
        publish({ type: 'apps', apps: this.apps.state })
      } })
    this.apps.configure(storage.data.appsLoadingMode ?? 'selected')
    this.backups = new AppBackupService(() => this.components.adbPath(), () => this.connection.state, () => this.apps.state,
      state => { publish({ type: 'backup', state }); this.failureDiagnostics.observe(state) }, () => {}, {
        folder: () => this.exportDestination.resolve(),
        presetFile: async () => { const result = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0], { title: 'Load application preset', properties: ['openFile'], filters: [{ name: 'Application preset', extensions: ['json'] }] }); return result.canceled ? null : result.filePaths[0] || null },
      }, this.failureDiagnostics.wrap(runner), this.backupCatalogue, (id, userId, packageName) => this.closing ? Promise.resolve() : this.apps.refreshAfterAction(id, userId, packageName), () => storage.data.apkZstd === true)
    this.restores = new AppRestoreService(() => this.components.adbPath(), () => this.connection.state, () => this.apps.state,
      state => publish({ type: 'restore', state }), {
        file: async () => { const result = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0], { title: 'Open ADB Vault backup', properties: ['openFile'], filters: [{ name: 'Backup manifest or ZIP', extensions: ['json', 'zip'] }] }); return result.canceled ? null : result.filePaths[0] || null },
        installFiles: async () => { const result = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0], { title: 'Choose applications to install', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Android applications', extensions: ['apk', 'apks'] }] }); return result.canceled ? null : result.filePaths },
        confirm: state => this.confirmations.ask(restoreConfirmation(state)),
      }, (id, userId, packageName) => this.closing ? Promise.resolve() : this.apps.refreshAfterAction(id, userId, packageName), runner)
    if (storage.data.appsOptions) this.apps.configureOptions(storage.data.appsOptions)
  }
  snapshot(): BackendSnapshot { return { appNotes: this.appNotes.state, apkInspector: this.inspector.state, phoneTools: structuredClone(this.phoneTools.state), adbConsole: structuredClone(this.adbConsole.state), screenSessions: this.screens.state, confirmation: this.confirmations.state, notifications: notificationSettings(this.storage.data.notifications), history: this.history.snapshot(), androidDiagnostics: this.androidDiagnostics.state, failureDiagnostics: this.failureDiagnostics.summaries, apkZstd: this.storage.data.apkZstd === true, files: this.files.state, fileSearch: this.fileSearch.state, fastboot: this.fastboot.state, restore: this.restores.state, exportDestination: this.exportDestination.settings, backup: this.backups.state, presetPreview: this.backups.preview, components: [...this.components.records, ...this.databases.records, this.geoip.record], connection: this.connection.state, apps: this.withBackups(this.apps.state), adbDiagnostics: this.diagnostics.state, stopAdbOnExit: this.storage.data.stopAdbOnExit !== false, appAction: this.appActions.state } }
  private withBackups(apps: AppsSnapshot): AppsSnapshot {
    const device = this.connection.state.devices.find(d => d.id === apps.deviceId)
    return { ...apps, apps: apps.apps.map(app => ({ ...app, backupCheck: this.backupCatalogue.check(device, app), actionEvidence: (this.storage.data.packageActionEvidence || []).filter(e => e.device === (device?.hardwareId || device?.id) && e.fingerprint === app.actionContext?.fingerprint && e.userId === app.userId && e.packageName === app.packageName && e.versionCode === app.versionCode) })) }
  }
  private async refreshBackups() {
    const before = JSON.stringify(this.withBackups(this.apps.state).apps.map(a => a.backupCheck))
    await this.backupCatalogue.refresh()
    if (!this.lifecycle.closing) {
      const apps = this.withBackups(this.apps.state)
      if (before !== JSON.stringify(apps.apps.map(a => a.backupCheck))) this.emit({ type: 'apps', apps })
    }
  }
  closeOperations() {
    const pending = [...this.requests.values()].flatMap(r => r.operation ? [r.operation] : [])
    if (this.initialization || this.components.busy || this.componentRequest || this.installPending) pending.push('components')
    return collectExitOperations(this.snapshot(), pending, this.screens.activeSessionCount)
  }
  initialize() {
    if (this.closing) return Promise.resolve()
    if (this.initialization) return this.initialization
    const task = this.initializeServices()
    this.initialization = task
    void task.finally(() => { if (this.initialization === task) this.initialization = undefined }).catch(() => {})
    return task
  }
  private async initializeServices() {
    await this.history.initialize()
    await this.appNotes.load()
    void this.fileClipboard.warmup().catch(() => { /* Explicit Copy/Paste reports a retryable startup failure. */ })
    await this.failureDiagnostics.load().catch(() => {})
    await this.backupCatalogue.load()
    if (this.closing || this.lifecycle.closing) return
    this.backupTimer = setInterval(() => { if (!this.backups.busy) void this.refreshBackups().catch(() => {}) }, 10000)
    this.backupTimer.unref()
    await this.components.detect()
    if (this.closing || this.lifecycle.closing) return
    this.connection.start()
    await this.geoip.initialize(); await this.databases.initialize()
    if (this.closing || this.lifecycle.closing) return
    await this.components.refreshPackages()
  }
  shutdown() {
    if (this.shutdownPromise) return this.shutdownPromise
    // Fence IPC and automatic collection immediately, before any asynchronous cleanup.
    this.closing = true
    this.confirmations.cancel()
    this.emit({ type: 'activity', source: 'system', tone: 'info', text: 'Closing ADB Vault. Active operations will be stopped where possible; completed changes are kept.' })
    clearInterval(this.backupTimer)
    this.connection.stop()
    this.apps.cancel()
    this.shutdownPromise = this.stopServices()
    return this.shutdownPromise
  }
  private async stopServices() {
    const failures: unknown[] = []
    const stop = async (action: () => Promise<unknown>) => { try { await action() } catch (error) { failures.push(error) } }
    await stop(() => this.adbConsole.shutdown())
    await stop(() => this.inspector.shutdown())
    await stop(() => this.phoneTools.shutdown())
    await stop(() => this.phoneNetwork.shutdown())
    await stop(() => this.androidDiagnostics.shutdown())
    await stop(() => this.previews.shutdown())
    for (const request of this.thumbnailRequests.values()) request.controller.abort()
    await stop(() => this.networkDiscovery.shutdown())
    await stop(() => this.networkFolders.shutdown())
    await stop(() => this.fileSearch.shutdown())
    const clipboardStopped = stop(() => this.fileClipboard.shutdown())
    await stop(() => this.files.shutdown())
    await stop(() => clipboardStopped)
    await Promise.allSettled([...this.thumbnailRequests.values()].map(request => request.done))
    await stop(() => this.screens.shutdown())
    await stop(() => this.fastboot.shutdown())
    // Component installers cannot safely be killed. Let their writes and validation finish
    // before stopping ADB or flushing preferences. New requests are already rejected.
    await Promise.allSettled([this.initialization, ...[...this.requests.values()].filter(r => r.operation === 'components').map(r => r.done)])
    const stopping = this.lifecycle.shutdown(this.storage.data.stopAdbOnExit !== false)
    const actionsStopped = this.appActions.shutdown()
    const restoreStopped = this.restores.shutdown()
    const backupsStopped = this.backups.shutdown().then(() => Promise.all([this.backupCatalogue.flush(), this.failureDiagnostics.shutdown()]))
    this.connection.stop()
    this.apps.cancel()
    const results = await Promise.allSettled([stopping, actionsStopped, backupsStopped, restoreStopped, ...[...this.requests.values()].map(r => r.done)])
    for (const result of results) if (result.status === 'rejected') failures.push(result.reason)
    await stop(() => this.appNotes.flush())
    await stop(() => this.storage.flush())
    this.emit({ type: 'activity', source: 'system', tone: failures.length ? 'warning' : 'success', text: failures.length ? 'Shutdown cleanup reported errors. Check operation results.' : 'Session closed normally. Operation results were saved.' })
    await this.history.close(failures.length === 0)
    if (failures.length) throw new AggregateError(failures, 'Some operations could not finish cleanly during shutdown.')
  }
  async install(ids: ComponentId[]) {
    if (this.installPending || this.components.busy) throw new Error('A component operation is already running.')
    this.installPending = true
    try {
      const google = ids.some(id => ['adb', 'fastboot', 'driver'].includes(id))
      const accepted = await this.confirmations.ask({
        title: 'Install components', confirmLabel: google ? 'Accept and install' : 'Install', tone: 'normal',
        description: ids.map(id => this.components.records.find(c => c.id === id)?.name || id).join(', '),
        effects: ['Official packages are downloaded into your ADB Vault user profile. External installations are not overwritten.',
          ...(ids.includes('runtime') ? ['The Microsoft installer may request administrator approval. No automatic restart will occur.'] : []),
          ...(ids.includes('driver') ? ['The Google USB Driver is added to the Windows Driver Store and applied to matching devices. Windows will request administrator approval.'] : [])],
        warnings: google ? ['By choosing Accept and install, you accept the Android SDK License Agreement. Review the terms before continuing.'] : [],
        details: ids.includes('driver') ? ['The downloaded driver package is reused when available. PnPUtil keeps the appropriate drivers for other devices; no forced replacement or automatic restart.'] : [],
        ...(google ? { termsUrl: 'https://developer.android.com/studio/terms' } : {}),
      })
      if (this.closing || !accepted) return
      const failures: string[] = []
      for (const id of ids) try { await this.components.install(id) } catch (e) { failures.push(`${id}: ${e instanceof Error ? e.message : String(e)}`) }
      if (failures.length) throw new Error(failures.join('\n'))
    } finally { this.installPending = false }
  }
  async request(input: unknown): Promise<BackendReply> {
    let componentLock = false
    const key = Symbol()
    let settled: (() => void) | undefined
    let historyRequest: string | undefined
    try {
      if (this.closing || this.lifecycle.closing || this.screens.closing) throw new Error('ADB Vault is closing.')
      const r = validateRequest(input)
      if (r.type === 'confirmation.answer') {
        this.confirmations.answer(r.id, r.accepted)
        return { ok: true, snapshot: this.snapshot() }
      }
      await this.history.initialize()
      if (this.closing) throw new Error('ADB Vault is closing.')
      this.requests.set(key, { operation: requestExitOperation[r.type], done: new Promise<void>(resolve => { settled = resolve }) })
      const operation = requestExitOperation[r.type]
      if (operation && !r.type.startsWith('history.')) historyRequest = this.history.startRequest(exitOperationLabels[operation], r.type.startsWith('files.') ? 'files' : r.type.startsWith('apps.') ? 'apps' : r.type.startsWith('components.') ? 'components' : (r.type.startsWith('connection.') || r.type.startsWith('phoneTools.')) ? 'connection' : 'system', 'id' in r && typeof r.id === 'string' ? r.id : undefined)
      if (operation && ['components', 'connection', 'power', 'fastboot', 'backup', 'restore', 'actions', 'files', 'diagnostics', 'clipboard'].includes(operation)) await this.history.flush()
      if (this.closing) throw new Error('ADB Vault is closing.')
      if (r.type === 'settings.notifications') {
        const previous = this.storage.data.notifications
        this.storage.data.notifications = validateNotificationSettings(r.settings)
        try { await this.storage.save() } catch (error) { this.storage.data.notifications = previous; throw error }
        return { ok: true, snapshot: this.snapshot() }
      }
      if (r.type === 'notifications.test') {
        if (!this.testNotification) throw new Error('Desktop notifications are unavailable.')
        await this.testNotification()
        return { ok: true, snapshot: this.snapshot(), notice: 'Test sent. Windows notification and sound settings also apply.' }
      }
      // Explicit diagnostics are bounded and cannot overlap phone mutations or heavy transfers.
      if (r.type === 'history.list') { await this.history.refresh(); return { ok: true, snapshot: this.snapshot() } }
      if (r.type === 'history.read') { const historySession = await this.history.read(r.sessionId); return { ok: true, snapshot: this.snapshot(), historySession } }
      if (r.type === 'history.clear') { await this.history.clear(); return { ok: true, snapshot: this.snapshot() } }
      const diagnosticStart = r.type === 'androidDiagnostics.start'
      if ((r.type === 'network.connections' || r.type === 'network.trace') && (this.androidDiagnostics.busy || this.files.deviceBusy || this.fileSearch.phoneBusy || this.connection.state.busy || this.components.busy || this.appActions.busy || this.backups.busy || this.restores.busy || this.apps.readingBadges || this.apps.state.status === 'loading' || this.apps.state.backgroundUserId != null)) throw new Error('Wait for the current phone operation before reading network connections.')
      const diagnosticConflict = r.type.startsWith('components.') && !['components.source', 'components.open'].includes(r.type) || ['monitor.read', 'connection.power', 'connection.screen', 'connection.root', 'connection.disconnect', 'connection.reconnect', 'connection.connect', 'connection.pair', 'connection.confirmReconnect', 'connection.qr', 'connection.fastboot.scan', 'connection.fastboot.inspect', 'connection.fastboot.reboot', 'apps.refresh', 'apps.selectProfile', 'apps.badges', 'apps.action', 'apps.permission', 'apps.batchAction', 'apps.retryBatchAction', 'apps.backup', 'apps.savePreset', 'apps.restoreOpen', 'apps.restoreBatch', 'apps.restoreFiles', 'apps.restoreInstall', 'apps.installOpen'].includes(r.type)
      const phoneToolsStart = ['phoneTools.read', 'phoneTools.clipboard.read', 'phoneTools.clipboard.write'].includes(r.type)
      if (phoneToolsStart && (this.adbConsole.busy || this.androidDiagnostics.busy || this.files.deviceBusy || this.fileSearch.phoneBusy || this.screens.busy || this.fastboot.state.busy || this.connection.state.busy || this.components.busy || this.componentRequest || this.installPending || this.appActions.busy || this.backups.busy || this.restores.busy || this.apps.readingBadges || this.apps.state.status === 'loading' || this.apps.state.backgroundUserId != null || this.apps.state.details?.status === 'loading'))
        throw new Error('Wait for the current phone operation before using clipboard or exporting phone data.')
      if (this.phoneTools.phoneBusy && (diagnosticConflict || diagnosticStart || ['console.run', 'connection.cameraUpdate', 'connection.info', 'connection.forget', 'network.trace', 'network.connections', 'apps.details', 'apps.scan', 'apps.prepareScan', 'apps.restorePrepare', 'apps.restoreRetry'].includes(r.type)))
        throw new Error('Finish or cancel the clipboard or phone data collection first.')
      if (r.type === 'console.run' && (this.androidDiagnostics.busy || this.files.deviceBusy || this.fileSearch.phoneBusy || this.screens.busy || this.fastboot.state.busy || this.connection.state.busy || this.components.busy || this.componentRequest || this.installPending || this.appActions.busy || this.backups.busy || this.restores.busy || this.apps.readingBadges || this.apps.state.status === 'loading' || this.apps.state.backgroundUserId != null)) throw new Error('Wait for the current phone operation before running a console command.')
      if (this.adbConsole.busy && (diagnosticConflict || diagnosticStart || ['connection.cameraUpdate', 'network.trace', 'network.connections'].includes(r.type))) throw new Error('Stop the console command before starting another phone operation.')
      if (this.androidDiagnostics.busy && diagnosticConflict) throw new Error('Finish or cancel Android diagnostic collection first.')
      if (diagnosticStart && (this.files.deviceBusy || this.fileSearch.phoneBusy || this.screens.busy || this.fastboot.state.busy || this.connection.state.busy || this.components.busy || this.componentRequest || this.installPending || this.appActions.busy || this.backups.busy || this.restores.busy || this.apps.readingBadges || this.apps.state.status === 'loading' || this.apps.state.backgroundUserId !== null)) throw new Error('Wait for the current phone operation before collecting diagnostics.')
      if ((this.files.deviceBusy || this.fileSearch.phoneBusy) && (r.type.startsWith('components.') && !['components.source', 'components.open'].includes(r.type) || ['connection.power', 'connection.disconnect', 'connection.reconnect', 'connection.forget', 'connection.connect', 'connection.pair', 'connection.confirmReconnect', 'connection.screen', 'connection.fastboot.scan', 'connection.fastboot.inspect', 'connection.fastboot.reboot', 'apps.action', 'apps.permission', 'apps.batchAction', 'apps.retryBatchAction', 'apps.backup', 'apps.savePreset', 'apps.restoreOpen', 'apps.restoreBatch', 'apps.restoreFiles', 'apps.restoreInstall', 'apps.installOpen', 'apps.refresh', 'apps.selectProfile', 'apps.badges'].includes(r.type))) throw new Error('Finish or stop phone file tasks first.')
      if (r.type === 'connection.cameraUpdate' && (this.androidDiagnostics.busy || this.files.deviceBusy || this.fileSearch.phoneBusy || this.connection.state.busy || this.components.busy || this.componentRequest || this.installPending || this.appActions.busy || this.backups.busy || this.restores.busy)) throw new Error('Wait for the current phone operation before changing the camera stream.')
      if (this.fastboot.state.busy && r.type !== 'snapshot' && r.type !== 'connection.scan' && !r.type.startsWith('inspector.')) throw new Error('Wait for the current Fastboot operation.')
      if (r.type.startsWith('connection.fastboot.') && (this.connection.state.busy || this.components.busy || this.componentRequest || this.installPending || this.screens.busy || this.appActions.busy || this.backups.busy || this.restores.busy || this.apps.readingBadges || this.apps.state.status === 'loading' || this.apps.state.backgroundUserId !== null || this.apps.state.details?.status === 'loading')) throw new Error('Wait for the current operation before using Fastboot.')
      if (this.screens.busy && (r.type === 'connection.power' || r.type.startsWith('components.'))) throw new Error('Wait for the current screen operation.')
      if (r.type === 'connection.screen' && (this.connection.state.busy || this.components.busy || this.componentRequest || this.installPending || this.appActions.busy || this.backups.busy || this.restores.busy)) throw new Error('Wait for the current operation before using screen controls.')
      if (this.connection.powerBusy && !['snapshot', 'connection.scan'].includes(r.type) && !r.type.startsWith('inspector.')) throw new Error('Wait for the device power command to finish.')
      if (r.type === 'connection.power' && (this.appActions.busy || this.backups.busy || this.restores.busy || this.apps.readingBadges || this.apps.state.status === 'loading' || this.apps.state.backgroundUserId !== null || this.apps.state.details?.status === 'loading' || this.components.busy || this.componentRequest || this.installPending)) throw new Error('Wait for the current operation before restarting or turning off the phone.')
      if (r.type === 'apps.prepareScan' && (this.appActions.busy || this.backups.busy || this.restores.busy || this.apps.readingBadges || this.connection.state.busy || this.components.busy || this.componentRequest || this.installPending)) throw new Error('Wait for the current operation before preparing APK files.')
      if (['apps.permission', 'apps.action', 'apps.batchAction', 'apps.retryBatchAction'].includes(r.type) && (this.connection.state.busy || this.components.busy || this.componentRequest || this.installPending)) throw new Error('Wait for the connection or component operation to finish.')
      const restoreOperation = ['apps.installOpen', 'apps.restoreOpen', 'apps.restorePrepare', 'apps.restoreInstall', 'apps.restoreFiles', 'apps.restoreBatch', 'apps.restoreRetry'].includes(r.type)
      if (restoreOperation && (this.backups.busy || this.appActions.busy || this.apps.readingBadges || this.connection.state.busy || this.components.busy || this.componentRequest || this.installPending)) throw new Error('Wait for the current operation before restoring an application.')
      if (this.restores.busy && (restoreOperation || ['apps.backup', 'apps.savePreset', 'apps.loadPreset', 'apps.permission', 'apps.action', 'apps.batchAction', 'apps.retryBatchAction', 'apps.badges', 'apps.refresh', 'apps.selectProfile', 'apps.options', 'apps.loadingMode', 'connection.select', 'connection.disconnect', 'connection.reconnect', 'connection.connect', 'connection.pair', 'connection.confirmReconnect', 'connection.forget', 'connection.qr', 'components.detect', 'components.installAll', 'components.action', 'components.locate'].includes(r.type))) throw new Error('Wait for backup verification or application installation to finish.')
      const backupOperation = ['apps.backup', 'apps.savePreset', 'apps.loadPreset'].includes(r.type)
      if (backupOperation && (this.appActions.busy || this.apps.readingBadges)) throw new Error('Wait for application actions or badge reading to finish.')
      if (this.backups.busy && (backupOperation || ['apps.permission', 'apps.action', 'apps.batchAction', 'apps.retryBatchAction', 'apps.badges', 'apps.refresh', 'apps.selectProfile', 'apps.options', 'apps.loadingMode', 'connection.select', 'connection.disconnect', 'connection.reconnect', 'connection.connect', 'connection.pair', 'connection.confirmReconnect', 'components.detect', 'components.installAll', 'components.action', 'components.locate'].includes(r.type))) throw new Error('Wait for the backup/preset operation, or cancel the backup first.')
      if (this.appActions.busy && r.type === 'apps.badges') throw new Error('Wait for the application action to finish.')
      if (this.apps.readingBadges && ['apps.permission', 'apps.action', 'apps.batchAction', 'apps.retryBatchAction'].includes(r.type)) throw new Error('Wait for badge reading to finish, or cancel it first.')
      if (this.appActions.busy && ['components.detect', 'components.installAll', 'components.action', 'components.locate', 'connection.forget', 'connection.qr', 'apps.refresh', 'apps.selectProfile', 'apps.options', 'apps.loadingMode', 'connection.select', 'connection.disconnect', 'connection.reconnect', 'connection.connect', 'connection.pair', 'connection.confirmReconnect'].includes(r.type)) throw new Error('Wait for the application action to finish, or cancel the export first.')
      if (r.type.startsWith('components.') && r.type !== 'components.source') {
        if (this.componentRequest) throw new Error('Wait for the current component operation.')
        this.componentRequest = true; componentLock = true
      }
      switch (r.type) {
        case 'inspector.open': {
          let file = r.path
          if (!file) {
            const pick = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0], { title: r.slot === 'before' ? 'Open APK · Before' : 'Open APK · After', properties: ['openFile'], filters: [{ name: 'Android package', extensions: ['apk'] }] })
            if (pick.canceled) break
            file = pick.filePaths[0]
          }
          if (file) this.inspector.open(r.slot, file)
          break
        }
        case 'inspector.clear': this.inspector.clear(r.slot); break
        case 'inspector.cancel': this.inspector.cancel(r.slot); break
        case 'inspector.swap': this.inspector.swap(); break
        case 'inspector.export': {
          const state = structuredClone(this.inspector.state), before = state.before.result, after = state.after.result
          if (this.inspector.busy || !before && !after) throw new Error('Open an APK and wait for inspection before exporting.')
          const report = { format: 'adb-vault-apk-inspection', version: 1, createdAt: new Date().toISOString(), before, after, changes: before && after ? compareApks(before, after) : null }
          const pick = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0], { title: 'Save APK inspection report', defaultPath: 'apk-inspection.json', filters: [{ name: 'JSON report', extensions: ['json'] }], properties: ['showOverwriteConfirmation'] })
          if (!pick.canceled && pick.filePath) {
            if (path.extname(pick.filePath).toLowerCase() !== '.json') throw new Error('Save the inspection report as a .json file.')
            const temporary = path.join(path.dirname(pick.filePath), `.apk-report-${randomUUID()}.tmp`)
            try { await writeFile(temporary, JSON.stringify(report, null, 2), { flag: 'wx' }); await rename(temporary, pick.filePath) } finally { await rm(temporary, { force: true }).catch(() => {}) }
            return { ok: true, snapshot: this.snapshot(), notice: 'APK inspection report saved.' }
          }
          break
        }
        case 'console.run': this.adbConsole.start(r); break
        case 'console.stop': this.adbConsole.stop(r.id); break
        case 'console.clear': this.adbConsole.clear(); break
        case 'phoneTools.read': this.phoneTools.read(r); break
        case 'phoneTools.clipboard.read': case 'phoneTools.clipboard.write': this.phoneTools.clipboard(r); break
        case 'phoneTools.export': this.phoneTools.export(r); break
        case 'phoneTools.cancel': this.phoneTools.cancel(r.jobId); break
        case 'phoneTools.clear': this.phoneTools.clear(); break
        case 'phoneTools.reveal': shell.showItemInFolder(this.phoneTools.savedPath(r.jobId)); break
        case 'androidDiagnostics.start': this.androidDiagnostics.start(r.kind, r.target, r.buffer); break
        case 'androidDiagnostics.cancel': this.androidDiagnostics.cancel(r.jobId); break
        case 'androidDiagnostics.exportLog': await this.androidDiagnostics.exportLog(r.capturedAt); break
        case 'androidDiagnostics.reveal': shell.showItemInFolder(this.androidDiagnostics.reportPath(r.jobId)); break
        case 'diagnostics.read': return { ok: true, snapshot: this.snapshot(), diagnosticReport: await this.failureDiagnostics.read(r.id) }
        case 'diagnostics.export': {
          const report = await this.failureDiagnostics.read(r.id)
          const pick = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0], { title: 'Save diagnostics', defaultPath: `adb-vault-diagnostics-${report.summary.createdAt.replace(/[:.]/g, '-')}.json`, filters: [{ name: 'Diagnostic report', extensions: ['json'] }], properties: ['showOverwriteConfirmation'] })
          if (!pick.canceled && pick.filePath) { await this.failureDiagnostics.export(r.id, pick.filePath); return { ok: true, snapshot: this.snapshot(), notice: 'Diagnostic report saved.' } }
          break
        }
        case 'files.search': this.fileSearch.start(r.location, r.query); break
        case 'files.search.cancel': this.fileSearch.cancel(r.id); break
        case 'files.index.info': { const fileIndex = await this.fileSearch.indexInfo(r.location); return { ok: true, snapshot: this.snapshot(), fileIndex } }
        case 'files.index.build': this.fileSearch.start(r.location, defaultSearchQuery, 'index'); break
        case 'files.index.delete': await this.fileSearch.deleteIndex(r.location); break
        case 'files.clipboard.write': {
          const fileClipboard = await this.fileClipboard.write(r.selection, r.mode)
          return { ok: true, snapshot: this.snapshot(), fileClipboard, ...(fileClipboard?.preparationTaskId ? { fileTaskIds: [fileClipboard.preparationTaskId] } : {}) }
        }
        case 'files.clipboard.read': {
          const fileClipboard = await this.fileClipboard.read()
          return { ok: true, snapshot: this.snapshot(), fileClipboard, ...(fileClipboard?.preparationTaskId ? { fileTaskIds: [fileClipboard.preparationTaskId] } : {}) }
        }
        case 'files.clipboard.paste': {
          const fileTaskIds = await this.fileClipboard.paste(r.token, r.destination)
          return { ok: true, snapshot: this.snapshot(), fileTaskIds }
        }
        case 'files.list': return { ok: true, snapshot: this.snapshot(), fileListing: await this.files.list(r.location, r.recursive, r.pattern) }
        case 'files.properties': return { ok: true, snapshot: this.snapshot(), fileProperties: await this.files.properties(r.location, !!r.calculate) }
        case 'files.storages': return { ok: true, snapshot: this.snapshot(), fileStorages: await this.files.storages(r.location) }
        case 'files.enqueue': this.files.enqueue(r.plan); break
        case 'files.control': await this.files.control(r.id, r.action); break
        case 'files.resolve': this.files.resolve(r.id, r.choice, r.all); break
        case 'files.network.scan': { const networkScan = await this.networkDiscovery.scan(r.requestId); return { ok: true, snapshot: this.snapshot(), networkScan } }
        case 'files.network.scan.cancel': this.networkDiscovery.cancel(r.requestId); break
        case 'files.network.connect': {
          const handle = (BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0])?.getNativeWindowHandle()
          const owner = handle ? (handle.length >= 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())).toString() : '0'
          const folder = await this.networkFolders.connect(r.address, r.prompt, owner)
          if (folder && (await this.files.io.stat({ kind: 'local', path: folder })).kind !== 'directory') throw new Error('The network path is not a folder.')
          if (folder) this.emit({ type: 'activity', source: 'files', tone: 'success', text: 'Opened SMB network folder: ' + folder })
          return { ok: true, snapshot: this.snapshot(), folder }
        }
        case 'files.chooseFolder': { const pick = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0], { title: 'Open folder in Files', properties: ['openDirectory'] }); return { ok: true, snapshot: this.snapshot(), folder: pick.canceled ? undefined : pick.filePaths[0] } }
        case 'files.preview': return { ok: true, snapshot: this.snapshot(), filePreview: await this.previews.open(r.requestId, r.location, r.fingerprint) }
        case 'files.preview.close': await this.previews.close(r.requestId); break
        case 'files.open': return { ok: true, snapshot: this.snapshot(), notice: await openManagedFile(this.files, r.location, !!r.withApp, this.storage.root, content => this.confirmations.ask(content)) }
        case 'files.thumbnail': {
          if (this.thumbnailRequests.has(r.requestId) || this.thumbnailRequests.size >= 4) return { ok: true, snapshot: this.snapshot() }
          const controller = new AbortController()
          // Optional previews fail quietly, without flooding Activity for denied, corrupt or cancelled images.
          const done = fileThumbnail(this.files.io, r.location, r.fingerprint, controller.signal).catch(() => undefined)
          this.thumbnailRequests.set(r.requestId, { controller, done })
          try { return { ok: true, snapshot: this.snapshot(), thumbnail: await done } }
          finally { this.thumbnailRequests.delete(r.requestId) }
        }
        case 'files.thumbnail.cancel': this.thumbnailRequests.get(r.requestId)?.controller.abort(); break
        case 'web.open': await shell.openExternal(safeWebUrl(r.url)); break
        case 'apps.notesSave': {
          let origin: AppNoteOrigin | null = null
          if (!r.note.id && r.note.target) {
            const t = r.note.target, state = this.apps.state
            const device = this.connection.state.devices.find(d => d.id === t.id && d.status === 'connected')
            const app = [...state.apps, ...(state.removedApps || [])].find(a => a.packageName === t.packageName && a.userId === t.userId)
            if (!device || this.connection.state.activeDeviceId !== t.id || state.status !== 'ready' || state.deviceId !== t.id || state.userId !== t.userId || !app) throw new Error('The application or phone changed. Reopen the record editor.')
            const fields = device.info?.fields
            origin = { deviceName: device.name, model: fields?.model || device.name, android: fields?.android || device.android, build: fields?.build || '', fingerprint: app.actionContext?.fingerprint || fields?.fingerprint || '', profileName: state.profiles.find(p => p.id === t.userId)?.name || String(t.userId), userId: t.userId, appLabel: app.label, versionName: app.versionName || '', versionCode: app.versionCode }
          }
          await this.appNotes.save(r.note, origin); break
        }
        case 'apps.notesDelete': {
          const note = this.appNotes.state.entries.find(n => n.id === r.id)
          if (!note) throw new Error('Record no longer exists.')
          if (await this.confirmations.ask({ title: 'Delete personal record', confirmLabel: 'Delete record', tone: 'danger', description: note.packageName, effects: ['This record will disappear for all phones.'], details: [note.label || note.text.slice(0, 200)] })) await this.appNotes.delete(r.id, r.expectedUpdatedAt)
          break
        }
        case 'apps.notesExport': {
          const pick = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0], { title: 'Export personal database', defaultPath: 'adb-vault-personal-records.json', filters: [{ name: 'Personal database', extensions: ['json'] }], properties: ['showOverwriteConfirmation'] })
          if (!pick.canceled && pick.filePath) { await this.appNotes.export(pick.filePath); this.emit({ type: 'notice', text: 'Personal database exported.' }) }
          break
        }
        case 'apps.notesImport': {
          const pick = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0], { title: 'Import personal database', filters: [{ name: 'Personal database', extensions: ['json'] }], properties: ['openFile'] })
          if (!pick.canceled && pick.filePaths[0]) { const result = await this.appNotes.import(pick.filePaths[0]); this.emit({ type: 'notice', text: 'Personal database: ' + result.added + ' added, ' + result.skipped + ' already present.' }) }
          break
        }
        case 'apps.prepareScan': {
          const url = safeWebUrl(r.url)
          await this.appActions.execute({ id: r.id, userId: r.userId, packageName: r.packageName }, 'export', undefined, true)
          const state = this.appActions.state
          if (state?.status === 'cancelled') return { ok: true, snapshot: this.snapshot() }
          if (state?.status !== 'success' || !state.exportPath) throw new Error(state?.message || 'Could not prepare APK files.')
          const manifest = JSON.parse(await readFile(path.join(state.exportPath, 'manifest.json'), 'utf8'))
          const messages: string[] = []
          try { const error = await shell.openPath(state.exportPath); if (error) messages.push('Could not open the folder: ' + error) } catch { messages.push('Could not open the prepared folder.') }
          try { await shell.openExternal(url) } catch { messages.push('Could not open the website. Use Open website to try again.') }
          return { ok: true, snapshot: this.snapshot(), scanPreparation: { directory: state.exportPath, files: manifest.files.map((f: { file: string; sha256: string }) => ({ file: f.file, sha256: f.sha256 })), message: messages.join(' ') } }
        }
        case 'network.connections': return { ok: true, phoneConnections: await this.phoneNetwork.connections(r.target, r.requestId), snapshot: this.snapshot() }
        case 'network.trace': return { ok: true, phoneTrace: await this.phoneNetwork.trace(r.target, r.requestId, r.address), snapshot: this.snapshot() }
        case 'network.cancel': await this.phoneNetwork.cancel(r.requestId); break
        case 'monitor.read': return { ok: true, monitor: await this.monitor.read(r.id, r.tab), snapshot: this.snapshot() }
        case 'apps.restoreOpen': await this.restores.open(r.id, r.userId); break
        case 'apps.installOpen': await this.restores.open(r.id, r.userId, true, r.files ? (signal, progress) => prepareFileInstallSource(this.files.io, r.files!, r.userId, signal, progress) : undefined); break
        case 'apps.restorePrepare': await this.restores.prepare(r.packageName); break
        case 'apps.restoreInstall': await this.restores.install(r.token); break
        case 'apps.restoreFiles': await this.restores.restoreFiles(r.token, r.components); break
        case 'apps.restoreBatch': await this.restores.restoreBatch(r.plan); break
        case 'apps.restoreRetry': await this.restores.retryBatch(); break
        case 'apps.restoreCancel': this.restores.cancel(); break
        case 'settings.exportMode': await this.exportDestination.configure(r.mode); break
        case 'settings.exportFolder': await this.exportDestination.configure('fixed', true); break
        case 'settings.apkZstd': {
          if (this.backups.busy || this.appActions.busy) throw new Error('Wait for the current application operation before changing APK transfer settings.')
          const previous = this.storage.data.apkZstd
          this.storage.data.apkZstd = r.enabled
          try { await this.storage.save() } catch (error) { this.storage.data.apkZstd = previous; throw error }
          break
        }
        case 'apps.backup': case 'apps.savePreset':
          if (r.type === 'apps.backup' && (r.selection.contents?.data || r.selection.contents?.cache)) {
            if (!this.apps.state.options.root) throw new Error('Enable root in Settings > Apps to use private data operations.')
            await this.connection.checkRoot(r.selection.id, true)
            const root = this.connection.state.devices.find(d => d.id === r.selection.id)?.root
            if (root?.status !== 'available') throw new Error(root?.message || 'Root access on the phone must be verified before copying internal data or cache.')
          }
          if (this.restores.busy || this.appActions.busy || this.apps.readingBadges) throw new Error('Wait for application actions, restore or badge reading to finish.')
          await this.backups.execute(r.selection, r.type === 'apps.savePreset'); break
        case 'apps.loadPreset': await this.backups.loadPreset(r.id, r.userId); break
        case 'apps.refreshBackups': await this.refreshBackups(); break
        case 'apps.cancelBackup': this.backups.cancel(); break
        case 'apps.revealBackup': shell.showItemInFolder(await this.backupCatalogue.revealPath(r.file)); break
        case 'apps.openBackup': {
          const location = this.backups.state?.outputDirectory
          if (!location) throw new Error('No backup folder is available.')
          const error = await shell.openPath(location); if (error) throw new Error(error); break
        }
        case 'apps.badges': await this.apps.readBadges(r.id, r.userId); break
        case 'apps.cancelBadges': this.apps.cancelBadges(); break
        case 'components.adbDiagnostics': await this.diagnostics.refresh(); break
        case 'connection.screenCapabilities': {
          if (this.components.busy || this.componentRequest) throw new Error('Wait for the component operation to finish.')
          const screenCapabilities = await this.screens.capabilities(); return { ok: true, snapshot: this.snapshot(), screenCapabilities }
        }
        case 'connection.cameraModes': {
          if (this.components.busy || this.componentRequest) throw new Error('Wait for the component operation to finish.')
          const cameraModes = await this.screens.cameraModes(r); return { ok: true, snapshot: this.snapshot(), cameraModes }
        }
        case 'connection.screenApplications': {
          if (this.components.busy || this.componentRequest) throw new Error('Wait for the component operation to finish.')
          const screenApplications = await this.screens.applications(r); return { ok: true, snapshot: this.snapshot(), screenApplications }
        }
        case 'connection.screenStop': await this.screens.stop(r.sessionId); break
        case 'connection.screenOnTop': await this.screens.setAlwaysOnTop(r.sessionId, r.enabled); break
        case 'connection.touchControls': this.screens.touchTarget(r.sessionId); break
        case 'connection.cameraControl': await this.screens.cameraControl(r.sessionId, r.command); break
        case 'connection.cameraZoom': await this.screens.cameraZoom(r.sessionId, r.value); break
        case 'connection.cameraUpdate': await this.screens.updateCamera(r.sessionId, r.update, r.confirmedSplit); break
        case 'connection.cameraPanel': if (!this.screens.state.some(s => s.id === r.sessionId && s.mode === 'camera')) throw new Error('This camera session has ended.'); break
        case 'connection.screen': {
          const application = r.options?.application
          let applicationLabel: string | undefined
          if (application) {
            const apps = this.apps.state
            const app = apps.apps.find(a => a.packageName === application.packageName)
            if (apps.deviceId === r.id && apps.userId === application.userId && app) applicationLabel = app.label.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 160)
          }
          const notice = await this.screens.execute(r, r.action, r.options, applicationLabel); return { ok: true, snapshot: this.snapshot(), ...(notice ? { notice } : {}) } }
        case 'connection.power': await this.connection.power(r.id, r.mode, r.confirmed, r.serial, r.transportId); break
        case 'connection.root': await this.connection.checkRoot(r.id, r.requestAccess); break
        case 'connection.info': await this.connection.inspect(r.id); break
        case 'apps.permission':
          if (this.apps.state.details?.status === 'loading' || this.apps.state.details?.data?.analysis?.status === 'running') throw new Error('Wait for application details to finish reading.')
          await this.appActions.executePermission(r); break
        case 'apps.action': await this.appActions.execute({ id: r.id, userId: r.userId, packageName: r.packageName }, r.action, undefined, false, r.options); break
        case 'apps.batchAction': await this.appActions.executeBatch(r.plan); break
        case 'apps.retryBatchAction': await this.appActions.retryBatch(); break
        case 'apps.cancelAction': this.appActions.cancel(); break
        case 'apps.openExport': {
          const location = this.appActions.state?.status === 'success' && this.appActions.state.exportPath
          if (!location) throw new Error('No completed export is available.')
          const error = await shell.openPath(location); if (error) throw new Error(error); break
        }
        case 'apps.refresh': await this.apps.refresh(r.id, r.userId); break
        case 'apps.scan': case 'apps.details': await this.appActions.waitForPermission(); await this.refreshBackups(); await this.apps.inspect(r.id, r.userId, r.packageName, r.type === 'apps.scan'); break
        case 'apps.selectProfile': await this.apps.selectProfile(r.id, r.userId); break
        case 'apps.loadingMode': {
          const previous = this.storage.data.appsLoadingMode
          this.storage.data.appsLoadingMode = r.mode
          try { await this.storage.save() } catch (error) { this.storage.data.appsLoadingMode = previous; throw error }
          this.apps.configure(r.mode); break
        }
        case 'apps.options': {
          const previous = this.storage.data.appsOptions
          this.storage.data.appsOptions = { icons: r.options.icons, early: r.options.early, storage: r.options.storage, root: r.options.root === true }
          try { await this.storage.save() } catch (error) { this.storage.data.appsOptions = previous; throw error }
          this.apps.configureOptions(this.storage.data.appsOptions); break
        }
        case 'settings.stopAdbOnExit': {
          const previous = this.storage.data.stopAdbOnExit
          this.storage.data.stopAdbOnExit = r.enabled
          try { await this.storage.save() } catch (error) { this.storage.data.stopAdbOnExit = previous; throw error }
          break
        }
        case 'apps.cancel': this.apps.cancel(); break
        case 'components.detect': await this.components.detect(); await this.geoip.initialize(); await this.databases.initialize(); await this.components.refreshPackages(); break
        case 'components.action': if (r.id === 'geoip') { await this.geoip.initialize(); break } if (isDatabaseId(r.id)) { await this.databases.action(r.id, r.action); break } if (r.action === 'detect') await this.components.detect(); else await this.install([r.id]); break
        case 'components.installAll': { const ids = installationTargets(this.components.records); if (ids.length) await this.install(ids); if (this.databases.records.some(d => ['Update available', 'Repair needed', 'Download failed'].includes(d.status))) await this.databases.action('db-trackers', 'install'); break }
        case 'components.locate': if (r.id === 'geoip') { await this.geoip.locate(r.folder); break } if (isDatabaseId(r.id)) throw new Error('Use Update databases or Restore bundled databases.'); await this.components.locate(r.id, r.folder); break
        case 'components.open': { const folder = [...this.components.records, ...this.databases.records, this.geoip.record].find(c => c.id === r.id)?.location; if (!folder) throw new Error('No verified location is available.'); const error = await shell.openPath(folder); if (error) throw new Error(error); break }
        case 'components.source': {
          const source = [...this.components.records, ...this.databases.records, this.geoip.record].find(c => c.id === r.id)?.sourceUrl
          if (!source) throw new Error('No source is available for this component.')
          const url = new URL(source)
          if (url.protocol !== 'https:' || !['developer.android.com', 'learn.microsoft.com', 'github.com', 'dev.maxmind.com'].includes(url.hostname) || url.username || url.password) throw new Error('Invalid component source.')
          await shell.openExternal(url.href)
          break
        }
        case 'connection.scan': await this.connection.scan(); break
        case 'connection.fastboot.scan': await this.fastboot.scan(); break
        case 'connection.fastboot.inspect': await this.fastboot.inspect(r.serial, r.token); break
        case 'connection.fastboot.reboot': await this.fastboot.reboot(r.serial, r.token, r.mode, r.confirmed); break
        case 'connection.select': this.connection.select(r.id); break
        case 'connection.connect': await this.connection.connect(r.host, r.port); break
        case 'connection.pair': await this.connection.pair(r.host, r.port, r.code); break
        case 'connection.reconnect': await this.connection.reconnect(r.id); break
        case 'connection.find': await this.connection.findReconnect(); break
        case 'connection.confirmReconnect': await this.connection.confirmReconnect(r.token); break
        case 'connection.disconnect': await this.connection.disconnect(r.id); break
        case 'connection.forget': await this.connection.forget(r.id); break
        case 'connection.qr': await this.connection.newQr(); break
        case 'connection.cancelQr': this.connection.cancelQr(); break
      }
      return { ok: true, snapshot: this.snapshot() }
    } catch (e) { const error = e instanceof Error ? e.message : String(e); const requestType = (input as { type?: string } | null)?.type; const source = typeof requestType === 'string' && requestType.startsWith('files.') ? 'files' : typeof requestType === 'string' && requestType.startsWith('components.') ? 'components' : typeof requestType === 'string' && requestType.startsWith('connection.') ? 'connection' : typeof requestType === 'string' && requestType.startsWith('apps.') ? 'apps' : 'system'; if (typeof requestType !== 'string' || !requestType.startsWith('network.')) this.emit({ type: 'activity', source, text: error, tone: 'warning' }); return { ok: false, error, snapshot: this.snapshot() } }
    finally { if (componentLock) this.componentRequest = false; if (historyRequest) this.history.finishRequest(historyRequest); this.requests.delete(key); settled?.() }
  }
}
