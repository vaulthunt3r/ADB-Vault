import { analyzeApks } from './apk-analysis.js'
import { loadDatabase, bundledDatabaseDirectory } from './databases.js'
import type { SignatureDatabase } from './signature-database.js'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { checked, run, type Runner } from './process.js'
import { parseAppDetails, validateAppTarget, type AppDetailsState } from './app-details-protocol.js'
import type { AppsSnapshot } from './apps-protocol.js'
import type { ConnectionSnapshot } from './contracts.js'
import { collectTrackerBadges, sensorBadge } from './app-badges.js'
import { RootBadgeReader } from './root-badges.js'

export class AppDetailsReader {
  private rootReader = new RootBadgeReader()
  resetRootAccess() { this.rootReader.reset() }
  private controller?: AbortController
  private pending?: { key: string; promise: Promise<void> }
  constructor(private directory: string, private adb: () => string | null, private connection: () => ConnectionSnapshot, private apps: () => AppsSnapshot, private publish: (details: AppDetailsState | null) => void, private runner: Runner = run, private database?: () => SignatureDatabase | undefined) {}
  clear() { this.controller?.abort(); this.controller = undefined; this.pending = undefined; this.publish(null) }
  read(id: string, userId: number, packageName: string, scan = false, permissions = true) {
    validateAppTarget(packageName, userId)
    const key = JSON.stringify([id, userId, packageName, scan, permissions])
    if (this.pending?.key === key) return this.pending.promise
    const snapshot = this.apps(), connection = this.connection()
    const device = connection.devices.find(d => d.id === id && d.status === 'connected')
    if (!device || connection.activeDeviceId !== id || snapshot.deviceId !== id || snapshot.userId !== userId || snapshot.status !== 'ready' || !snapshot.apps.some(a => a.packageName === packageName)) throw new Error('Select an application from the current connected profile.')
    const adb = this.adb(); if (!adb) throw new Error('ADB is unavailable.')
    this.controller?.abort()
    const controller = new AbortController(); this.controller = controller
    const state: AppDetailsState = { deviceId: id, userId, packageName, status: 'loading', collectedAt: null, data: null, error: null }
    this.publish(state)
    const current = () => this.controller === controller && !controller.signal.aborted && this.apps().deviceId === id && this.apps().userId === userId && this.connection().activeDeviceId === id
    const command = async (args: string[], timeout = 15000) => {
      if (!current()) throw new Error('Application context changed.')
      return checked(await this.runner(adb, ['-s', device.serial, ...args], timeout, undefined, undefined, { signal: controller.signal, maxOutputBytes: 2_000_000 }))
    }
    const storage = snapshot.options.storage
    const promise = (async () => {
      try {
        const jar = path.join(this.directory, 'manager-server.jar')
        const manifest = JSON.parse(await readFile(path.join(this.directory, 'helper-manifest.json'), 'utf8'))
        const digest = createHash('sha256').update(await readFile(jar)).digest('hex')
        if (manifest.protocolVersion !== 1 || manifest.helperVersion !== '0.1.0' || digest !== manifest.sha256) throw new Error('Bundled Android helper failed verification.')
        const remote = '/data/local/tmp/android-manager/manager-server.jar'
        const hash = await command(['shell', `if [ -f ${remote} ]; then sha256sum ${remote}; fi`])
        if (hash.split(/\s+/)[0] !== digest) {
          await command(['shell', 'mkdir -p /data/local/tmp/android-manager'])
          await command(['push', jar, `${remote}.details-new`], 30000)
          if ((await command(['shell', 'sha256sum', `${remote}.details-new`])).split(/\s+/)[0] !== digest) throw new Error('Android helper upload checksum mismatch.')
          await command(['shell', `chmod 444 ${remote}.details-new && mv -f ${remote}.details-new ${remote}`])
        }
        const output = await command(['shell', `CLASSPATH=${remote} app_process / dev.adbvault.helper.Main --details ${packageName} ${permissions ? '--permissions ' : ''}${storage ? '--storage ' : ''}${userId}`], 60000)
        const data = parseAppDetails(output, packageName, userId)
        const database = this.database ? this.database() : await loadDatabase(bundledDatabaseDirectory).catch(() => undefined)
        collectTrackerBadges(data, database)
        if (data.components) {
          try {
            // Some SensorService implementations print a valid state but return nonzero.
            // Accept only the exact documented state, never arbitrary error text.
            const result = await this.runner(adb, ['-s', device.serial, 'shell', 'cmd', 'sensorservice', 'get-uid-state', packageName, '--user', String(userId)], 5000, undefined, undefined, { signal: controller.signal, maxOutputBytes: 8192 })
            data.badgeChecks!.sensorsDisabled = sensorBadge(result.stdout || result.stderr)
          }
          catch (error) { data.badgeChecks!.sensorsDisabled = { present: null, reason: error instanceof Error ? error.message : String(error), items: [] } }
        }
        if (snapshot.options.root && current()) await this.rootReader.collect(data, adb, device.serial, digest, this.runner, controller.signal, device.id)
        if (current()) this.publish({ ...state, status: 'ready', data, collectedAt: new Date().toISOString() })
        if (scan && current()) {
          const empty = { revision: database?.revision || '', classes: 0, artifacts: [], trackers: [], libraries: [], native: [], unidentifiedNative: [], issues: [] }
          data.analysis = { ...empty, status: 'running' }
          this.publish({ ...state, status: 'ready', data: { ...data }, collectedAt: new Date().toISOString() })
          try {
            if (!database) throw new Error('Detection databases are unavailable. Check Components.')
            const scanOutput = checked(await this.runner(adb, ['-s', device.serial, 'shell', `CLASSPATH=${remote} app_process / dev.adbvault.helper.Main --scan ${packageName} ${userId}`], 120000, undefined, undefined, { signal: controller.signal, maxOutputBytes: 32_000_000 }))
            data.analysis = await analyzeApks(scanOutput, packageName, userId, database, controller.signal)
          } catch (error) { data.analysis = { ...empty, status: 'error', error: error instanceof Error ? error.message : String(error) } }
          if (current()) this.publish({ ...state, status: 'ready', data: { ...data }, collectedAt: new Date().toISOString() })
        }
      } catch (error) {
        if (current()) this.publish({ ...state, status: 'error', error: error instanceof Error ? error.message : String(error) })
      } finally {
        if (this.controller === controller) { this.controller = undefined; this.pending = undefined }
      }
    })()
    this.pending = { key, promise }; return promise
  }
}
