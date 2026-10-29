// Read-only audit: package metadata and declared entry screens; never starts an application.
import assert from 'node:assert/strict'
import { readFile, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { AppsService } from '../dist-electron/apps.js'
import { parseDevices } from '../dist-electron/connections.js'
import { run, checked } from '../dist-electron/process.js'
import { parseAndroidProfiles } from '../dist-electron/app-profiles.js'

const settings = JSON.parse(await readFile(path.join(process.env.APPDATA, 'adb-vault/backend.json'), 'utf8'))
const adb = path.join(settings.paths.adb, 'adb.exe')
const devices = parseDevices(checked(await run(adb, ['devices', '-l'])))
assert.equal(devices.filter(d => d.status === 'connected').length, 1, 'Connect exactly one phone for this audit.')
const device = devices.find(d => d.status === 'connected')
const root = await mkdtemp(path.resolve('desktop-test-results/app-launch-audit-'))
const shell = async args => checked(await run(adb, ['-t', device.transportId, 'shell', ...args], 30000))
const currentUser = Number((await shell(['am', 'get-current-user'])).trim())
const profiles = parseAndroidProfiles(await shell(['pm', 'list', 'users']))
const connection = { devices, activeDeviceId: device.id, busy: false, scanning: false, error: null, message: '', qr: null, adbAvailable: true }
const service = new AppsService(path.resolve('android-helper/dist'), () => adb, () => connection, () => {})
service.configureOptions({ icons: false, early: false, storage: false })
const reports = []
for (const profile of profiles.filter(p => p.running || p.id === currentUser)) {
  await service.refresh(device.id, profile.id)
  assert.equal(service.state.status, 'ready', service.state.error)
  const entries = {}
  for (const category of ['INFO', 'LAUNCHER', 'LEANBACK_LAUNCHER', 'DEFAULT']) {
    const text = await shell(['cmd', 'package', 'query-activities', '--brief', '--components', '--user', String(profile.id), '-a', 'android.intent.action.MAIN', '-c', `android.intent.category.${category}`])
    entries[category] = text.split(/\r?\n/).map(line => line.trim()).filter(line => /^[A-Za-z0-9_.$]+\/[A-Za-z0-9_.$]+$/.test(line))
  }
  const apps = service.state.apps.map(app => ({ packageName: app.packageName, label: app.label, enabled: app.enabled, suspended: app.suspended, system: app.system || app.updatedSystemApp, entries: Object.fromEntries(Object.entries(entries).map(([category, items]) => [category, items.filter(item => item.startsWith(app.packageName + '/'))])) }))
  const launchable = apps.filter(app => ['INFO', 'LAUNCHER', 'LEANBACK_LAUNCHER'].some(category => app.entries[category].length))
  const report = { userId: profile.id, current: profile.id === currentUser, total: apps.length, launchable: launchable.length, noLauncher: apps.length - launchable.length, multipleEntries: launchable.filter(app => ['INFO', 'LAUNCHER', 'LEANBACK_LAUNCHER'].some(category => app.entries[category].length > 1)), apps }
  reports.push(report)
  console.log(JSON.stringify({ userId: report.userId, current: report.current, total: report.total, launchable: report.launchable, noLauncher: report.noLauncher, multipleEntries: report.multipleEntries.map(app => app.packageName), relevant: apps.filter(app => /health|fitness|bluetooth|mi_connect|здоров|спорт|mi connect/i.test(app.packageName + ' ' + app.label)) }, null, 2))
}
const inspectedPackages = ['com.mi.healthglobal', 'com.google.android.apps.healthdata', 'com.google.android.healthconnect.controller', 'com.xiaomi.bluetooth', 'com.android.bluetooth', 'com.xiaomi.mi_connect_service']
for (const pkg of inspectedPackages) await writeFile(path.join(root, `${pkg}.txt`), await shell(['dumpsys', 'package', pkg]))
await writeFile(path.join(root, 'report.json'), JSON.stringify({ collectedAt: new Date().toISOString(), currentUser, reports }, null, 2))
await writeFile('desktop-test-results/app-launch-audit-latest.json', JSON.stringify({ root }))
console.log(`Launch audit saved: ${root}`)
