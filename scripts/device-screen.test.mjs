import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { DeviceScreenService } from '../dist-electron/device-screen.js'
import { parseScreenApplications } from '../dist-electron/screen-applications.js'
import { screenLaunch, validateScreenLaunch } from '../dist-electron/screen-protocol.js'
import { parseScreenCapabilities, screenArguments } from '../dist-electron/screen-options.js'

const help = 'scrcpy 3.3.4\n' + ['serial', 'window-title', 'no-audio', 'max-size', 'max-fps', 'video-bit-rate', 'video-codec', 'fullscreen', 'always-on-top', 'no-control', 'turn-screen-off', 'stay-awake', 'keyboard', 'mouse', 'gamepad', 'no-clipboard-autosync', 'audio-source', 'audio-dup', 'new-display', 'display-ime-policy', 'start-app', 'video-source', 'camera-facing', 'camera-id', 'camera-size', 'camera-fps', 'list-apps', 'record', 'time-limit'].map(f => '--' + f).join('\n')
const caps = parseScreenCapabilities(help)

test('high-speed capture is opt-in, capability gated and isolated from other screen modes', () => {
  const newCaps = { ...caps, flags: [...caps.flags, '--camera-high-speed'] }
  const options = { ...screenLaunch(), mode: 'camera', cameraSize: '1280x720', cameraFps: 240, cameraHighSpeed: true }
  const args = screenArguments(options, newCaps, 36).args
  for (const flag of ['--camera-high-speed', '--camera-size=1280x720', '--camera-fps=240']) assert.ok(args.includes(flag))
  assert.throws(() => screenArguments(options, caps, 36), /high-speed/)
  assert.throws(() => screenArguments({ ...options, cameraSize: '' }, newCaps, 36), /explicit capture size/)
  const legacy = { ...screenLaunch(), mode: 'camera' }; delete legacy.cameraHighSpeed
  assert.deepEqual(screenArguments(legacy, caps, 36), screenArguments({ ...screenLaunch(), mode: 'camera' }, newCaps, 36))
  for (const mode of ['display', 'virtual']) assert.ok(!screenArguments({ ...options, mode }, caps, 36).args.some(arg => arg.startsWith('--camera-')))
  for (const value of [-1, 0, 1001, NaN, 59.5]) assert.throws(() => validateScreenLaunch({ ...options, cameraFps: value }), /cameraFps/)
})

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
const target = { id: 'wifi:PHONE1', serial: '192.168.1.9:40000', transportId: '7' }
function fixture(options = {}) {
  const state = { busy: false, devices: [{ ...target, name: 'Test phone', hardwareId: 'PHONE1', status: 'connected' }] }, calls = [], events = [], launches = [], cameraCalls = [], releases = [], pinCalls = []
  const runner = options.runner || (async (_file, args, _timeout, _input, _env, config) => { calls.push(args); if (config?.stdoutFile) await writeFile(config.stdoutFile, options.png || png); return { code: 0, stdout: args.includes('--help') ? options.help || help : (args.includes('--list-cameras') || args.includes('--list-camera-sizes')) ? options.cameras || 'List of cameras:\n --camera-id=0 (back, 4000x3000, zoom-range=[0.5, 10])\n --camera-id=1 (front, 2000x1500, zoom-range=[1, 4])' : args.includes('resolve-activity') ? (options.unlaunchable ? 'No activity found' : args.at(-1) + '/.MainActivity') : args.includes('--list-apps') ? 'List of apps:\n - Example player                  org.example.player' : args.includes('getprop') ? String(options.sdk || 36) : args.includes('get-current-user') ? String(options.userId || 0) : '', stderr: '' } })
  const launch = (file, args, config) => {
    const child = new EventEmitter(); child.pid = 1000 + launches.length; child.exitCode = null; child.stdout = new PassThrough(); child.stderr = new PassThrough()
    child.kill = () => { child.killed = true; child.emit('close', 0); return true }
    launches.push({ file, args, config, child }); queueMicrotask(() => child.emit('spawn')); return child
  }
  const service = new DeviceScreenService(() => 'C:/tools/adb.exe', () => options.missingScrcpy ? null : 'C:/tools/scrcpy/scrcpy.exe', () => state, e => events.push(e), options.save || (async () => null), runner, launch, async child => { child.releasedBeforeClose = releases.some(([pid]) => pid === child.pid); child.closedGracefully = true; child.emit('close', 0) }, { send: async (...args) => { cameraCalls.push(args); await options.send?.(...args) }, inspect: options.inspect, setAlwaysOnTop: async (...args) => { pinCalls.push(args); await options.pin?.(...args) }, releaseCamera: async (...args) => { releases.push(args) }, shutdown() {} })
  return { service, state, calls, events, launches, cameraCalls, releases, pinCalls }
}

test('reading camera modes targets one transport and never replaces an active capture', async () => {
  const f = fixture({ help: help + '\n--list-camera-sizes', cameras: 'List of cameras:\n --camera-id=0 (back, 4000x3000, fps={30, 60})\n - 1920x1080' })
  try {
    await f.service.execute(target, 'open', { ...screenLaunch(), mode: 'camera' })
    const before = f.service.state
    const modes = await f.service.cameraModes(target)
    assert.deepEqual(modes[0].sizes, ['1920x1080'])
    assert.deepEqual(modes[0].fps, [30, 60])
    assert.deepEqual(f.calls.find(args => args.includes('--list-camera-sizes')), [`--serial=${target.serial}`, '--list-camera-sizes'])
    assert.deepEqual(f.service.state, before); assert.equal(f.launches.length, 1)
    assert.equal(f.launches[0].child.closedGracefully, undefined)
  } finally { await f.service.shutdown() }
  const old = fixture()
  await assert.rejects(old.service.cameraModes(target), /Manual settings/)
  assert.ok(!old.calls.some(args => args.includes('--list-camera-sizes')))
})

