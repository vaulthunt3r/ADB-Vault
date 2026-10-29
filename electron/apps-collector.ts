import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { checked, run, type Runner } from './process.js'
import { emptyApps, parseAppsOutput, defaultAppsOptions, type AppsOptions } from './apps-protocol.js'
import { parseAndroidProfiles } from './app-profiles.js'
import type { BackendEvent, ConnectionSnapshot } from './contracts.js'
import { AppsProgressReader } from './apps-progress.js'
import { validateAppTarget } from './app-details-protocol.js'
const directory = '/data/local/tmp/android-manager'
const remote = `${directory}/manager-server.jar`
export class AppsCollector {
  state = emptyApps()
  private controller?: AbortController
  constructor(private helperDirectory: string, private adbPath: () => string | null, private connection: () => ConnectionSnapshot, private emit: (event: BackendEvent) => void, private runner: Runner = run) {}
  private publish() { this.emit({ type: 'apps', apps: this.state }) }
  connectionChanged(connection: ConnectionSnapshot) {
    if (this.state.deviceId && (connection.activeDeviceId !== this.state.deviceId || !connection.devices.some(d => d.id === this.state.deviceId && d.status === 'connected'))) {
      this.controller?.abort(); this.controller = undefined; this.state = emptyApps(); this.publish()
    }
  }
  cancel() { this.controller?.abort(); this.controller = undefined; this.state = { ...this.state, progress: null, apps: [], status: 'idle', error: null, collectedAt: null, message: 'Collection cancelled.' }; this.publish() }
  async refresh(deviceId: string, requestedUserId?: number, options: AppsOptions = defaultAppsOptions(), packageName?: string) {
    if (packageName !== undefined) validateAppTarget(packageName, requestedUserId!)
    if (requestedUserId !== undefined && (!Number.isInteger(requestedUserId) || requestedUserId < 0 || requestedUserId > 99999)) throw new Error('Invalid Android profile ID.')
    const connection = this.connection(), device = connection.devices.find(d => d.id === deviceId && d.status === 'connected')
    if (!device || connection.activeDeviceId !== deviceId) throw new Error('Select a connected device before reading applications.')
    const adb = this.adbPath(); if (!adb) throw new Error('ADB is unavailable. Check Components.')
    if (this.controller) throw new Error('Apps collection is already running.')
    const controller = new AbortController(); this.controller = controller
    const previous = this.state.deviceId === deviceId ? this.state : emptyApps()
    const selectedUserId = requestedUserId ?? previous.userId
    this.state = { ...emptyApps(), profiles: previous.profiles, currentUserId: previous.currentUserId, deviceId, userId: selectedUserId, status: 'loading', message: 'Checking Android profiles…' }; this.publish()
    const command = async (args: string[], timeout = 15000, maxOutputBytes = 2_000_000, onStdout?: (chunk: string) => void) => {
      if (this.connection().activeDeviceId !== deviceId) throw new Error('Active device changed.')
      return checked(await this.runner(adb, [...(device.transportId ? ['-t', device.transportId] : ['-s', device.serial]), ...args], timeout, undefined, undefined, { signal: controller.signal, maxOutputBytes, onStdout }))
    }
    try {
      const manifest = JSON.parse(await readFile(path.join(this.helperDirectory, 'helper-manifest.json'), 'utf8'))
      const jar = path.join(this.helperDirectory, 'manager-server.jar')
      const digest = createHash('sha256').update(await readFile(jar)).digest('hex')
      if (manifest.protocolVersion !== 1 || manifest.helperVersion !== '0.1.0' || digest !== manifest.sha256) throw new Error('Bundled Android helper failed verification. Rebuild it with npm run helper:build.')
      const sdk = Number(await command(['shell', 'getprop', 'ro.build.version.sdk']))
      if (!Number.isInteger(sdk) || sdk < manifest.minSdk) throw new Error(`Apps helper requires Android 8.0 or newer (API ${manifest.minSdk}).`)
      const userText = await command(['shell', 'am', 'get-current-user'])
      if (!/^\d{1,5}$/.test(userText)) throw new Error('Cannot determine the current Android user.')
      const currentUserId = Number(userText)
      let profiles, profilesError: string | null = null
      try { profiles = parseAndroidProfiles(await command(['shell', 'pm', 'list', 'users'])) }
      catch (error) {
        if (controller.signal.aborted) throw error
        profiles = [{ id: currentUserId, name: `User ${currentUserId}`, running: true, managed: false }]
        profilesError = `Other profiles could not be listed: ${error instanceof Error ? error.message : String(error)}`
      }
      const userId = selectedUserId ?? currentUserId
      this.state = { ...this.state, profiles, currentUserId, profilesError, userId }; this.publish()
      if (!profiles.some(profile => profile.id === userId)) throw new Error(`Android profile ${userId} is no longer available. Select another profile.`)
      const remoteHash = await command(['shell', `if [ -f ${remote} ]; then sha256sum ${remote}; fi`])
      if (remoteHash.split(/\s+/)[0] !== digest) {
        this.state = { ...this.state, message: 'Uploading the Android helper…' }; this.publish()
        await command(['shell', `mkdir -p ${directory} && rm -f ${remote}.new`])
        await command(['push', jar, `${remote}.new`], 30000)
        const uploaded = await command(['shell', 'sha256sum', `${remote}.new`])
        if (uploaded.split(/\s+/)[0] !== digest) throw new Error('Android helper upload checksum mismatch.')
        // Fixed paths only. Do not replace a working helper until the upload is verified.
        await command(['shell', `chmod 444 ${remote}.new && mv -f ${remote}.new ${remote}`])
      }
      this.state = { ...this.state, userId, message: `Reading applications${options.icons ? ' and icons' : ''}${options.storage ? ' and storage sizes' : ''} for ${profiles.find(profile => profile.id === userId)!.name} (ID ${userId})…` }; this.publish()
      const flags = `${packageName ? `--package ${packageName} ` : ''}${options.icons ? '' : '--no-icons '}${options.storage ? '--storage ' : ''}`
      let lastProgress = 0
      const progress = new AppsProgressReader(userId, manifest.helperVersion, (completed, total) => {
        if (controller.signal.aborted || this.controller !== controller || this.connection().activeDeviceId !== deviceId) return
        const now = Date.now()
        if (completed !== 0 && completed !== total && now - lastProgress < 200) return
        lastProgress = now; this.state = { ...this.state, progress: { completed, total } }; this.publish()
      })
      const output = await command(['shell', `CLASSPATH=${remote} app_process / dev.adbvault.helper.Main ${flags}${userId}`], 130000, 64_000_000, chunk => progress.push(chunk))
      const result = parseAppsOutput(output, userId, manifest.helperVersion)
      if (packageName && (result.apps.length > 1 || result.apps.some(app => app.packageName !== packageName))) throw new Error('Unexpected package in application update.')
      if (controller.signal.aborted || this.controller !== controller) return
      this.state = { ...this.state, ...result, apps: result.apps.filter(app => app.installed !== false), removedApps: result.apps.filter(app => app.installed === false), progress: null, status: 'ready', error: null, message: '', collectedAt: new Date().toISOString() }; this.publish()
      this.emit({ type: 'activity', device: device.serial, text: `Read ${result.apps.length} applications for Android user ${userId} in ${(result.elapsedMs / 1000).toFixed(1)} s (device collection).`, tone: 'success' })
    } catch (error) {
      if (controller.signal.aborted || this.controller !== controller) return
      const message = error instanceof Error ? error.message : String(error)
      this.state = { ...this.state, progress: null, status: 'error', apps: [], removedApps: [], error: message, message: '' }; this.publish()
      throw error
    } finally { if (this.controller === controller) this.controller = undefined }
  }
}
