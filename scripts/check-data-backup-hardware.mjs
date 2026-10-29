// Explicit opt-in hardware check. Stops SD Maid, copies files, never clears/restores data.
import assert from 'node:assert/strict'
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { AppBackupService } from '../dist-electron/app-backup.js'
import { BackupCatalog } from '../dist-electron/backup-catalog.js'
import { emptyApps } from '../dist-electron/apps-protocol.js'
import { parseDevices } from '../dist-electron/connections.js'
import { checked, run } from '../dist-electron/process.js'

assert.ok(process.argv.includes('--stop-sd-maid'), 'Requires explicit consent: --stop-sd-maid')
const config = JSON.parse(await readFile(path.join(process.env.APPDATA, 'adb-vault/backend.json'), 'utf8'))
const adb = path.join(config.paths.adb, 'adb.exe')
const devices = parseDevices(checked(await run(adb, ['devices', '-l']))).filter(d => d.status === 'connected')
assert.equal(devices.length, 1, 'Connect exactly one test device')
const device = devices[0], pkg = 'eu.thedarken.sdm', userId = 0
const shell = async cmd => checked(await run(adb, ['-t', device.transportId, 'shell', '-T', cmd], 30000)).trim()
assert.equal(await shell('am get-current-user'), String(userId))
assert.match(await shell('su -c id'), /^uid=0\b/)
device.hardwareId = await shell('getprop ro.serialno')
assert.ok(device.hardwareId, 'Hardware identity is required')
const dump = await shell(`dumpsys package ${pkg}`)
const uid = Number(/\buserId=(\d+)/.exec(dump)?.[1])
assert.ok(Number.isSafeInteger(uid) && uid >= 10000 && uid < 100000)
const app = { packageName: pkg, userId, uid, label: 'SD Maid', system: false, enabled: true,
  versionName: /versionName=([^\r\n]+)/.exec(dump)?.[1]?.trim() || null,
  versionCode: Number(/versionCode=(\d+)/.exec(dump)?.[1]), minSdk: 21, targetSdk: 31 }
assert.ok(Number.isSafeInteger(app.versionCode))
const connection = { devices: [device], activeDeviceId: device.id }
// Root permission applies to this opt-in check only; live application preferences stay unchanged.
const apps = { ...emptyApps(), status: 'ready', deviceId: device.id, userId, apps: [app],
  profiles: [{ id: userId, name: 'Owner' }], options: { icons: false, early: false, storage: false, root: true } }
await mkdir('desktop-test-results/data-backup', { recursive: true })
const root = await mkdtemp(path.resolve('desktop-test-results/data-backup/sd-maid-'))
const catalogue = new BackupCatalog(path.join(root, 'catalogue')); await catalogue.load()
let previous = ''
const service = new AppBackupService(() => adb, () => connection, () => apps, state => {
  if (state.message !== previous) { previous = state.message; console.log(previous) }
}, () => {}, { folder: async () => root, presetFile: async () => null }, run, catalogue)
await service.execute({ id: device.id, userId, packages: [pkg], name: 'SD Maid check', format: 'auto',
  contents: { apk: true, data: true, cache: true, obb: true, media: true }, stopApps: true, allowPartial: true }, false)
const state = service.state
await writeFile(path.join(root, 'result.json'), JSON.stringify(state, null, 2))
const check = catalogue.check(device, app)
console.log(JSON.stringify({ status: state.status, outputDirectory: state.outputDirectory,
  parts: state.items[0].parts, backupBadge: check.present,
  savedContents: check.items.filter(i => i.name === 'Contents').map(i => i.value) }, null, 2))
assert.equal(state.status, 'complete', 'Check result.json for hardware failure details')
assert.equal(check.present, true)
