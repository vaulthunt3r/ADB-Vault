import type { FailureDiagnosticReport } from '../electron/failure-diagnostics-protocol'
import type { Page } from '@playwright/test'
import type { BackendEvent, BackendRequest, BackendSnapshot, ConnectionSnapshot } from '../electron/contracts'
import { componentCatalog } from '../electron/catalog'
import type { AppPreset } from '../electron/app-backup-protocol'
declare global { interface Window { backendTest: { diagnosticReport?: FailureDiagnosticReport; presetFile?: AppPreset | 'invalid' | null; clipboardWrites: string[]; requests: BackendRequest[]; emit: (event: BackendEvent) => void; snapshot: BackendSnapshot } } }
export async function installBackendFixture(page: Page) {
  await page.addInitScript((catalog) => {
    const snapshot: BackendSnapshot = { appNotes: { status: 'ready', entries: [], error: null }, apps: { options: { icons: true, early: false, storage: false }, loadingMode: 'selected', backgroundUserId: null, cachedUserIds: [], preloadErrors: {}, profiles: [], currentUserId: null, profilesError: null, deviceId: null, userId: null, status: 'idle', apps: [], error: null, message: '', collectedAt: null, elapsedMs: null, warnings: 0, locale: null }, components: catalog.map(c => ({ ...c, status: c.id === 'adb' || c.id === 'fastboot' ? 'Detected' : c.id === 'driver' ? 'Download failed' : 'Not installed', version: c.id === 'adb' || c.id === 'fastboot' ? '37.0.1' : '—', location: c.id === 'adb' || c.id === 'fastboot' ? 'C:\\Test\\platform-tools' : null, targetVersion: '37.0.1', size: '8.3 MB', message: c.id === 'driver' ? 'Test download failure' : undefined })), connection: { devices: [], activeDeviceId: null, scanning: false, busy: false, error: null, message: '', qr: null, adbAvailable: true } }
    const listeners = new Set<(event: BackendEvent) => void>()
    window.backendTest = { clipboardWrites: [], snapshot, requests: [], emit: event => { if (event.type === 'appNotes') snapshot.appNotes = event.state; if (event.type === 'adbConsole') snapshot.adbConsole = event.state; if (event.type === 'confirmation') snapshot.confirmation = event.state; if (event.type === 'failureDiagnostic') snapshot.failureDiagnostics = [event.diagnostic, ...(snapshot.failureDiagnostics || []).filter(d => d.id !== event.diagnostic.id)]; if (event.type === 'components') snapshot.components = event.components; if (event.type === 'apps') snapshot.apps = event.apps; if (event.type === 'connection') snapshot.connection = event.connection; if (event.type === 'appAction') snapshot.appAction = event.state; if (event.type === 'backup') snapshot.backup = event.state; if (event.type === 'restore') snapshot.restore = event.state; listeners.forEach(listener => listener(event)) } }
    window.desktop = {
      writeClipboard: async text => { window.backendTest.clipboardWrites.push(text) },
      control: async () => {}, locate: async () => 'C:\\Test\\platform-tools',
      subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
      request: async request => {
        window.backendTest.requests.push(request)
        if (request.type === 'apps.notesSave') {
          const notes = snapshot.appNotes!.entries, draft = request.note, prior = notes.find(n => n.id === draft.id), device = snapshot.connection.devices.find(d => d.id === draft.target?.id), app = snapshot.apps.apps.find(a => a.packageName === draft.packageName) || snapshot.apps.removedApps?.find(a => a.packageName === draft.packageName)
          const now = new Date().toISOString()
          const note = { id: prior?.id || crypto.randomUUID(), packageName: draft.packageName, label: draft.label, text: draft.text, color: draft.color, createdAt: prior?.createdAt || now, updatedAt: now, origin: prior ? prior.origin : device && app ? { deviceName: device.name, model: device.name, android: device.android, build: 'TEST.001', fingerprint: 'test/build', profileName: 'Owner', userId: app.userId, appLabel: app.label, versionName: app.versionName || '', versionCode: app.versionCode } : null }
          window.backendTest.emit({ type: 'appNotes', state: { status: 'ready', error: null, entries: prior ? notes.map(n => n.id === prior.id ? note : n) : [...notes, note] } })
        }
        if (request.type === 'apps.notesDelete') window.backendTest.emit({ type: 'appNotes', state: { ...snapshot.appNotes!, entries: snapshot.appNotes!.entries.filter(n => n.id !== request.id) } })
        if (request.type === 'console.run') {
          const previous = snapshot.adbConsole || { revision: 0, run: null, history: [] }
          window.backendTest.emit({ type: 'adbConsole', state: { revision: previous.revision + 1,
            history: [{ mode: request.mode, command: request.command }, ...previous.history.filter(h => h.command !== request.command || h.mode !== request.mode)].slice(0, 50),
            run: { id: crypto.randomUUID(), mode: request.mode, command: request.command, target: request.target, deviceName: snapshot.connection.devices.find(d => d.id === request.target.id)!.name, status: 'running', startedAt: new Date().toISOString(), exitCode: null, output: [], truncated: false, message: 'Running…' } } })
        }
        if (request.type === 'console.stop' && snapshot.adbConsole?.run?.id === request.id) window.backendTest.emit({ type: 'adbConsole', state: { ...snapshot.adbConsole, revision: snapshot.adbConsole.revision + 1, run: { ...snapshot.adbConsole.run, status: 'cancelled', message: 'Stopped.' } } })
        if (request.type === 'console.clear') window.backendTest.emit({ type: 'adbConsole', state: { revision: (snapshot.adbConsole?.revision || 0) + 1, run: null, history: [] } })
        if (request.type === 'connection.screenApplications') return { ok: true, snapshot, screenApplications: { userId: 0, applications: [{ label: 'Example player', packageName: 'org.example.player' }, { label: 'Browser', packageName: 'org.example.browser' }] } }
        if (request.type === 'connection.screenCapabilities') return { ok: true, snapshot, screenCapabilities: { version: '3.3.4', flags: ['serial', 'window-title', 'no-audio', 'max-size', 'max-fps', 'video-bit-rate', 'video-codec', 'fullscreen', 'always-on-top', 'no-control', 'turn-screen-off', 'stay-awake', 'keyboard', 'mouse', 'gamepad', 'no-clipboard-autosync', 'audio-source', 'audio-dup', 'new-display', 'display-ime-policy', 'start-app', 'video-source', 'camera-facing', 'camera-id', 'camera-size', 'camera-fps', 'record', 'time-limit'].map(f => '--' + f) } }
        if (request.type === 'confirmation.answer') {
          if (snapshot.confirmation?.prompt?.id !== request.id) return { ok: false, snapshot, error: 'This confirmation is no longer active.' }
          window.backendTest.emit({ type: 'confirmation', state: { revision: snapshot.confirmation.revision + 1, prompt: null } })
          return { ok: true, snapshot }
        }
        if (request.type === 'diagnostics.read') return window.backendTest.diagnosticReport?.summary.id === request.id ? { ok: true, snapshot, diagnosticReport: window.backendTest.diagnosticReport } : { ok: false, snapshot, error: 'Diagnostic report unavailable.' }
        if (request.type === 'apps.permission') {
          const permissions = snapshot.apps.details?.data?.requestedPermissions
          const permission = permissions?.find(p => p.name === request.permission)
          if (permission) permission.granted = request.granted
          snapshot.appAction = { operationId: crypto.randomUUID(), startedAt: new Date().toISOString(), ...request, action: 'permission', status: 'success', message: `${request.permission}: ${request.granted ? 'Granted' : 'Denied'}` }
        }
        if (request.type === 'apps.batchAction') snapshot.appAction = { operationId: crypto.randomUUID(), startedAt: new Date().toISOString(), id: request.plan.id, userId: request.plan.userId, packageName: '', action: request.plan.action, status: 'running', message: 'Processing checked applications', completed: 0, total: request.plan.packages.length, batch: { deviceName: 'Phone', profileName: 'Owner', stopRequested: false, items: request.plan.packages.map(packageName => { const a = snapshot.apps.apps.find(a => a.packageName === packageName)!; return { packageName, label: a.label, uid: a.uid, versionCode: a.versionCode, system: a.system, status: 'pending', message: '' } }) } }
        if (request.type === 'apps.cancelAction' && snapshot.appAction?.batch) snapshot.appAction = { ...snapshot.appAction, batch: { ...snapshot.appAction.batch, stopRequested: true } }
        if (request.type === 'apps.loadPreset') {
          snapshot.presetPreview = null
          const preset = window.backendTest.presetFile
          if (preset === 'invalid') return { ok: false, error: 'Unsupported preset format or version.', snapshot }
          if (preset) {
            const existing = new Set(snapshot.apps.apps.map(app => app.packageName))
            snapshot.presetPreview = { token: `preset-${window.backendTest.requests.length}`, id: request.id, userId: request.userId, preset, matched: preset.applications.filter(app => existing.has(app.packageName)).map(app => app.packageName), missing: preset.applications.filter(app => !existing.has(app.packageName)).map(app => app.packageName) }
          }
        }
        if (request.type === 'settings.exportMode') snapshot.exportDestination = { mode: request.mode, folder: snapshot.exportDestination?.folder || (request.mode === 'fixed' ? 'C:\\Exports' : null) }
        if (request.type === 'settings.exportFolder') snapshot.exportDestination = { mode: 'fixed', folder: 'C:\\OtherExports' }
        if (request.type === 'apps.installOpen') snapshot.restore = { id: request.id, userId: request.userId, sourceKind: 'install', deviceName: 'Phone', profileName: 'Owner', status: 'choosing', message: '', source: 'C:\\Temp\\install\\manifest.json', applications: [{ packageName: 'org.example.alpha', label: 'Alpha.apk', versionName: null, versionCode: 7, components: ['apk'], installable: true }, { packageName: 'org.example.beta', label: 'Beta.apks', versionName: null, versionCode: 2, components: ['apk'], installable: true }] }
        if (request.type === 'apps.restoreOpen') snapshot.restore = { id: request.id, userId: request.userId, deviceName: 'Phone', profileName: 'Owner', status: 'choosing', message: 'Choose an application and verify its saved files.', source: 'C:\\Backups\\Phone\\User\\manifest.json', sourceDevice: 'Source phone', sourceProfile: 'Owner · ID 0', createdAt: '2026-10-04T12:00:00Z', applications: [ { packageName: 'org.example.alpha', label: 'Alpha', versionName: '1.7', versionCode: 7, components: ['apk', 'data', 'cache'], installable: true }, { packageName: 'org.example.beta', label: 'Beta', versionName: '2', versionCode: 2, components: ['data'], installable: false } ] }
        if (request.type === 'apps.restorePrepare' && snapshot.restore) { const a = snapshot.restore.applications.find(a => a.packageName === request.packageName)!; snapshot.restore = { ...snapshot.restore, status: 'ready', packageName: a.packageName, token: 'verified-token', verifiedComponents: a.components, apkCount: a.installable ? 2 : 0, message: a.installable ? 'Saved files verified. APK identity and version match the report.' : 'Saved files verified. This copy has no APK. File restoration requires the matching application to be installed.' } }
        if (request.type === 'apps.restoreFiles' && snapshot.restore) snapshot.restore = { ...snapshot.restore, status: 'success', token: undefined, operation: 'files', selectedParts: request.components, restoredParts: request.components, message: 'Restored: ' + request.components.join(', ') + '. The app remains stopped.' }
        if (request.type === 'apps.restoreInstall' && snapshot.restore) snapshot.restore = { ...snapshot.restore, status: 'success', token: undefined, message: 'Application installed. Data, cache, OBB and media were not restored.' }
        if (request.type === 'apps.restoreBatch' && snapshot.restore) snapshot.restore = { ...snapshot.restore, status: 'batch', operation: 'batch', message: 'Verifying selected applications…', batch: { finished: 0, stopRequested: false, items: request.plan.packages.map(packageName => { const a = snapshot.restore!.applications.find(a => a.packageName === packageName)!; return { packageName, label: a.label, versionCode: a.versionCode, components: request.plan.components.filter(p => a.components.includes(p)), completed: [], status: 'pending', message: '' } }) } }
        if (request.type === 'apps.restoreRetry' && snapshot.restore?.batch) snapshot.restore = { ...snapshot.restore, status: 'batch', message: 'Retrying unfinished operations…' }
        if (request.type === 'apps.restoreCancel' && snapshot.restore?.batch) { snapshot.restore = { ...snapshot.restore, batch: { ...snapshot.restore.batch, stopRequested: true } }; return { ok: true, snapshot } }
        if (request.type === 'apps.restoreCancel' && snapshot.restore) snapshot.restore = { ...snapshot.restore, status: 'cancelled', token: undefined, message: 'Verification cancelled. Nothing was installed.' }
        if (request.type === 'apps.backup' || request.type === 'apps.savePreset') snapshot.backup = {
          id: request.selection.id, userId: request.selection.userId, name: request.selection.name || request.selection.folderName || 'APK backup', format: request.selection.format, zip: !!request.selection.zip, contents: request.selection.contents, stopApps: request.selection.stopApps, allowPartial: request.selection.allowPartial,
          operation: request.type === 'apps.backup' ? 'backup' : 'preset', status: 'complete', message: request.type === 'apps.backup' ? 'APK backup saved.' : 'Preset saved.',
          completed: request.selection.packages.length, total: request.selection.packages.length,
          items: request.selection.packages.map(packageName => ({ packageName, label: snapshot.apps.apps.find(app => app.packageName === packageName)?.label || packageName, status: 'success' })),
          outputDirectory: 'C:\\Backups', presetPath: request.type === 'apps.savePreset' ? 'C:\\Backups\\preset.json' : undefined,
          archivePath: request.selection.zip ? 'C:\\Backups\\Phone\\User.zip' : undefined,
        }
        if (request.type === 'apps.cancelBackup' && snapshot.backup) snapshot.backup = { ...snapshot.backup, status: 'cancelled', message: 'Backup cancelled.' }

        if (request.type === 'apps.details') {
          const app = snapshot.apps.apps.find(a => a.packageName === request.packageName)!
          snapshot.apps.details = { deviceId: request.id, userId: request.userId, packageName: request.packageName, status: 'ready', error: null, collectedAt: new Date().toISOString(), data: {
            packageName: request.packageName, userId: request.userId, uid: app.uid,
            fields: { processName: request.packageName, primaryCpuAbi: 'arm64-v8a', mainActivity: `${request.packageName}/.MainActivity`, flagsHex: '0x00000004', hiddenApiPolicy: '2', seInfo: 'default:targetSdkVersion=35', linkHandling: 'Allowed' },
            flags: ['FLAG_HAS_CODE'], badges: { testOnly: false, noCode: false, largeHeap: true, hidden: null, openLinks: true },
            paths: [{ name: 'Base APK', path: app.sourceDir || '/data/app/base.apk' }, { name: 'Data directory', path: `/data/user/${request.userId}/${request.packageName}` }],
            splits: app.splitCount ? [{ name: 'config.arm64_v8a', path: '/data/app/example/split_config.arm64_v8a.apk', bytes: 1024 }] : [],
            installers: [{ role: 'Installer of record', label: 'Package Installer', packageName: 'com.android.packageinstaller' }, { role: 'Initiating installer', label: 'Package Installer', packageName: 'com.android.packageinstaller' }, { role: 'Originating source', label: null, packageName: null }],
            storage: { requested: !!app.storageRequested, appBytes: app.storageError ? null : 10485760, dataBytes: app.dataBytes ?? null, cacheBytes: app.cacheBytes ?? null },
            network: { start: 1700000000000, end: 1702592000000, wifi: { rx: 1048576, tx: 0 }, mobile: null },
            links: [{ host: 'example.org', state: 'Verified' }], issues: [{ area: 'Mobile traffic', message: 'Access denied' }, ...(app.storageError ? [{ area: 'Storage', message: app.storageError }] : [])],
          } }
        }
        if (request.type === 'connection.root') snapshot.connection.devices = snapshot.connection.devices.map(d => d.id === request.id ? { ...d, root: { status: request.requestAccess ? 'available' : 'detected', method: 'su', checkedAt: new Date().toISOString(), message: request.requestAccess ? 'Root access for Shell/ADB was confirmed on this device.' : 'A root command was found. Check access to verify permission for Shell/ADB.' } } : d)
        if (request.type === 'connection.info') snapshot.connection.devices = snapshot.connection.devices.map(d => d.id === request.id ? { ...d, info: { status: 'ready', collectedAt: new Date().toISOString(), fields: { manufacturer: 'Test vendor', model: d.name, sdk: '36', securityPatch: '2026-09-01', build: 'TEST.001', fingerprint: 'test/device/build', abis: 'arm64-v8a' } } } : d)
        if (request.type === 'components.adbDiagnostics') snapshot.adbDiagnostics = { status: 'ready', collectedAt: new Date().toISOString(), executable: 'C:\\Test\\platform-tools\\adb.exe', fields: { clientVersion: '37.0.1-123', protocol: '1.0.41', serverStatus: 'Responding', version: '37.0.1', usb_backend: 'LIBADBUSB', mdns_backend: 'LIBADBMDNS', mdns_enabled: 'true' }, services: [{ name: 'adb-test', type: '_adb-tls-connect._tcp', address: '192.168.1.9:37123' }], servicesAvailable: true, issues: [] }
        if (request.type === 'settings.notifications') snapshot.notifications = request.settings
        if (request.type === 'settings.stopAdbOnExit') snapshot.stopAdbOnExit = request.enabled
        if (request.type === 'settings.apkZstd') snapshot.apkZstd = request.enabled
        if (request.type === 'apps.options') snapshot.apps.options = request.options
        if (request.type === 'apps.loadingMode') snapshot.apps.loadingMode = request.mode
        if (request.type === 'apps.refresh' || request.type === 'apps.selectProfile') snapshot.apps = { ...snapshot.apps, details: null, deviceId: request.id, userId: request.userId ?? snapshot.apps.userId ?? 0, currentUserId: 0, profiles: snapshot.apps.profiles.length ? snapshot.apps.profiles : [{ id: 0, name: 'Owner', managed: false, running: true }], status: 'ready', apps: snapshot.apps.apps, error: null, collectedAt: new Date().toISOString(), elapsedMs: 123, warnings: 0, locale: 'en-US' }
        if (request.type === 'apps.cancel') snapshot.apps = { ...snapshot.apps, status: 'idle', apps: [], message: 'Collection cancelled.' }
        if (request.type === 'components.locate') return { ok: false, error: 'Selected folder does not contain a valid executable.', snapshot }
        if (request.type === 'components.action' || request.type === 'components.installAll') {
          snapshot.components = snapshot.components.map(c => request.type === 'components.installAll' || request.id === c.id ? { ...c, status: 'Installed', location: 'C:\\Test\\managed', version: '37.0.1' } : c)
        }
        if (request.type === 'connection.qr') snapshot.connection.qr = { payload: 'WIFI:T:ADB;S:studio-test;P:test-secret;;', expiresAt: Date.now() + 120000, status: 'waiting', message: 'Waiting for the phone.' }
        if (request.type === 'connection.cancelQr') snapshot.connection.qr = null
        if (request.type === 'connection.pair') snapshot.connection.message = 'Pairing succeeded. Waiting for the connection service.'
        if (request.type === 'connection.select') snapshot.connection.activeDeviceId = request.id
        if (request.type === 'connection.disconnect') { snapshot.connection.devices = snapshot.connection.devices.map(d => d.id === request.id ? { ...d, status: 'disconnected' } : d); snapshot.connection.activeDeviceId = null }
        if (request.type === 'connection.forget') snapshot.connection.devices = snapshot.connection.devices.filter(d => d.id !== request.id)
        return { ok: true, snapshot }
      },
    }
  }, componentCatalog)
}
export async function connectionEvent(page: Page, patch: Partial<ConnectionSnapshot>) {
  await page.evaluate(patch => window.backendTest.emit({ type: 'connection', connection: { ...window.backendTest.snapshot.connection, ...patch } }), patch)
}