test('camera mode reads reject disconnects during collection instead of returning another transport’s data', async () => {
  let release, started
  const pending = new Promise(resolve => { release = resolve }), reading = new Promise(resolve => { started = resolve })
  const f = fixture({ runner: async (_file, args, _timeout, _input, env) => {
    if (args.includes('--help')) return { code: 0, stdout: help + '\n--list-camera-sizes', stderr: '' }
    assert.equal(env.ANDROID_TRANSPORT_ID, '7'); assert.equal(env.ADB, 'C:/tools/adb.exe')
    started(); await pending
    return { code: 0, stdout: 'List of cameras:\n --camera-id=0 (back, 4000x3000)\n - 1920x1080', stderr: '' }
  } })
  const read = f.service.cameraModes(target)
  await reading; f.state.devices[0].transportId = '8'; release()
  await assert.rejects(read, /changed/)
  assert.equal(f.launches.length, 0)
})

test('live pins are independent across all screen modes and survive camera stream replacement', { skip: process.platform !== 'win32' }, async () => {
  const f = fixture()
  try {
    await f.service.execute(target, 'open')
    await f.service.execute(target, 'open', { ...screenLaunch(), mode: 'virtual', application: { packageName: 'org.example.player', userId: 0 }, alwaysOnTop: true })
    await f.service.execute(target, 'open', { ...screenLaunch(), mode: 'camera' })
    const [phone, game, camera] = f.service.state
    assert.deepEqual(f.service.state.map(s => s.alwaysOnTop), [false, true, false])
    for (const session of [phone, camera]) await f.service.setAlwaysOnTop(session.id, true)
    await f.service.setAlwaysOnTop(game.id, false)
    assert.deepEqual(f.service.state.map(s => s.alwaysOnTop), [true, false, true])
    assert.deepEqual(f.pinCalls.map(c => [c[0], c[2]]), [[1000, true], [1002, true], [1001, false]])
    assert.ok(f.pinCalls.every(c => c[1].startsWith('ADB Vault — Test phone — Window ')))
    assert.equal(f.launches.length, 3, 'Pinning must not restart scrcpy')
    await f.service.updateCamera(camera.id, { kind: 'audio', audio: 'off' })
    assert.ok(f.launches[3].args.includes('--always-on-top'))
    assert.equal(f.service.state.find(s => s.id === camera.id).alwaysOnTop, true)
    await f.service.setAlwaysOnTop(camera.id, false)
    await f.service.updateCamera(camera.id, { kind: 'audio', audio: 'mic' })
    assert.ok(!f.launches[4].args.includes('--always-on-top'))
    assert.equal(f.service.state.find(s => s.id === phone.id).alwaysOnTop, true)
  } finally { await f.service.shutdown() }
})

test('pin failures preserve state, serialize changes and reject ended or invalid sessions', { skip: process.platform !== 'win32' }, async () => {
  let complete
  const f = fixture({ pin: () => new Promise((resolve, reject) => { complete = { resolve, reject } }) })
  try {
    await f.service.execute(target, 'open')
    const id = f.service.state[0].id
    const pending = f.service.setAlwaysOnTop(id, true)
    assert.equal(f.service.state[0].controlling, true)
    await assert.rejects(f.service.setAlwaysOnTop(id, false), /Wait for/)
    await assert.rejects(f.service.stop(id), /Wait for/)
    complete.reject(new Error('Window closed'))
    await assert.rejects(pending, /Window closed/)
    assert.equal(f.service.state[0].alwaysOnTop, false)
    assert.equal(f.service.state[0].controlling, false)
    await assert.rejects(f.service.setAlwaysOnTop(id, 'yes'), /Invalid/)
    await assert.rejects(f.service.setAlwaysOnTop('missing', true), /ended/)
    const late = f.service.setAlwaysOnTop(id, true)
    f.launches[0].child.emit('close', 0)
    await new Promise(resolve => setImmediate(resolve))
    complete.resolve()
    await assert.rejects(late, /ended/)
    assert.equal(f.service.state.length, 0)
  } finally { await f.service.shutdown() }
})

test('wake and sleep use distinct idempotent key codes on the selected transport', async () => {
  const { service, calls } = fixture()
  await service.execute(target, 'wake'); await service.execute(target, 'sleep')
  assert.deepEqual(calls, [['-t', '7', 'shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'], ['-t', '7', 'shell', 'input', 'keyevent', 'KEYCODE_SLEEP']])
})

test('touch overlay uses only the display ID reported by its owned virtual process and rejects stale transport', async () => {
  const f = fixture()
  await f.service.execute(target, 'open', { ...screenLaunch(), mode: 'virtual', application: { packageName: 'org.example.game', userId: 0 } })
  const id = f.service.state[0].id
  assert.equal(f.service.state[0].touchControls, true)
  assert.throws(() => f.service.touchTarget(id), /Wait for/)
  f.launches[0].child.stdout.write('[server] INFO: New display: 1920x1080/420 (id=7)\n')
  assert.equal(f.service.touchTarget(id).displayId, 7)
  assert.equal(f.service.touchTarget(id).pid, f.launches[0].child.pid)
  assert.equal(f.service.touchTarget(id).packageName, 'org.example.game')
  f.state.devices[0].transportId = '12'
  assert.throws(() => f.service.touchTarget(id), /connection changed/)
  await f.service.shutdown()
})

