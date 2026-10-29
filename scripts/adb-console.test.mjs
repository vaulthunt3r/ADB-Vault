import test from 'node:test'
import assert from 'node:assert/strict'
import { AdbConsoleService, consoleArguments } from '../dist-electron/adb-console.js'
import { validateConsoleRun } from '../dist-electron/adb-console-protocol.js'
import { run } from '../dist-electron/process.js'
import { collectExitOperations } from '../dist-electron/exit-operations.js'

const target = { id: 'phone', serial: '192.168.1.2:4444', transportId: '7' }
const request = { type: 'console.run', target, command: 'shell getprop ro.product.model', mode: 'adb', timeout: 30000 }
function fixture(execute = async () => ({ stdout: 'Phone\n', stderr: '', code: 0 })) {
  const connection = { devices: [{ ...target, status: 'connected', name: 'Phone', hardwareId: 'phone-1' }], busy: false }
  const calls = [], events = []
  const service = new AdbConsoleService(() => 'adb.exe', () => connection, event => events.push(event),
    async (...args) => { calls.push(args); return execute(...args) })
  return { service, connection, calls, events }
}

test('ADB parsing preserves quoted Windows paths and Android shell operators without a host shell', () => {
  assert.deepEqual(consoleArguments('adb', 'adb pull "/sdcard/My File.txt" "D:\\My Files\\a.txt"'), ['pull', '/sdcard/My File.txt', 'D:\\My Files\\a.txt'])
  assert.deepEqual(consoleArguments('adb', 'shell echo "hello world" | grep hello'), ['shell', '-T', 'echo "hello world" | grep hello'])
  assert.deepEqual(consoleArguments('adb', 'adb shell "ls /sdcard"'), ['shell', '-T', 'ls /sdcard'])
  assert.deepEqual(consoleArguments('adb', 'shell -T ls -t "/sdcard/My Files"'), ['shell', '-T', 'ls -t "/sdcard/My Files"'])
  assert.deepEqual(consoleArguments('adb', 'shell "echo" "hello world"'), ['shell', '-T', '"echo" "hello world"'])
  assert.deepEqual(consoleArguments('shell', "printf '%s\\n' 'a b'\ngetprop ro.product.model"), ['shell', '-T', "printf '%s\\n' 'a b'\ngetprop ro.product.model"])
  assert.deepEqual(consoleArguments('adb', 'pull /sdcard/file.txt "$(whoami).txt"'), ['pull', '/sdcard/file.txt', '$(whoami).txt'])
  for (const command of ['adb', 'shell', '-s OTHER shell id', '-H remote devices', 'pull "unfinished', 'shell -tt']) assert.throws(() => consoleArguments('adb', command))
})
test('invalid requests never reach ADB', () => {
  for (const patch of [{ mode: 'cmd' }, { command: '' }, { command: 'x\0y' }, { timeout: 0 }, { target: { ...target, transportId: '-s OTHER' } }]) {
    const f = fixture()
    assert.throws(() => validateConsoleRun({ ...request, ...patch }))
    assert.throws(() => f.service.start({ ...request, ...patch }))
    assert.equal(f.calls.length, 0)
  }
})
test('console binds exact transport, reports streamed stdout/stderr and exit code', async () => {
  const f = fixture(async (...args) => {
    const options = args[5]
    options.onStdout('first\n'); options.onStderr('diagnostic\n'); options.onStdout('last\n')
    return { stdout: 'first\nlast\n', stderr: 'diagnostic\n', code: 2 }
  })
  f.service.start(request); await f.service.wait()
  assert.deepEqual(f.calls[0].slice(0, 3), ['adb.exe', ['-t', '7', 'shell', '-T', 'getprop ro.product.model'], 30000])
  assert.deepEqual(f.service.state.run.output, [{ stream: 'stdout', text: 'first\n' }, { stream: 'stderr', text: 'diagnostic\n' }, { stream: 'stdout', text: 'last\n' }])
  assert.equal(f.service.state.run.exitCode, 2)
  assert.equal(f.service.state.run.status, 'error')
  assert.deepEqual(f.service.state.history, [{ command: request.command, mode: request.mode }])
  assert.ok(f.events.at(-1).state.revision > f.events[0].state.revision)
})
test('rejects stale targets and disconnected phones without falling back to another device', () => {
  const f = fixture()
  assert.throws(() => f.service.start({ ...request, target: { ...target, transportId: '8' } }), /changed/)
  f.connection.devices[0].status = 'disconnected'
  f.connection.devices.push({ ...target, id: 'other', status: 'connected' })
  assert.throws(() => f.service.start(request), /Connect/)
  assert.equal(f.calls.length, 0)
})
test('stop keeps partial output, does not cancel a newer run with a stale id, and waits for child termination', async () => {
  let release, signal
  const f = fixture((...args) => new Promise(resolve => {
    signal = args[5].signal; args[5].onStdout('partial\n')
    release = () => resolve({ stdout: 'partial', stderr: '', code: -1 })
  }))
  f.service.start(request); await Promise.resolve()
  assert.throws(() => f.service.start(request), /Stop/)
  assert.throws(() => f.service.clear(), /Stop/)
  f.service.stop('old-id'); assert.equal(signal.aborted, false)
  f.service.stop(f.service.state.run.id)
  assert.equal(signal.aborted, true); assert.equal(f.service.busy, true)
  assert.equal(f.service.state.run.status, 'stopping')
  release(); await f.service.wait()
  assert.equal(f.service.state.run.status, 'cancelled')
  assert.equal(f.service.state.run.output[0].text, 'partial\n')
  assert.equal(f.service.busy, false)
})
test('transport replacement interrupts work but selecting a different active phone does not redirect it', async () => {
  let release, signal
  const f = fixture((...args) => new Promise(resolve => { signal = args[5].signal; release = () => resolve({ stdout: '', stderr: '', code: 0 }) }))
  f.service.start(request); await Promise.resolve()
  f.connection.activeDeviceId = 'other'; f.service.contextChanged()
  assert.equal(signal.aborted, false)
  f.connection.devices[0].transportId = '8'; f.service.contextChanged()
  assert.equal(signal.aborted, true)
  release(); await f.service.wait()
  assert.equal(f.service.state.run.status, 'error')
  assert.match(f.service.state.run.message, /connection changed/)
  assert.equal(f.calls.length, 1)
})
test('output is bounded, control codes are stripped and history deduplicates without executing again', async () => {
  const f = fixture(async (...args) => {
    args[5].onStdout('\x1b[31m' + 'x'.repeat(70000) + 'tail\n')
    return { stdout: '', stderr: '', code: 0 }
  })
  for (let i = 0; i < 2; i++) { f.service.start(request); await f.service.wait() }
  assert.equal(f.service.state.run.output[0].text.length, 65536)
  assert.ok(f.service.state.run.output[0].text.endsWith('tail\n'))
  assert.equal(f.service.state.run.truncated, true)
  assert.equal(f.service.state.history.length, 1)
  f.service.clear()
  assert.equal(f.service.state.run, null); assert.deepEqual(f.service.state.history, [])
  assert.equal(f.calls.length, 2)
})
test('shutdown aborts pending command and rejects later runs', async () => {
  let signal
  const f = fixture((...args) => new Promise((resolve, reject) => {
    signal = args[5].signal
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  }))
  f.service.start(request); await Promise.resolve(); await f.service.shutdown()
  assert.equal(signal.aborted, true); assert.equal(f.service.busy, false)
  assert.throws(() => f.service.start(request), /closing/)
})
test('real process runner streams stderr and stdout and honours cancellation', async () => {
  const stdout = [], stderr = [], controller = new AbortController()
  const result = await run(process.execPath, ['-e', 'process.stdout.write("out"); process.stderr.write("err"); process.exitCode=3'], 5000, undefined, undefined, { onStdout: s => stdout.push(s), onStderr: s => stderr.push(s) })
  assert.equal(result.code, 3); assert.equal(stdout.join(''), 'out'); assert.equal(stderr.join(''), 'err')
  const stopped = run(process.execPath, ['-e', 'process.stderr.write("ready"); setInterval(()=>{},1000)'], 5000, undefined, undefined, {
    signal: controller.signal, onStderr: () => controller.abort(),
  })
  await assert.rejects(stopped, /cancelled/)
})
test('running console participates in the existing close-operation prompt', () => {
  const snapshot = { apps: { status: 'idle' }, connection: { busy: false, devices: [] }, adbConsole: { run: { status: 'running' } } }
  assert.ok(collectExitOperations(snapshot).some(s => s.startsWith('Console')))
  snapshot.adbConsole.run.status = 'success'
  assert.deepEqual(collectExitOperations(snapshot), [])
})
