// Installs only our test-only, permission-free probe, validates an owned virtual display, then removes it.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { DeviceScreenService } from '../dist-electron/device-screen.js'
import { TouchStream } from '../dist-electron/touch-stream.js'
import { parseDevices } from '../dist-electron/connections.js'
import { screenLaunch } from '../dist-electron/screen-protocol.js'
import { run, checked } from '../dist-electron/process.js'
const delay = ms => new Promise(r => setTimeout(r, ms))
const root = await mkdtemp(path.resolve('desktop-test-results/touch-hardware-'))
const tools = JSON.parse(await readFile('.tools/helper/paths.json', 'utf8')), buildTools = path.dirname(path.dirname(tools.d8))
const command = async (file, args, timeout = 30000) => checked(await run(file, args, timeout))
const classes = path.join(root, 'classes'); await mkdir(classes)
await command(tools.javac, ['-encoding', 'UTF-8', '-source', '8', '-target', '8', '-bootclasspath', tools.android, '-d', classes, 'scripts/fixtures/TouchProbe.java'])
await command(tools.jar, ['cf', path.join(root, 'classes.jar'), '-C', classes, 'dev'])
await command(tools.java, ['-cp', tools.d8, 'com.android.tools.r8.D8', '--min-api', '26', '--lib', tools.android, '--output', root, path.join(root, 'classes.jar')])
const manifest = path.join(root, 'AndroidManifest.xml'), apk = path.join(root, 'probe.apk'), signed = path.join(root, 'signed.apk')
await writeFile(manifest, '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="dev.adbvault.touchprobe"><uses-sdk android:minSdkVersion="26" android:targetSdkVersion="35"/><application android:theme="@android:style/Theme.Material.NoActionBar" android:label="ADB Vault touch test" android:testOnly="true" android:debuggable="true" android:allowBackup="false" android:resizeableActivity="true"><activity android:name=".TouchProbe" android:exported="true"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity></application></manifest>')
await command(path.join(buildTools, 'aapt2.exe'), ['link', '-I', tools.android, '--manifest', manifest, '-o', apk])
// Keep classes.dex at the archive root.
await command(tools.jar, ['uf', apk, '-C', root, 'classes.dex'])
const key = path.join(root, 'test.p12')
await command(path.join(path.dirname(tools.java), 'keytool.exe'), ['-genkeypair', '-keystore', key, '-storepass', 'test-only', '-keypass', 'test-only', '-alias', 'probe', '-dname', 'CN=ADB Vault temporary test', '-keyalg', 'RSA', '-validity', '1'])
await command(tools.java, ['-jar', path.join(buildTools, 'lib/apksigner.jar'), 'sign', '--ks', key, '--ks-pass', 'pass:test-only', '--out', signed, apk])
if (process.argv.includes('--build-only')) { console.log(signed); process.exit(0) }
const saved = JSON.parse(await readFile(path.join(process.env.APPDATA, 'adb-vault/backend.json'), 'utf8'))
const adb = path.join(saved.paths.adb, 'adb.exe'), scrcpy = path.join(saved.paths.scrcpy, 'scrcpy.exe')
const devices = parseDevices(await command(adb, ['devices', '-l'])).filter(d => d.status === 'connected')
assert.equal(devices.length, 1, 'Connect exactly one phone for this test.')
const device = devices[0], selector = ['-t', device.transportId], shell = args => command(adb, [...selector, 'shell', ...args])
const existing = await run(adb, [...selector, 'shell', 'pm', 'path', 'dev.adbvault.touchprobe'], 15000)
assert.ok(existing.code === 0 || existing.code === 1); assert.equal(existing.stdout.trim(), '', 'Test package already exists; leave it unchanged.')
const userId = Number((await shell(['am', 'get-current-user'])).trim())
const connection = { devices, activeDeviceId: device.id, busy: false }, capture = path.join(root, 'test.mkv')
let child, output = '', stream, installed = false
const service = new DeviceScreenService(() => adb, () => scrcpy, () => connection, () => {}, async () => capture, run,
 (file, args, config) => { child = spawn(file, [...args, '--no-window'], config); child.stdout.on('data', c => output += c); child.stderr.on('data', c => output += c); return child })
const states = [], errors = []
try {
  assert.match(await command(adb, [...selector, 'install', '-t', '--user', String(userId), signed]), /Success/); installed = true
  await service.execute(device, 'open', { ...screenLaunch(), mode: 'virtual', virtualSize: '800x600', audio: 'off', clipboard: false, record: true, timeLimit: 25, application: { packageName: 'dev.adbvault.touchprobe', userId } })
  for (let i = 0; i < 100 && !service.state[0]?.virtualDisplayId; i++) { assert.equal(child.exitCode, null, output); await delay(100) }
  const id = service.state[0].id, target = service.touchTarget(id)
  stream = new TouchStream(path.resolve('android-helper/dist'), () => service.touchTarget(id), (state, error) => { if (state) states.push(state); if (error) errors.push(error) })
  await stream.start()
  for (let i = 0; i < 100 && !stream.geometry && !errors.length; i++) await delay(100)
  assert.deepEqual(errors, []); assert.ok(stream.geometry, output)
  const epoch = stream.geometry.epoch
  const points = [{ id: 0, x: .2, y: .7 }, { id: 2, x: .8, y: .7 }, { id: 5, x: .6, y: .3 }]
  await delay(700)
  stream.frame(epoch, [points[0]]); await delay(80)
  stream.frame(epoch, points); await delay(80)
  stream.frame(epoch, points.map(p => p.id === 0 ? { ...p, x: .25 } : p)); await delay(80)
  stream.frame(epoch, [points[0], points[2]]); await delay(80)
  stream.frame(epoch, []); await delay(100)
  stream.frame(epoch, points); await delay(850) // watchdog must cancel without any renderer heartbeat.
  assert.ok(stream.geometry.epoch > epoch, JSON.stringify({ states, errors }))
  stream.frame(epoch, points); await delay(100) // stale epochs must not create new touches.
  const pid = (await shell(['pidof', 'dev.adbvault.touchprobe'])).trim()
  const log = await shell(['logcat', '-d', '--pid', pid, '-s', 'VaultTouchProbe:I', '*:S'])
  const events = log.split(/\r?\n/).flatMap(line => { const json = line.indexOf('{"action"'); if (json < 0) return []; try { return [JSON.parse(line.slice(json))] } catch { return [] } })
  assert.ok(events.some(e => e.points.length === 3), log)
  assert.ok(events.some(e => e.action === 2 && e.points.some(p => p.id === 0 && Math.abs(p.x - .25 * 799) < 3)), log)
  assert.ok(events.some(e => e.action === 6) && events.some(e => e.action === 1) && events.some(e => e.action === 3), log)
  assert.ok(events.every(e => e.displayId === target.displayId), log)
  assert.equal(events.at(-1).action, 3, 'Stale frames must not revive cancelled fingers.')
  assert.deepEqual(errors, [])
  const report = { passed: true, displayId: target.displayId, states, events, root }
  await writeFile('desktop-test-results/touch-hardware.json', JSON.stringify(report, null, 2))
  console.log(`PASS: ${events.length} Android touch events, 3 simultaneous fingers, movement, individual release, watchdog CANCEL, stale epoch rejection, exact virtual display ${target.displayId}.`)
} finally {
  stream?.close()
  if (child?.exitCode === null) { const done = new Promise(r => child.once('close', r)); child.kill(); await done }
  await service.shutdown()
  if (installed) await command(adb, [...selector, 'uninstall', 'dev.adbvault.touchprobe'])
  await rm(capture, { force: true })
}