test('cancelled picker and changed transport do not capture a screen', async () => {
  const cancelled = fixture()
  assert.equal(await cancelled.service.execute(target, 'screenshot'), null); assert.equal(cancelled.calls.length, 0)
  const changed = fixture({ save: async () => { changed.state.devices[0].transportId = '9'; return 'screen.png' } })
  await assert.rejects(changed.service.execute(target, 'screenshot'), /connection changed/)
  assert.equal(changed.calls.length, 0)
})

test('PNG capture is binary-safe, replaces only after validation, and removes temporary output', async () => {
  await mkdir('desktop-test-results', { recursive: true })
  const directory = await mkdtemp(path.resolve('desktop-test-results/screen-'))
  const destination = path.join(directory, 'phone.png')
  try {
    const valid = fixture({ save: async () => destination })
    await valid.service.execute(target, 'screenshot')
    assert.deepEqual(await readFile(destination), png)
    assert.deepEqual(valid.calls, [['-t', '7', 'exec-out', 'screencap', '-p']])
    assert.ok(valid.events.some(e => e.tone === 'success' && e.text.includes(destination)))
    const invalid = fixture({ save: async () => destination, png: Buffer.alloc(100, 1) })
    await assert.rejects(invalid.service.execute(target, 'screenshot'), /complete PNG/)
    assert.deepEqual(await readFile(destination), png)
    assert.deepEqual(await readdir(directory), ['phone.png'])
  } finally { assert.equal(path.dirname(directory), path.resolve('desktop-test-results')); await rm(directory, { recursive: true, force: true }) }
})

test('scrcpy uses the configured ADB and exact serial, prevents duplicate windows, and stops owned sessions', async () => {
  const { service, launches, events } = fixture()
  await service.execute(target, 'open'); await assert.rejects(service.execute(target, 'open'), /already open/)
  assert.equal(launches.length, 1)
  assert.deepEqual(launches[0].args, ['--serial=192.168.1.9:40000', '--window-title=ADB Vault — Test phone — Window 1 · Phone screen'])
  assert.equal(launches[0].config.env.ADB, 'C:/tools/adb.exe'); assert.equal(launches[0].config.shell, false)
  launches[0].child.stderr.write('Unable to connect to phone')
  launches[0].child.emit('close', 1)
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(events.some(e => e.tone === 'warning' && e.text.includes('Unable to connect')))
  await service.execute(target, 'open'); assert.equal(launches.length, 2)
  await service.shutdown(); assert.equal(launches[1].child.closedGracefully, true); assert.equal(launches[1].child.killed, undefined)
  await assert.rejects(service.execute(target, 'open'), /closing/)
})

test('settings validate structured values and unsupported options fail before launch', async () => {
  for (const patch of [{ mode: '--shell' }, { bitRate: '8M;exit' }, { gamepad: 'true' }, { cameraId: '0 --record=bad' }, { virtualSize: '9999x9999' }, { application: { packageName: '+com.android.settings', userId: 0 } }]) assert.throws(() => validateScreenLaunch({ ...screenLaunch(), ...patch }))
  const old = parseScreenCapabilities('scrcpy 1.25\n--serial --no-control')
  assert.equal(screenArguments(screenLaunch(), old, 29).args.length, 0)
  assert.throws(() => screenArguments({ ...screenLaunch(), mode: 'virtual' }, old, 36), /does not support new-display/)
  assert.throws(() => screenArguments({ ...screenLaunch(), flexDisplay: true, mode: 'virtual' }, caps, 36), /flex-display/)
  assert.throws(() => screenArguments({ ...screenLaunch(), mode: 'camera' }, caps, 30), /Android 12/)
  assert.throws(() => screenArguments({ ...screenLaunch(), audio: 'duplicate' }, caps, 32), /Android 13/)
  assert.throws(() => screenArguments({ ...screenLaunch(), mode: 'virtual', control: false, application: { packageName: 'org.example', userId: 0 } }, caps, 36), /requires Control/)
})

test('physical keyboard, mouse and gamepad are forwarded together to the selected virtual session', async () => {
  const f = fixture()
  await f.service.execute(target, 'open', { ...screenLaunch(), mode: 'virtual', application: { packageName: 'org.example.player', userId: 0 }, keyboard: 'uhid', mouse: 'uhid', gamepad: true })
  const { args, config } = f.launches[0]
  for (const flag of ['--keyboard=uhid', '--mouse=uhid', '--gamepad=uhid', '--new-display=1920x1080', '--start-app=org.example.player', '--serial=' + target.serial]) assert.ok(args.includes(flag), flag)
  assert.equal(config.env.ANDROID_TRANSPORT_ID, target.transportId)
  assert.deepEqual(f.service.state[0].input, { control: true, keyboard: 'uhid', mouse: 'uhid', gamepad: true })
  await f.service.shutdown()
})

test('unsupported physical input fails before process creation and mouse modes are validated', async () => {
  for (const [flag, patch] of [['keyboard', { keyboard: 'uhid' }], ['mouse', { mouse: 'uhid' }], ['gamepad', { gamepad: true }]]) {
    const f = fixture({ help: help.replace('--' + flag, '') })
    await assert.rejects(f.service.execute(target, 'open', { ...screenLaunch(), ...patch }), new RegExp('does not support physical ' + flag))
    assert.equal(f.launches.length, 0)
  }
  for (const mouse of ['aoa', '--record=bad', null, 1]) assert.throws(() => validateScreenLaunch({ ...screenLaunch(), mouse }), /Invalid screen setting: mouse/)
})

