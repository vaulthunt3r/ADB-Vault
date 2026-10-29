import test from 'node:test'
import assert from 'node:assert/strict'
import { validateTouchInput, editingKey } from '../dist-electron/touch-input.js'
import { TouchStream } from '../dist-electron/touch-stream.js'
import { touchTemplate, validateProfile } from '../dist-electron/touch-protocol.js'

test('Unicode input and editing keys are bounded; arbitrary keycodes cannot cross IPC', () => {
  for (const text of ['Привет, hello 👋', '日本語', 'مرحبا', 'a\nb\t']) validateTouchInput({ type: 'text', text })
  for (const value of [{ type: 'text', text: '' }, { type: 'text', text: 'x'.repeat(8193) }, { type: 'text', text: '\0' }, { type: 'key', key: 'POWER' }, { type: 'key', key: 'Enter', shift: 1 }, { type: 'scroll', x: -1, y: 0, dx: 0, dy: 1 }, { type: 'shell', text: 'id' }]) assert.throws(() => validateTouchInput(value))
  const key = code => ({ code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false })
  assert.equal(editingKey(key('KeyW')), undefined)
  assert.deepEqual(editingKey({ ...key('KeyV'), ctrlKey: true }), { type: 'paste' })
  assert.equal(editingKey({ ...key('Tab'), altKey: true }), undefined)
  assert.deepEqual(editingKey({ ...key('ArrowLeft'), shiftKey: true }), { type: 'key', key: 'ArrowLeft', shift: true, control: false })
  const legacy = touchTemplate('racing'); validateProfile(legacy); assert.equal(legacy.autoStart, undefined)
  legacy.autoStart = true; validateProfile(legacy)
  legacy.autoStart = 'yes'; assert.throws(() => validateProfile(legacy))
})

test('input checks display identity, bounds the queue and rejects pending commands when closed', async () => {
  const target = { adb: 'not-running', device: { serial: 'test', hardwareId: 'test' }, userId: 0, packageName: 'dev.test', pid: 1, displayId: 4 }
  const stream = new TouchStream('', () => target, () => {})
  stream.geometry = { epoch: 3 }
  const writes = []
  stream.child = { stdin: { writable: true, writableLength: 0, write: line => writes.push(JSON.parse(line)), end: () => {} }, once: () => {}, kill: () => {} }
  assert.throws(() => stream.input(2, { type: 'text', text: 'stale' }), /display changed/)
  const pending = Array.from({ length: 64 }, () => stream.input(3, { type: 'text', text: 'Ж' }))
  assert.equal(writes.length, 64); assert.equal(writes[0].input.text, 'Ж'); assert.equal(writes[63].id, 64)
  assert.throws(() => stream.input(3, { type: 'text', text: 'overflow' }), /faster/)
  const settled = Promise.allSettled(pending)
  stream.close()
  assert.ok((await settled).every(p => p.status === 'rejected'))
  assert.throws(() => stream.input(3, { type: 'key', key: 'Enter' }), /closed/)
})
