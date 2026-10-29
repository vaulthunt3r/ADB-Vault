// Read-only, opt-in check. Uses the normal Details reader and its verified helper upload.
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { AppDetailsReader } from '../dist-electron/app-details.js'
import { emptyApps } from '../dist-electron/apps-protocol.js'
import { parseDevices } from '../dist-electron/connections.js'
import { run, checked } from '../dist-electron/process.js'

const config = JSON.parse(await readFile(path.join(process.env.APPDATA, 'adb-vault/backend.json'), 'utf8'))
const adb = path.join(config.paths.adb, 'adb.exe')
const devices = parseDevices(checked(await run(adb, ['devices', '-l'])))
const device = devices.find(d => d.status === 'connected' && d.method === 'USB') || devices.find(d => d.status === 'connected')
assert.ok(device, 'No authorized connected Android device; hardware verification unavailable.')
const userId = Number(checked(await run(adb, ['-s', device.serial, 'shell', 'am', 'get-current-user'])).trim())
assert.ok(Number.isInteger(userId) && userId >= 0)
const installed = new Set(checked(await run(adb, ['-s', device.serial, 'shell', 'pm', 'list', 'packages', '--user', String(userId)])).split(/\r?\n/).filter(s => s.startsWith('package:')).map(s => s.slice(8).trim()))
const targets = ['com.android.chrome', 'com.google.android.youtube', 'ru.fourpda.client', 'com.android.settings'].filter(p => installed.has(p))
assert.ok(targets.length, 'No target package found for this check.')
const snapshot = { ...emptyApps(), deviceId: device.id, userId, status: 'ready', apps: targets.map(packageName => ({ packageName })) }
const connection = { devices, activeDeviceId: device.id }
let state
const reader = new AppDetailsReader(path.resolve('android-helper/dist'), () => adb, () => connection, () => snapshot, value => { state = value })
const results = []
for (const packageName of targets) {
  await reader.read(device.id, userId, packageName)
  assert.equal(state.status, 'ready', state.error || 'Details read failed')
  const check = state.data.badgeChecks.playAppSigning
  assert.ok(check, 'New helper did not return the stamp check')
  if (check.present !== null) {
    const fields = Object.fromEntries(check.items.map(item => [item.name, item.value]))
    assert.equal(check.present, fields['com.android.stamp.type'] === 'STAMP_TYPE_DISTRIBUTION_APK' && fields['com.android.stamp.source'] === 'https://play.google.com/store')
  }
  results.push({ packageName, userId, transport: device.method, ...check })
  console.log(JSON.stringify(results.at(-1)))
}
await mkdir('desktop-test-results/badges', { recursive: true })
await writeFile('desktop-test-results/badges/play-signing.json', JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2))