test('view-only and camera sessions never activate saved physical input and legacy standard input needs no mouse flag', () => {
  const saved = { ...screenLaunch(), keyboard: 'uhid', mouse: 'uhid', gamepad: true }
  const old = parseScreenCapabilities('scrcpy 1.25\n--serial --no-control')
  assert.deepEqual(screenArguments(screenLaunch(), old, 29).args, [])
  assert.deepEqual(screenArguments({ ...saved, control: false }, old, 29).args, ['--no-control'])
  const camera = screenArguments({ ...saved, mode: 'camera' }, caps, 36)
  assert.ok(!camera.args.some(arg => /^--(?:keyboard|mouse|gamepad)=/.test(arg)))
})

test('camera size avoids max-size conflict and never implicitly captures the microphone', () => {
  const built = screenArguments({ ...screenLaunch(), mode: 'camera', cameraSize: '1920x1080', maxSize: 1280, gamepad: true, screenOff: true, cameraId: '1' }, caps, 36)
  assert.ok(built.args.includes('--audio-source=output')); assert.ok(built.args.includes('--camera-id=1'))
  for (const flag of ['--max-size=', '--camera-facing=', '--gamepad=', '--turn-screen-off']) assert.ok(!built.args.some(a => a.startsWith(flag)))
  const silent = screenArguments({ ...screenLaunch(), mode: 'camera', audio: 'off' }, caps, 36)
  assert.ok(silent.args.includes('--no-audio')); assert.ok(!silent.args.some(a => a.startsWith('--audio-source=')))
})

const cameraCaps = parseScreenCapabilities(help.replace('3.3.4', '5.0.1') + '\n--camera-zoom --camera-torch --display-orientation --record-orientation')
const liveHelp = 'scrcpy 5.0.1\n' + cameraCaps.flags.join('\n')
test('absent cameras and catalog errors cannot close an active stream or open an unavailable external camera', async () => {
  const config = { help: liveHelp }
  const f = fixture(config)
  await assert.rejects(f.service.execute(target, 'open', { ...screenLaunch(), mode: 'camera', cameraFacing: 'external' }), /External camera not detected/)
  assert.equal(f.launches.length, 0)
  await f.service.execute(target, 'open', { ...screenLaunch(), mode: 'camera' })
  const id = f.service.state[0].id
  await assert.rejects(f.service.updateCamera(id, { kind: 'camera', facing: 'external' }), /External camera not detected/)
  assert.equal(f.launches[0].child.closedGracefully, undefined)
  assert.equal(f.service.state[0].camera.id, '0')
  config.cameras = 'List of cameras:\n (access denied)'
  await assert.rejects(f.service.updateCamera(id, { kind: 'camera', facing: 'front' }), /Could not read/)
  assert.equal(f.launches[0].child.closedGracefully, undefined)
  assert.equal(f.service.busy, false)
  config.cameras = 'List of cameras:\n --camera-id=0 (back, 4000x3000)\n --camera-id=usb (external, 640x480)'
  await f.service.updateCamera(id, { kind: 'refresh' })
  assert.equal(f.service.state[0].cameras.length, 2)
  assert.equal(f.launches.length, 1)
  await f.service.updateCamera(id, { kind: 'camera', facing: 'external' })
  assert.ok(f.launches[1].args.includes('--camera-id=usb'))
  await f.service.shutdown()
})

test('zoom values come from the active process output, including native shortcuts, and old processes cannot overwrite them', async () => {
  const f = fixture({ help: liveHelp })
  await f.service.execute(target, 'open', { ...screenLaunch(), mode: 'camera' })
  const id = f.service.state[0].id
  assert.deepEqual(f.service.state[0].cameraZoom, { min: .5, max: 10 })
  f.launches[0].child.stdout.write('INFO: Texture: 640x480\n')
  assert.equal(f.service.state[0].cameraZoom.current, 1)
  f.launches[0].child.stdout.write('[server] INFO: Set camera zo')
  assert.equal(f.service.state[0].cameraZoom.current, 1)
  f.launches[0].child.stdout.write('om: 1.189207\n')
  assert.equal(f.service.state[0].cameraZoom.current, 1.189207)
  f.launches[0].child.stderr.write('[server] INFO: Set camera zoom: 10\n')
  assert.equal(f.service.state[0].cameraZoom.current, 10)
  await f.service.updateCamera(id, { kind: 'camera', facing: 'front' })
  assert.deepEqual(f.service.state[0].cameraZoom, { min: 1, max: 4 })
  f.launches[0].child.stdout.write('[server] INFO: Set camera zoom: 7\n')
  assert.equal(f.service.state[0].cameraZoom.current, undefined)
  f.launches[1].child.stdout.write('[server] INFO: Set camera zoom: 2\n[server] ERROR: Camera error\n')
  assert.equal(f.service.state[0].cameraZoom.current, undefined)
  await f.service.shutdown()
})

