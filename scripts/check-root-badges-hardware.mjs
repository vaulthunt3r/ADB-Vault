import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { AppDetailsReader } from '../dist-electron/app-details.js'
import { emptyApps } from '../dist-electron/apps-protocol.js'
import { parseDevices } from '../dist-electron/connections.js'
import { checked, run } from '../dist-electron/process.js'

const config = JSON.parse(await readFile(path.join(process.env.APPDATA, 'adb-vault/backend.json'), 'utf8'))
const adb = path.join(config.paths.adb, 'adb.exe')
const device = parseDevices(checked(await run(adb, ['devices', '-l']))).find(d => d.status === 'connected')
if (!device) throw new Error('Connect and authorize a test phone first.')
const packages = ['ru.fourpda.client', 'com.android.vending']
const apps = { ...emptyApps(), deviceId: device.id, userId: 0, status: 'ready', apps: packages.map(packageName => ({ packageName })), options: { icons: false, early: false, storage: false, root: true } }
const connection = { devices: [device], activeDeviceId: device.id }
let state
const reader = new AppDetailsReader(path.resolve('android-helper/dist'), () => adb, () => connection, () => apps, value => { state = value })
const report = []
for (const packageName of packages) {
  await reader.read(device.id, 0, packageName)
  if (state.status !== 'ready') throw new Error(state.error)
  // Keep identifiers, aliases and URI values out of the saved test report.
  const checks = Object.fromEntries(['ssaid', 'keyStore', 'magiskDenyList', 'systemless', 'hidden', 'saf'].map(key => {
    const c = state.data.badgeChecks?.[key]
    return [key, c ? { present: c.present, evidenceCount: c.items.length, reason: c.reason } : null]
  }))
  report.push({ packageName, checks }); console.log(JSON.stringify(report.at(-1), null, 2))
}
await mkdir('desktop-test-results/root-device', { recursive: true })
await writeFile('desktop-test-results/root-device/integrated-badges.json', JSON.stringify(report, null, 2))
