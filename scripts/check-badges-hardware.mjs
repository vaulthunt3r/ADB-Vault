// Read-only checks; no app launches, overlay switches, force-stops or permission grants.
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
assert.ok(device, 'No authorized connected Android device.')
const command = async args => checked(await run(adb, ['-s', device.serial, 'shell', ...args], 20000))
const userId = Number((await command(['am', 'get-current-user'])).trim())
assert.ok(Number.isInteger(userId) && userId >= 0)
const installed = new Set((await command(['pm', 'list', 'packages', '--user', String(userId)])).split(/\r?\n/).filter(s => s.startsWith('package:')).map(s => s.slice(8).trim()))
let overlayPackages = []
try { overlayPackages = (await command(['cmd', 'overlay', 'list', '--user', String(userId)])).split(/\r?\n/).map(s => s.match(/^\s*\[[ x]\]\s+([\w.]+)\s*$/)?.[1]).filter(p => installed.has(p)) } catch { /* reported by actual checks below */ }
let legacyPackage
try {
  // Cached inventory is only a candidate selector; each result is freshly queried and validated below.
  const old = JSON.parse(await readFile('desktop-test-results/apps/inventory.json', 'utf8'))
  legacyPackage = old.apps.find(app => app.targetSdk > 0 && app.targetSdk < 29 && installed.has(app.packageName))?.packageName
} catch { }
const targets = [...new Set(['com.android.systemui', 'com.android.chrome', 'ru.fourpda.client', overlayPackages[0], legacyPackage].filter(p => installed.has(p)))]
assert.ok(targets.length)
const snapshot = { ...emptyApps(), deviceId: device.id, userId, status: 'ready', apps: targets.map(packageName => ({ packageName })) }
let state
const reader = new AppDetailsReader(path.resolve('android-helper/dist'), () => adb, () => ({ devices, activeDeviceId: device.id }), () => snapshot, value => { state = value })
const results = []
for (const packageName of targets) {
  await reader.read(device.id, userId, packageName)
  assert.equal(state.status, 'ready', state.error || 'Details read failed')
  const { overlay, wx, running } = state.data.badgeChecks
  assert.ok(overlay && wx && running)
  const api = Object.fromEntries(wx.items.map(item => [item.name, item.value]))
  assert.equal(wx.present, Number(api['Android API']) >= 29 && Number(api['Target SDK']) < 29)
  if (overlayPackages.includes(packageName)) assert.equal(overlay.present, true, 'OverlayManager package not detected as overlay')
  if (running.present === true) {
    assert.ok(running.items.some(item => /(?:Process|Service) · PID \d+ · UID \d+/.test(item.value)))
    for (const item of running.items) assert.equal(Math.floor(Number(item.value.match(/UID (\d+)/)?.[1]) / 100000), userId)
  }
  results.push({ packageName, userId, overlay, wx, running })
  console.log(JSON.stringify(results.at(-1)))
}
await mkdir('desktop-test-results/badges', { recursive: true })
await writeFile('desktop-test-results/badges/collectors.json', JSON.stringify({ checkedAt: new Date().toISOString(), transport: device.method, results }, null, 2))