test('live camera commands target only the owned camera and reject concurrent, unsupported and ended sessions', async () => {
  let release
  const f = fixture({ help: liveHelp, send: () => new Promise(resolve => { release = resolve }) })
  await f.service.execute(target, 'open', { ...screenLaunch(), mode: 'camera' })
  const id = f.service.state[0].id
  const sending = f.service.cameraControl(id, 'zoom-in')
  assert.equal(f.service.state[0].controlling, true)
  await assert.rejects(f.service.cameraControl(id, 'torch-on'), /Wait/)
  await assert.rejects(f.service.stop(id), /Wait/)
  assert.deepEqual(f.cameraCalls[0], [1000, 'ADB Vault — Test phone — Window 1 · Camera', 'zoom-in'])
  release(); await sending
  await assert.rejects(f.service.cameraControl(id, 'shell'), /Unsupported/)
  await f.service.stop(id)
  await assert.rejects(f.service.cameraControl(id, 'zoom-in'), /ended/)
  await f.service.execute(target, 'open')
  await assert.rejects(f.service.cameraControl(f.service.state[0].id, 'rotate-left'), /ended/)
  const old = fixture(); await old.service.execute(target, 'open', { ...screenLaunch(), mode: 'camera' })
  await assert.rejects(old.service.cameraControl(old.service.state[0].id, 'zoom-in'), /unavailable/)
  assert.equal(old.cameraCalls.length, 0)
})

test('visible first frame initializes default zoom without Texture logs and never overwrites later feedback or errors', async () => {
  let visible = false
  const f = fixture({ help: liveHelp, inspect: async () => ({ visible }) })
  await f.service.execute(target, 'open', { ...screenLaunch(), mode: 'camera' })
  const id = f.service.state[0].id
  await f.service.cameraWindow(id); assert.equal(f.service.state[0].cameraZoom.current, undefined)
  visible = true; await f.service.cameraWindow(id); assert.equal(f.service.state[0].cameraZoom.current, 1)
  f.launches[0].child.stdout.write('[server] INFO: Set camera zoom: 2\n')
  await f.service.cameraWindow(id); assert.equal(f.service.state[0].cameraZoom.current, 2)
  f.launches[0].child.stdout.write('[server] ERROR: Camera error\n')
  await f.service.cameraWindow(id); assert.equal(f.service.state[0].cameraZoom.current, undefined)
  await f.service.shutdown()
  const custom = fixture({ help: liveHelp, inspect: async () => ({ visible: true }) })
  await custom.service.execute(target, 'open', { ...screenLaunch(), mode: 'camera', cameraZoom: 2 })
  await custom.service.cameraWindow(custom.service.state[0].id)
  assert.equal(custom.service.state[0].cameraZoom.current, undefined)
  custom.launches[0].child.stdout.write('[server] INFO: Set camera zoom: 2\n')
  assert.equal(custom.service.state[0].cameraZoom.current, 2)
  await custom.service.shutdown()
})

test('zoom slider reaches camera endpoints using acknowledged live steps without restarting', async () => {
  let current = 1
  const f = fixture({ help: liveHelp, send: async (_pid, _title, command) => {
    current = Math.max(.5, Math.min(10, Math.pow(1.0625, Math.round(Math.log(current) / Math.log(1.0625)) + (command === 'zoom-in' ? 1 : -1))))
    f.launches[0].child.stdout.write(`[server] INFO: Set camera zoom: ${current}\n`)
  } })
  await f.service.execute(target, 'open', { ...screenLaunch(), mode: 'camera' })
  const id = f.service.state[0].id
  // No startup Texture line in scrcpy 5: the first request must get its own feedback.
  assert.equal(f.service.state[0].cameraZoom.current, undefined)
  for (const value of [NaN, 0, .4, 11]) await assert.rejects(f.service.cameraZoom(id, value), /Invalid|outside/)
  await f.service.cameraZoom(id, 10); assert.equal(f.service.state[0].cameraZoom.current, 10)
  await f.service.cameraZoom(id, .5); assert.equal(f.service.state[0].cameraZoom.current, .5)
  assert.equal(f.launches.length, 1); assert.equal(f.service.state[0].controlling, false)
  assert.ok(f.cameraCalls.length < 100)
  await f.service.shutdown()
})

test('zoom slider stops on missing feedback and on a closed camera without claiming the target', async () => {
  const f = fixture({ help: liveHelp })
  await f.service.execute(target, 'open', { ...screenLaunch(), mode: 'camera' })
  f.launches[0].child.stdout.write('INFO: Texture: 640x480\n')
  const id = f.service.state[0].id, zooming = f.service.cameraZoom(id, 10)
  await assert.rejects(f.service.cameraControl(id, 'torch-on'), /Wait/)
  await assert.rejects(zooming, /did not confirm/)
  assert.equal(f.service.state[0].cameraZoom.current, 1); assert.equal(f.cameraCalls.length, 1)
  assert.equal(f.service.state[0].controlling, false)
  const ended = f.service.cameraZoom(id, 10)
  f.launches[0].child.emit('close', 0)
  await assert.rejects(ended, /confirm|ended/)
  assert.equal(f.cameraCalls.length, 2)
  await f.service.shutdown()
})

test('live camera and sound changes replace only their camera process and preserve the panel session', async () => {
  const f = fixture({ help: liveHelp })
  await f.service.execute(target, 'open', { ...screenLaunch(), mode: 'camera', cameraZoom: 2, cameraTorch: true })
  const id = f.service.state[0].id
  await f.service.execute(target, 'open', { ...screenLaunch(), mode: 'virtual', application: { packageName: 'org.example', userId: 0 } })
  await f.service.updateCamera(id, { kind: 'camera', facing: 'front' })
  assert.ok(f.launches[0].child.closedGracefully); assert.ok(!f.launches[1].child.closedGracefully)
  assert.equal(f.launches[0].child.releasedBeforeClose, true)
  assert.deepEqual(f.releases[0], [1000, 'ADB Vault — Test phone — Window 1 · Camera'])
  assert.equal(f.service.state.find(s => s.mode === 'camera').id, id)
  assert.ok(f.launches[2].args.includes('--camera-id=1'))
  assert.ok(!f.launches[2].args.some(a => /camera-zoom|camera-torch/.test(a)))
  await f.service.updateCamera(id, { kind: 'audio', audio: 'mic' })
  assert.ok(f.launches[3].args.includes('--audio-source=mic'))
  assert.equal(f.service.state.find(s => s.id === id).camera.audio, 'mic')
  await assert.rejects(f.service.updateCamera(id, { kind: 'audio', audio: '--shell' }), /Invalid camera/)
})

