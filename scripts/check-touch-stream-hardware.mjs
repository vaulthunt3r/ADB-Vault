// Uses an existing Settings app in an owned, temporary display. No APK installation or settings changes.
import assert from 'node:assert/strict'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { DeviceScreenService } from '../dist-electron/device-screen.js'
import { TouchStream } from '../dist-electron/touch-stream.js'
import { parseDevices } from '../dist-electron/connections.js'
import { screenLaunch } from '../dist-electron/screen-protocol.js'
import { run, checked } from '../dist-electron/process.js'
const delay = ms => new Promise(r => setTimeout(r, ms))
const saved = JSON.parse(await readFile(path.join(process.env.APPDATA, 'adb-vault/backend.json'), 'utf8'))
const adb = path.join(saved.paths.adb, 'adb.exe'), scrcpy = path.join(saved.paths.scrcpy, 'scrcpy.exe')
const devices = parseDevices(checked(await run(adb, ['devices', '-l']))).filter(d => d.status === 'connected')
assert.equal(devices.length, 1)
const device = devices[0], selector = ['-t', device.transportId], shell = async args => checked(await run(adb, [...selector, 'shell', ...args], 15000))
const userId = Number((await shell(['am', 'get-current-user'])).trim()), root = await mkdtemp(path.resolve('desktop-test-results/touch-stream-')), capture = path.join(root, 'test.mkv')
const connection = { devices, activeDeviceId: device.id, busy: false }
let child, stream, output = ''
const states = [], errors = []
const service = new DeviceScreenService(() => adb, () => scrcpy, () => connection, () => {}, async () => capture, run,
  (file, args, options) => { child = spawn(file, [...args, '--no-window'], options); child.stdout.on('data', c => output += c); child.stderr.on('data', c => output += c); return child })
try {
  await service.execute(device, 'open', { ...screenLaunch(), mode: 'virtual', virtualSize: '800x600', audio: 'off', clipboard: false, record: true, timeLimit: 25, application: { packageName: 'com.android.settings', userId } })
  for (let i = 0; i < 100 && !service.state[0]?.virtualDisplayId; i++) { assert.equal(child.exitCode, null, output); await delay(100) }
  const id = service.state[0].id, target = service.touchTarget(id)
  stream = new TouchStream(path.resolve('android-helper/dist'), () => service.touchTarget(id), (state, error) => { if (state) states.push(state); if (error) errors.push(error) })
  await stream.start()
  for (let i = 0; i < 100 && !stream.geometry && !errors.length; i++) await delay(100)
  assert.deepEqual(errors, []); assert.ok(stream.geometry, output)
  const epoch = stream.geometry.epoch, points = [{ id: 0, x: .3, y: .08 }, { id: 2, x: .6, y: .08 }, { id: 5, x: .8, y: .08 }]
  stream.frame(epoch, [points[0]]); await delay(80); stream.frame(epoch, points); await delay(80)
  const heartbeat = setInterval(() => stream.frame(epoch, points), 100)
  let input
  try { input = await shell(['dumpsys', 'input']) } finally { clearInterval(heartbeat) }
  const at = input.indexOf('TouchStates'), next = input.indexOf('CursorStatesByDisplay', at)
  const touchState = at >= 0 ? input.slice(at, next > at ? next : at + 5000) : ''
  assert.ok(touchState.includes(`${target.displayId} :`)); for (const id of [0, 2, 5]) assert.ok(touchState.includes(`Pointer(id=${id}, FINGER)`), touchState)
  stream.frame(epoch, points.map(p => ({ ...p, y: .09 }))); await delay(80)
  stream.frame(epoch, [points[0], points[2]]); await delay(80); stream.frame(epoch, []); await delay(80)
  stream.frame(epoch, points); await delay(850)
  assert.deepEqual(errors, []); assert.ok(stream.geometry.epoch > epoch, JSON.stringify(states))
  stream.frame(epoch, points); await delay(100); assert.deepEqual(errors, [])
  const report = { passed: true, displayId: target.displayId, states, touchState, note: 'Android injection accepted; app event recording was unavailable because the phone declined installing the test app.' }
  await writeFile('desktop-test-results/touch-stream-hardware.json', JSON.stringify(report, null, 2))
  console.log(`PASS: Android reports 3 fingers on virtual display ${target.displayId}; injection accepted, heartbeat timeout cancelled touches and advanced the input epoch.`)
} finally {
  stream?.close()
  if (child?.exitCode === null) { const done = new Promise(r => child.once('close', r)); child.kill(); await done }
  await service.shutdown(); await rm(capture, { force: true })
}
