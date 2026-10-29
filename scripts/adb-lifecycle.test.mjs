import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { AdbLifecycle } from '../dist-electron/adb-lifecycle.js'
import { run } from '../dist-electron/process.js'
import { Storage } from '../dist-electron/storage.js'

const ok = { code: 0, stdout: '', stderr: '' }
const adb = path.resolve('fake-tools', 'adb.exe')

test('Windows ADB startup tolerates delayed keepalive replies without extra commands or global changes', async () => {
  const calls = [], before = process.env.ADB_TCP_KEEPALIVE_INTERVAL
  const lifecycle = new AdbLifecycle(async (file, args, timeout, input, env) => { calls.push({ file, args, env }); return ok })
  const callerEnv = { ADB_MDNS_AUTO_CONNECT: 'adb-tls-connect' }
  await lifecycle.runner(adb, ['devices', '-l'], 6000, undefined, callerEnv)
  assert.deepEqual(calls.map(call => call.args), [['devices', '-l']])
  assert.equal(calls[0].env.ADB_TCP_KEEPALIVE_INTERVAL, process.platform === 'win32' ? before ?? '5' : undefined)
  assert.equal(calls[0].env.ADB_MDNS_AUTO_CONNECT, 'adb-tls-connect')
  assert.deepEqual(callerEnv, { ADB_MDNS_AUTO_CONNECT: 'adb-tls-connect' })
  assert.equal(process.env.ADB_TCP_KEEPALIVE_INTERVAL, before)
  await lifecycle.shutdown(false)
  assert.equal(calls.length, 1, 'Do not restart an existing server to apply the preference')
})

test('explicit ADB keepalive override is preserved and other executables keep their environment', async () => {
  const calls = []
  const lifecycle = new AdbLifecycle(async (file, args, timeout, input, env) => { calls.push({ file, args, env }); return ok })
  await lifecycle.runner(adb, ['start-server'], 6000, undefined, { ADB_TCP_KEEPALIVE_INTERVAL: '0' })
  assert.equal(calls[0].env.ADB_TCP_KEEPALIVE_INTERVAL, '0')
  const toolEnv = { EXAMPLE: 'unchanged' }
  await lifecycle.runner('scrcpy.exe', ['--version'], 6000, undefined, toolEnv)
  assert.equal(calls[1].env, toolEnv)
  assert.equal(calls[1].env.ADB_TCP_KEEPALIVE_INTERVAL, undefined)
  await lifecycle.shutdown(false)
})

test('shutdown waits for active clients, blocks new commands and stops the server exactly once', async () => {
  const calls = []; let finishClient
  const lifecycle = new AdbLifecycle((file, args, timeout, input, env, options) => {
    calls.push(args)
    if (args[0] === 'kill-server') { assert.equal(timeout, 5000); return Promise.resolve(ok) }
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => { finishClient = () => reject(new Error('cancelled')) }, { once: true })
    })
  })
  const client = lifecycle.runner(adb, ['devices', '-l']).catch(e => e.message)
  const shutdown = lifecycle.shutdown(true)
  assert.equal(lifecycle.shutdown(true), shutdown)
  assert.equal(calls.length, 1)
  await assert.rejects(lifecycle.runner(adb, ['devices']), /closing/)
  await assert.rejects(lifecycle.runner('powershell.exe', ['ignored']), /closing/)
  finishClient()
  assert.equal(await client, 'cancelled')
  await shutdown
  assert.deepEqual(calls, [['devices', '-l'], ['kill-server']])
})

test('disabled server shutdown still cancels this app clients', async () => {
  const calls = []
  const lifecycle = new AdbLifecycle((file, args, timeout, input, env, options) => {
    calls.push(args)
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }))
  })
  const client = lifecycle.runner(adb, ['shell', 'sleep', '100']).catch(e => e.message)
  await lifecycle.shutdown(false)
  assert.equal(await client, 'cancelled')
  assert.deepEqual(calls, [['shell', 'sleep', '100']])
})

test('shutdown before any ADB invocation does not start or kill a server', async () => {
  const lifecycle = new AdbLifecycle(async () => { throw new Error('must not run') })
  await lifecycle.shutdown(true)
})

test('caller cancellation remains functional and does not close the lifecycle', async () => {
  const controller = new AbortController()
  const lifecycle = new AdbLifecycle((file, args, timeout, input, env, options) => {
    if (args[0] === 'kill-server') return Promise.resolve(ok)
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('caller cancelled')), { once: true }))
  })
  const client = lifecycle.runner(adb, ['shell'], undefined, undefined, undefined, { signal: controller.signal }).catch(e => e.message)
  controller.abort()
  assert.equal(await client, 'caller cancelled')
  assert.equal(lifecycle.closing, false)
  await lifecycle.shutdown(true)
})

test('kill-server errors propagate and late commands stay blocked', async () => {
  const lifecycle = new AdbLifecycle(async (file, args) => args[0] === 'kill-server' ? { ...ok, code: 1, stderr: 'server failure' } : ok)
  await lifecycle.runner(adb, ['version'])
  await assert.rejects(lifecycle.shutdown(true), /server failure/)
  await assert.rejects(lifecycle.runner(adb, ['devices']), /closing/)
})

test('process cancellation resolves only after the client actually exits', async () => {
  const controller = new AbortController(); let pid
  const command = run(process.execPath, ['-e', 'console.log(process.pid);setInterval(()=>{},1000)'], 10000, undefined, undefined, {
    signal: controller.signal,
    onStdout: output => { pid = Number(output.trim()); controller.abort() },
  })
  await assert.rejects(command, /cancelled/)
  assert.ok(pid > 0)
  assert.throws(() => process.kill(pid, 0))
})

test('server shutdown defaults on and an explicit disabled choice survives reload', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'adb-vault-exit-test-'))
  try {
    const storage = new Storage(root); await storage.load()
    assert.equal(storage.data.stopAdbOnExit !== false, true)
    storage.data.stopAdbOnExit = false; await storage.save(); await storage.flush()
    const reload = new Storage(root); await reload.load()
    assert.equal(reload.data.stopAdbOnExit, false)
  } finally { await rm(root, { recursive: true, force: true }) }
})