test('cancelled recording picker and stale transport leave the running camera unchanged', async () => {
  const f = fixture({ help: liveHelp })
  await f.service.execute(target, 'open', { ...screenLaunch(), mode: 'camera' })
  const id = f.service.state[0].id
  await f.service.updateCamera(id, { kind: 'record', enabled: true })
  assert.equal(f.launches.length, 1); assert.equal(f.launches[0].child.closedGracefully, undefined)
  assert.equal(f.service.state[0].restarting, false)
  f.state.devices[0].transportId = '9'
  await assert.rejects(f.service.updateCamera(id, { kind: 'camera', facing: 'front' }), /changed/)
  assert.equal(f.launches.length, 1)
})

test('recording starts from preview, splits only after confirmation, then stops back to preview', async () => {
  await mkdir('desktop-test-results', { recursive: true })
  const directory = await mkdtemp(path.resolve('desktop-test-results/camera-record-'))
  let chosen = path.join(directory, 'first.mkv')
  try {
    const f = fixture({ help: liveHelp, save: async () => chosen })
    await f.service.execute(target, 'open', { ...screenLaunch(), mode: 'camera' })
    const id = f.service.state[0].id
    await f.service.updateCamera(id, { kind: 'record', enabled: true })
    assert.equal(f.service.state[0].id, id); assert.equal(f.service.state[0].recording, chosen)
    if (process.platform === 'win32') {
      await f.service.setAlwaysOnTop(id, true)
      assert.equal(f.service.state[0].recording, chosen)
      assert.equal(f.launches.length, 2, 'Pinning must preserve the running recorder')
      assert.equal(f.launches[1].child.closedGracefully, undefined)
    }
    await writeFile(f.launches[1].args.find(a => a.startsWith('--record=')).slice(9), 'first video')
    await assert.rejects(f.service.updateCamera(id, { kind: 'camera', facing: 'front' }), /Confirm/)
    chosen = null
    await f.service.updateCamera(id, { kind: 'camera', facing: 'front' }, true)
    assert.equal(f.launches.length, 2); assert.equal(f.launches[1].child.closedGracefully, undefined)
    chosen = path.join(directory, 'second.mkv')
    await f.service.updateCamera(id, { kind: 'camera', facing: 'front' }, true)
    assert.equal(await readFile(path.join(directory, 'first.mkv'), 'utf8'), 'first video')
    await writeFile(f.launches[2].args.find(a => a.startsWith('--record=')).slice(9), 'second video')
    await f.service.updateCamera(id, { kind: 'record', enabled: false })
    assert.equal(await readFile(chosen, 'utf8'), 'second video')
    assert.equal(f.service.state[0].recording, undefined); assert.equal(f.service.state[0].id, id)
    assert.ok(!f.launches[3].args.some(a => a.startsWith('--record=')))
    assert.ok(f.events.filter(e => e.type === 'screenSessions').every(e => e.sessions.some(s => s.id === id)))
    await f.service.shutdown()
  } finally { assert.equal(path.dirname(directory), path.resolve('desktop-test-results')); await rm(directory, { recursive: true, force: true }) }
})

test('failed recording finalization preserves the capture and prevents a replacement stream', async () => {
  await mkdir('desktop-test-results', { recursive: true })
  const directory = await mkdtemp(path.resolve('desktop-test-results/camera-failed-'))
  try {
    const destination = path.join(directory, 'camera.mkv'), f = fixture({ help: liveHelp, save: async () => destination })
    await f.service.execute(target, 'open', { ...screenLaunch(), mode: 'camera', record: true })
    const staging = f.launches[0].args.find(a => a.startsWith('--record=')).slice(9)
    await assert.rejects(f.service.updateCamera(f.service.state[0].id, { kind: 'record', enabled: false }), /could not be finalized/)
    assert.equal(f.launches.length, 1); assert.equal(f.service.activeSessionCount, 0)
    assert.equal((await readFile(staging)).length, 0)
    assert.ok(f.events.some(e => e.tone === 'warning' && e.text.includes(staging)))
    await assert.rejects(readFile(destination), /ENOENT/)
  } finally { assert.equal(path.dirname(directory), path.resolve('desktop-test-results')); await rm(directory, { recursive: true, force: true }) }
})
test('camera preview and recording rotations stay independent, with optional initial preview matching', () => {
  const options = { ...screenLaunch(), mode: 'camera', cameraZoom: 2.5, cameraTorch: true, cameraPreviewRotation: 90, cameraRecordRotation: 180, record: true, audio: 'mic' }
  const args = screenArguments(options, cameraCaps, 36, 'D:/camera.mp4').args
  for (const flag of ['--camera-zoom=2.5', '--camera-torch', '--display-orientation=90', '--record-orientation=180', '--audio-source=mic', '--record=D:/camera.mp4']) assert.ok(args.includes(flag), flag)
  const linked = screenArguments({ ...options, cameraRecordRotation: 'preview', cameraPreviewRotation: 270 }, cameraCaps, 36, 'D:/camera.mkv').args
  assert.ok(linked.includes('--record-orientation=270'))
  const preview = screenArguments({ ...options, record: false }, cameraCaps, 36).args
  assert.ok(preview.includes('--display-orientation=90')); assert.ok(!preview.some(a => a.startsWith('--record')))
  const unrotated = screenArguments({ ...options, cameraRecordRotation: 0 }, cameraCaps, 36, 'D:/camera.mkv').args
  assert.ok(!unrotated.some(a => a.startsWith('--record-orientation') || a.startsWith('--orientation=')))
})

