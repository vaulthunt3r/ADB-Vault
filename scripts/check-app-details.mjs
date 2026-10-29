import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { run, checked } from '../dist-electron/process.js'
import { parseDevices } from '../dist-electron/connections.js'
import { AppDetailsReader } from '../dist-electron/app-details.js'
import { emptyApps } from '../dist-electron/apps-protocol.js'
const config = JSON.parse(await readFile(path.join(process.env.APPDATA, 'adb-vault/backend.json'), 'utf8'))
const adb = path.join(config.paths.adb, 'adb.exe')
const device = parseDevices(checked(await run(adb, ['devices', '-l']))).find(d => d.status === 'connected')
if (!device) { console.log('NO_CONNECTED_DEVICE'); process.exit(0) }
const command = async args => checked(await run(adb, ['-s', device.serial, ...args], 15000))
const profileArgument = process.argv.find(arg => /^--user=/.test(arg))
const userId = profileArgument ? Number(profileArgument.slice(7)) : Number(await command(['shell', 'am', 'get-current-user']))
if (!Number.isInteger(userId) || userId < 0 || userId > 99999) throw new Error('Invalid current user')
const packages = (await command(['shell', 'pm', 'list', 'packages', '--user', String(userId), '-3'])).split(/\r?\n/).filter(s => s.startsWith('package:')).map(s => s.slice(8))
const scan = process.argv.includes('--scan'); const requested = process.argv.slice(2).filter(a => a !== '--scan' && !a.startsWith('--user='))
const targets = requested.length ? requested : [...new Set(['com.android.settings', ...packages.slice(0, 2)])]
const connection = { activeDeviceId: device.id, devices: [device] }
const snapshot = { ...emptyApps(), deviceId: device.id, userId, status: 'ready', options: { icons: false, early: false, storage: true }, apps: targets.map(packageName => ({ packageName })) }
const reader = new AppDetailsReader(path.resolve('android-helper/dist'), () => adb, () => connection, () => snapshot, details => { snapshot.details = details })
const results = []
for (const packageName of targets) { await reader.read(device.id, userId, packageName, scan); results.push(snapshot.details) }
await mkdir('desktop-test-results/app-details', { recursive: true })
await writeFile('desktop-test-results/app-details/report.json', JSON.stringify(results, null, 2))
if (scan) await writeFile(`desktop-test-results/app-details/scan-user-${userId}.json`, JSON.stringify(results, null, 2))
console.log(JSON.stringify(results.map(r => ({ packageName: r.packageName, userId, status: r.status, error: r.error, analysis: r.data?.analysis ? { status: r.data.analysis.status, error: r.data.analysis.error, classes: r.data.analysis.classes, trackers: r.data.analysis.trackers.map(t => ({ name: t.name, count: t.count })), libraries: r.data.analysis.libraries.length, native: r.data.analysis.native.length, artifacts: r.data.analysis.artifacts, issues: r.data.analysis.issues } : undefined, fields: Object.keys(r.data?.fields || {}), badges: r.data?.badges, pathCount: r.data?.paths.length, splitCount: r.data?.splits.length, storage: r.data?.storage, network: r.data?.network, issues: r.data?.issues })), null, 2))
if (results.some(r => r.status !== 'ready' || scan && r.data?.analysis?.status !== 'complete')) process.exitCode = 1
