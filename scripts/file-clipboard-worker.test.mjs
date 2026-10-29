import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { WindowsFileClipboard } from '../dist-electron/file-clipboard-native.js'

// Exercise worker reuse, serialization and failure without touching Windows clipboard.
function fixture(t, respond) {
  const children = [], calls = []
  const port = new WindowsFileClipboard(() => {
    const child = new EventEmitter()
    child.stdout = new PassThrough(); child.stderr = new PassThrough()
    child.exitCode = null; child.signalCode = null
    child.kill = () => { child.signalCode = 'SIGTERM'; setImmediate(() => child.emit('exit', null, 'SIGTERM')); return true }
    child.stdin = new Writable({ write(bytes, _encoding, done) {
      const input = JSON.parse(String(bytes)); calls.push(input)
      setImmediate(() => respond(input, child, children.length))
      done()
    } })
    children.push(child)
    setImmediate(() => child.stdout.write('{"ready":true}\n'))
    return child
  })
  t.after(() => port.shutdown())
  return { port, children, calls }
}
const reply = (child, value) => child.stdout.write(JSON.stringify({ ok: true, value }) + '\n')
const options = { skip: process.platform !== 'win32' }

test('clipboard warmup and queued read/write/clear reuse one worker', options, async t => {
  let sequence = 1
  const f = fixture(t, (input, child) => reply(child, input.operation === 'read' ? { sequence, paths: [], mode: 'copy', marker: '' } : { sequence: ++sequence, changed: true }))
  await Promise.all([f.port.start(), f.port.start()])
  const results = await Promise.all([f.port.read(), f.port.write(['C:\\Music\\track.mp3'], 'copy', 'selection'), f.port.clear(2)])
  assert.equal(results[0].sequence, 1); assert.equal(results[1], 2); assert.equal(results[2], true)
  assert.equal(f.children.length, 1)
  assert.deepEqual(f.calls.map(c => c.operation), ['read', 'write', 'clear'])
})

test('clipboard operation rejection keeps worker available for the next command', options, async t => {
  const f = fixture(t, (input, child) => input.operation === 'write' ? child.stdout.write('{"ok":false,"error":"Clipboard busy"}\n') : reply(child, { sequence: 5, paths: [] }))
  await assert.rejects(f.port.write([], 'copy', 'failed'), /Clipboard busy/)
  assert.equal((await f.port.read()).sequence, 5); assert.equal(f.children.length, 1)
})

test('clipboard worker crash never retries a write; a later explicit command can restart it', options, async t => {
  const f = fixture(t, (input, child, generation) => generation === 1 ? child.emit('exit', 1) : reply(child, { sequence: 6, paths: [] }))
  await assert.rejects(f.port.write([], 'copy', 'crash'), /helper stopped/)
  assert.equal(f.calls.length, 1)
  assert.equal((await f.port.read()).sequence, 6); assert.equal(f.children.length, 2)
  // A late event from the failed process must not reject the new worker.
  f.children[0].emit('error', new Error('Old worker error'))
  assert.equal((await f.port.read()).sequence, 6)
})

test('clipboard shutdown rejects pending work and prevents another helper', options, async t => {
  const f = fixture(t, () => {})
  await f.port.start()
  const pending = f.port.read(), rejected = assert.rejects(pending, /shutting down/)
  await new Promise(resolve => setImmediate(resolve))
  await f.port.shutdown(); await rejected
  await assert.rejects(f.port.read(), /shutting down/)
  assert.equal(f.children.length, 1); assert.equal(f.children[0].signalCode, 'SIGTERM')
})