test('camera controls detect old scrcpy, reject invalid values, and never affect screen modes', () => {
  for (const patch of [{ cameraZoom: 0 }, { cameraZoom: -1 }, { cameraZoom: Infinity }, { cameraZoom: NaN }, { cameraZoom: '2' }, { cameraTorch: 'true' }, { cameraPreviewRotation: 45 }, { cameraRecordRotation: '90 --record=bad' }]) assert.throws(() => validateScreenLaunch({ ...screenLaunch(), ...patch }))
  const defaults = screenArguments({ ...screenLaunch(), mode: 'camera' }, caps, 36).args
  assert.ok(!defaults.some(a => /zoom|torch|orientation/.test(a)))
  for (const patch of [{ cameraZoom: 2 }, { cameraTorch: true }, { cameraPreviewRotation: 90 }, { cameraRecordRotation: 180, record: true }]) assert.throws(() => screenArguments({ ...screenLaunch(), mode: 'camera', ...patch }, caps, 36, 'D:/video.mkv'), /Update scrcpy/)
  // An unused recording preference must not prevent a camera preview on older scrcpy.
  assert.doesNotThrow(() => screenArguments({ ...screenLaunch(), mode: 'camera', cameraRecordRotation: 90 }, caps, 36))
  for (const mode of ['display', 'virtual']) {
    const args = screenArguments({ ...screenLaunch(), mode, cameraZoom: 2, cameraTorch: true, cameraPreviewRotation: 90, cameraRecordRotation: 180, record: true }, caps, 36, 'D:/screen.mkv').args
    assert.ok(!args.some(a => /camera-|orientation/.test(a)))
  }
})

test('quality, audio, input, window and virtual-display settings generate independent safe arguments', () => {
  const built = screenArguments({ ...screenLaunch(), mode: 'virtual', virtualDpi: 240, application: { packageName: 'org.videolan.vlc', userId: 0 }, codec: 'h265', maxSize: 1920, bitRate: 16, maxFps: 60, audio: 'duplicate', fullscreen: true, alwaysOnTop: true, keyboard: 'uhid', gamepad: true, clipboard: false, record: true, timeLimit: 300 }, caps, 36, 'D:/video with spaces.mkv')
  for (const arg of ['--new-display=1920x1080/240', '--start-app=org.videolan.vlc', '--audio-dup', '--video-codec=h265', '--video-bit-rate=16M', '--max-fps=60', '--keyboard=uhid', '--gamepad=uhid', '--fullscreen', '--no-clipboard-autosync', '--record=D:/video with spaces.mkv', '--time-limit=300']) assert.ok(built.args.includes(arg), arg)
  assert.ok(screenArguments({ ...screenLaunch(), gamepad: true, control: false, screenOff: true }, caps, 36).args.includes('--no-control'))
  assert.ok(!screenArguments({ ...screenLaunch(), gamepad: true, control: false }, caps, 36).args.includes('--gamepad=uhid'))
})

test('virtual app launch refuses a different phone profile and a changed connection after picking a file', async () => {
  const otherProfile = fixture({ userId: 10 })
  await assert.rejects(otherProfile.service.execute(target, 'open', { ...screenLaunch(), mode: 'virtual', application: { packageName: 'org.videolan.vlc', userId: 0 } }), /current Android user/)
  assert.equal(otherProfile.launches.length, 0)
  const changed = fixture({ save: async () => { changed.state.devices[0].transportId = '99'; return null } })
  assert.equal(await changed.service.execute(target, 'open', { ...screenLaunch(), record: true }), null)
  assert.equal(changed.launches.length, 0)
})

