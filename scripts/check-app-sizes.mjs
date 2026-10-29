import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { run, checked } from '../dist-electron/process.js'
import { parseDevices } from '../dist-electron/connections.js'
const inventory = JSON.parse(await readFile('desktop-test-results/apps/inventory.json', 'utf8'))
const config = JSON.parse(await readFile(path.join(process.env.APPDATA, 'adb-vault/backend.json'), 'utf8'))
const adb = path.join(config.paths.adb, 'adb.exe')
const devices = parseDevices(checked(await run(adb, ['devices', '-l'])))
const device = devices.find(d => d.id === inventory.deviceId && d.status === 'connected')
assert.ok(device, 'Inventory device is no longer connected')
const samples = [inventory.apps.find(a => a.splitCount === 0 && a.apkSizeBytes > 0), inventory.apps.find(a => a.splitCount > 0 && a.apkSizeBytes > 0)].filter(Boolean)
const quote = s => "'" + s.replaceAll("'", "'\\''") + "'"
const verified = []
for (const app of samples) {
  const result = checked(await run(adb, ['-s', device.serial, 'shell', 'pm', 'path', '--user', String(inventory.userId), app.packageName]))
  const paths = [...new Set(result.split(/\r?\n/).filter(p => p.startsWith('package:')).map(p => p.slice(8)))]
  assert.equal(paths.length, app.splitCount + 1)
  const sizes = checked(await run(adb, ['-s', device.serial, 'shell', `stat -c %s ${paths.map(quote).join(' ')}`])).trim().split(/\s+/).map(Number)
  assert.equal(sizes.length, paths.length)
  assert.ok(sizes.every(n => Number.isSafeInteger(n) && n > 0))
  assert.equal(sizes.reduce((a,b) => a+b, 0), app.apkSizeBytes)
  verified.push({ packageName: app.packageName, files: paths.length, bytes: app.apkSizeBytes })
}
const report = { total: inventory.apps.length, availableSizes: inventory.apps.filter(a => a.apkSizeBytes > 0).length, splitApps: inventory.apps.filter(a => a.splitCount > 0).length, verified }
await writeFile('desktop-test-results/apps/size-report.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report))
