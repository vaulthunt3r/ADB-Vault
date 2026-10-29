// Opt-in read-only inventory check. Uploads only our short-lived helper JAR, never an APK.
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { AppsService } from '../dist-electron/apps.js'
import { parseDevices } from '../dist-electron/connections.js'
import { run, checked } from '../dist-electron/process.js'
import { parseAndroidProfiles } from '../dist-electron/app-profiles.js'
const profile = JSON.parse(await readFile(path.join(process.env.APPDATA, 'adb-vault/backend.json'), 'utf8'))
const adb = path.join(profile.paths.adb, 'adb.exe')
const devices = parseDevices(checked(await run(adb, ['devices', '-l'])))
const device = devices.find(d => d.status === 'connected' && d.method === 'USB') || devices.find(d => d.status === 'connected')
assert.ok(device, 'No authorized connected Android device. Connect USB or Wi-Fi and retry.')
const profiles = parseAndroidProfiles(checked(await run(adb, ['-s', device.serial, 'shell', 'pm', 'list', 'users'])))
console.log('Android profiles:', JSON.stringify(profiles))
if (process.argv.includes('--list-profiles')) process.exit(0)
const userArg = process.argv.find(arg => arg.startsWith('--user='))
const userId = userArg === undefined ? undefined : Number(userArg.slice(7))
const connection = { devices, activeDeviceId: device.id, busy: false, scanning: false, error: null, message: '', qr: null, adbAvailable: true }
const calls = []
const progressSamples = []
let lastMessage = ''
await mkdir('desktop-test-results/apps', { recursive: true })
const service = new AppsService(path.resolve('android-helper/dist'), () => adb, () => connection, event => {
  if (event.type !== 'apps') return
  if (event.apps.message && event.apps.message !== lastMessage) console.log(event.apps.message)
  lastMessage = event.apps.message
  if (event.apps.progress) progressSamples.push({ ...event.apps.progress })
}, async (...args) => { calls.push(args[1]); const result = await run(...args); if (args[1].some(v => v.includes('app_process'))) await writeFile('desktop-test-results/apps/helper-stderr.txt', result.stderr); return result })
service.configureOptions({ icons: !process.argv.includes('--no-icons'), early: false, storage: process.argv.includes('--storage') })
const reports = []
for (let pass = 0; pass < (process.argv.includes('--once') ? 1 : 2); pass++) {
  calls.length = 0
  progressSamples.length = 0
  const started = performance.now()
  await service.refresh(device.id, userId)
  assert.equal(service.state.status, 'ready')
  const apps = service.state.apps, removedApps = service.state.removedApps || [], total = apps.length + removedApps.length
  assert.ok(progressSamples.length > 0, 'No streamed application progress received')
  assert.equal(progressSamples[0].completed, 0)
  assert.equal(progressSamples.at(-1).completed, total)
  for (let index = 0; index < progressSamples.length; index++) {
    assert.equal(progressSamples[index].total, total)
    if (index) assert.ok(progressSamples[index].completed >= progressSamples[index - 1].completed)
  }
  assert.equal(service.state.progress, null)
  console.log('Streamed progress:', JSON.stringify({ updates: progressSamples.length, first: progressSamples[0], last: progressSamples.at(-1) }))
  const kinds = apps.reduce((counts, app) => { const kind = app.iconType || 'unavailable'; counts[kind] = (counts[kind] || 0) + 1; return counts }, {})
  const report = { pass: pass + 1, transport: device.method, packages: apps.length, notInstalled: removedApps.length, restorable: removedApps.filter(a => a.apkSizeBytes > 0).length, system: apps.filter(a => a.system).length, user: apps.filter(a => !a.system && !a.updatedSystemApp).length, updatedSystem: apps.filter(a => a.updatedSystemApp).length, disabled: apps.filter(a => !a.enabled).length, storageAvailable: apps.filter(a => a.cacheBytes != null).length, storageError: apps.find(a => a.storageError)?.storageError, icons: apps.filter(a => a.iconPng).length, iconTypes: kinds, warnings: service.state.warnings, locale: service.state.locale, elapsedMs: Math.round(performance.now() - started), deviceCollectionMs: service.state.elapsedMs, adbCalls: calls.length, pushes: calls.filter(a => a.includes('push')).length, helperSessions: calls.filter(a => a.some(v => v.includes('app_process'))).length }
  assert.equal(report.helperSessions, 1)
  if (pass === 1) assert.equal(report.pushes, 0)
  reports.push(report); console.log(JSON.stringify(report))
}
const packages = checked(await run(adb, ['-s', device.serial, 'shell', 'pm', 'list', 'packages', '--user', String(service.state.userId)]))
const expected = packages.split(/\r?\n/).filter(line => line.startsWith('package:')).map(line => line.slice(8)).sort()
assert.deepEqual(service.state.apps.map(a => a.packageName).sort(), expected, 'Inventory differs from PackageManager shell list')
const allPackages = checked(await run(adb, ['-s', device.serial, 'shell', 'pm', 'list', 'packages', '-u', '--user', String(service.state.userId)]))
const known = allPackages.split(/\r?\n/).filter(line => line.startsWith('package:')).map(line => line.slice(8)).sort()
assert.deepEqual([...service.state.apps, ...(service.state.removedApps || [])].map(a => a.packageName).sort(), known, 'Known-package inventory differs from pm list packages -u')
assert.ok((service.state.removedApps || []).every(app => app.installed === false))
const processes = checked(await run(adb, ['-s', device.serial, 'shell', 'ps', '-A', '-o', 'ARGS']))
assert.equal(processes.includes('dev.adbvault.helper.Main'), false, 'Helper did not exit')
await mkdir('desktop-test-results/apps', { recursive: true })
await writeFile('desktop-test-results/apps/hardware-report.json', JSON.stringify({ reports, matchesPackageManager: true, helperExited: true }, null, 2))
await writeFile('desktop-test-results/apps/inventory.json', JSON.stringify(service.state))
console.log('Package coverage matches pm list packages; helper process exited.')