test('virtual displays require an app and verify that it is launchable before opening a window', async () => {
  const f = fixture()
  await assert.rejects(f.service.execute(target, 'open', { ...screenLaunch(), mode: 'virtual' }), /Choose an application/)
  const denied = fixture({ unlaunchable: true })
  await assert.rejects(denied.service.execute(target, 'open', { ...screenLaunch(), mode: 'virtual', application: { packageName: 'org.example', userId: 0 } }), /no accessible launcher/)
  assert.equal(denied.launches.length, 0)
  await f.service.execute(target, 'open', { ...screenLaunch(), mode: 'virtual', application: { packageName: 'org.example', userId: 0 } })
  assert.ok(f.launches[0].args.includes('--start-app=org.example'))
  assert.deepEqual(f.calls.find(args => args.includes('resolve-activity')), ['-t', '7', 'shell', 'cmd', 'package', 'resolve-activity', '--brief', '--user', '0', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', '-p', 'org.example'])
  await f.service.shutdown()
})

test('application catalog reads only the chosen transport and rejects connection/profile changes', async () => {
  const f = fixture()
  assert.deepEqual(await f.service.applications(target), { userId: 0, applications: [{ label: 'Example player', packageName: 'org.example.player' }] })
  assert.equal(f.launches.length, 0)
  assert.ok(f.calls.some(args => args.join(' ') === '--serial=192.168.1.9:40000 --list-apps'))
  for (const change of ['profile', 'transport']) {
    let profile = 0
    const changing = fixture({ runner: async (_file, args, _timeout, _input, env) => {
      if (args.includes('--help')) return { code: 0, stdout: help, stderr: '' }
      if (args.includes('--list-apps')) {
        assert.equal(env.ANDROID_TRANSPORT_ID, '7')
        if (change === 'profile') profile = 10; else changing.state.devices[0].transportId = '99'
        return { code: 0, stdout: 'List of apps:', stderr: '' }
      }
      return { code: 0, stdout: String(profile), stderr: '' }
    } })
    await assert.rejects(changing.service.applications(target), /profile changed|connection changed/)
    assert.equal(changing.launches.length, 0)
    await changing.service.shutdown()
  }
  await f.service.shutdown()
})

test('scrcpy application list accepts Unicode and wrapped labels without confusing package names', () => {
  assert.deepEqual(parseScreenApplications('[server] INFO: List of apps:\n * Настройки                       com.android.settings\n - An application name longer than thirty characters\n                                  org.example.long\n - Player                          org.example.player\n'), [
    { label: 'An application name longer than thirty characters', packageName: 'org.example.long' },
    { label: 'Player', packageName: 'org.example.player' },
    { label: 'Настройки', packageName: 'com.android.settings' },
  ].sort((a, b) => a.label.localeCompare(b.label)))
  assert.deepEqual(parseScreenApplications('List of apps:'), [])
  assert.throws(() => parseScreenApplications('List of apps:\n - Broken entry'), /unreadable/)
  assert.throws(() => parseScreenApplications('Permission denied'), /Could not read/)
})

test('recording finalizes on graceful close, preserves existing files, and retains partial captures on failure', async () => {
  await mkdir('desktop-test-results', { recursive: true })
  const directory = await mkdtemp(path.resolve('desktop-test-results/recording-'))
  try {
    const destination = path.join(directory, 'video.mkv'), options = { ...screenLaunch(), record: true }
    const f = fixture({ save: async () => destination })
    await f.service.execute(target, 'open', options)
    const staging = f.launches[0].args.find(a => a.startsWith('--record=')).slice(9)
    assert.notEqual(staging, destination)
    await writeFile(staging, 'complete recording')
    await f.service.stop(f.service.state[0].id)
    assert.equal(await readFile(destination, 'utf8'), 'complete recording'); assert.equal(f.service.activeSessionCount, 0)
    assert.ok(f.events.some(e => e.text?.includes('Recording saved:')))
    await assert.rejects(f.service.execute(target, 'open', options), /already exists/)
    assert.equal(await readFile(destination, 'utf8'), 'complete recording')
    const failed = fixture({ save: async () => path.join(directory, 'failed.mkv') })
    await failed.service.execute(target, 'open', options)
    const partial = failed.launches[0].args.find(a => a.startsWith('--record=')).slice(9)
    await writeFile(partial, 'partial capture'); failed.launches[0].child.stderr.write('Device disconnected'); failed.launches[0].child.emit('close', 1)
    for (let i = 0; i < 50 && failed.service.activeSessionCount; i++) await new Promise(r => setTimeout(r, 10))
    assert.equal(await readFile(partial, 'utf8'), 'partial capture')
    assert.ok(failed.events.some(e => e.tone === 'warning' && e.text.includes(partial) && e.text.includes('Device disconnected')))
  } finally { assert.equal(path.dirname(directory), path.resolve('desktop-test-results')); await rm(directory, { recursive: true, force: true }) }
})

test('a file created during recording is never overwritten, and stale picker targets leave no staging file', async () => {
  await mkdir('desktop-test-results', { recursive: true })
  const directory = await mkdtemp(path.resolve('desktop-test-results/recording-race-'))
  try {
    const destination = path.join(directory, 'video.mkv'), options = { ...screenLaunch(), record: true }
    const changed = fixture({ save: async () => { changed.state.devices[0].transportId = '99'; return destination } })
    await assert.rejects(changed.service.execute(target, 'open', options), /connection changed/)
    assert.deepEqual(await readdir(directory), []); assert.equal(changed.launches.length, 0)
    const f = fixture({ save: async () => destination })
    await f.service.execute(target, 'open', options)
    const staging = f.launches[0].args.find(a => a.startsWith('--record=')).slice(9)
    await writeFile(staging, 'new video'); await writeFile(destination, 'another file')
    await f.service.stop(f.service.state[0].id)
    assert.equal(await readFile(destination, 'utf8'), 'another file')
    assert.equal(await readFile(staging, 'utf8'), 'new video')
    assert.ok(f.events.some(e => e.tone === 'warning' && e.text.includes(staging)))
  } finally { assert.equal(path.dirname(directory), path.resolve('desktop-test-results')); await rm(directory, { recursive: true, force: true }) }
})

test('unavailable components, disconnected phones, and denied input surface actionable errors', async () => {
  const missing = fixture({ missingScrcpy: true }); await assert.rejects(missing.service.execute(target, 'open'), /scrcpy in Components/)
  assert.equal(missing.launches.length, 0)
  const offline = fixture(); offline.state.devices[0].status = 'offline'
  await assert.rejects(offline.service.execute(target, 'wake'), /Connect/); assert.equal(offline.calls.length, 0)
  const denied = fixture({ runner: async () => ({ code: 0, stdout: '', stderr: 'SecurityException: permission denied' }) })
  await assert.rejects(denied.service.execute(target, 'sleep'), /denied/); assert.equal(denied.service.busy, false)
})
