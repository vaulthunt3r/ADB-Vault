import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { FileIO, FilesService } from '../dist-electron/files.js'
import { FileClipboardService } from '../dist-electron/file-clipboard.js'

const local = path => ({ kind: 'local', path })
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'adb-vault-clipboard-test-')))
  const source = path.join(root, 'source'), destination = path.join(root, 'destination')
  await fs.mkdir(source); await fs.mkdir(destination)
  const io = new FileIO(() => null, () => ({ devices: [] })), events = [], files = new FilesService(io, e => events.push(e))
  const port = {
    current: { sequence: 1, mode: 'copy', paths: [], marker: '' }, writes: [],
    async read() { return structuredClone(this.current) },
    async write(paths, mode, marker, expected) {
      if (expected !== undefined && expected !== this.current.sequence) throw new Error('The clipboard changed.')
      this.current = { sequence: this.current.sequence + 1, paths, mode, marker }; this.writes.push(structuredClone(this.current)); return this.current.sequence
    },
    async clear(expected) { if (expected !== this.current.sequence) return false; this.current = { sequence: expected + 1, paths: [], mode: 'copy', marker: '' }; return true },
  }
  const service = new FileClipboardService(files, e => events.push(e), port, destination)
  t.after(async () => {
    const stopped = service.shutdown(); await files.shutdown(); await stopped
    if (!path.isAbsolute(root) || !path.basename(root).startsWith('adb-vault-clipboard-test-')) throw new Error('Invalid cleanup path')
    await fs.rm(root, { recursive: true, force: true })
  })
  const write = async (name, text = 'hello') => { const file = path.join(source, name); await fs.writeFile(file, text); return file }
  const selection = async paths => ({ source: local(source), items: await Promise.all(paths.map(async file => ({ path: file, fingerprint: (await io.stat(local(file))).fingerprint }))) })
  return { root, source, destination, io, files, events, port, service, write, selection }
}


async function phoneSelection(f, paths) {
  const source = { kind: 'device', path: '/sdcard', id: 'phone', serial: 'SERIAL', transportId: '7' }
  const map = l => l.kind === 'device' ? local(path.join(f.source, path.posix.relative('/sdcard', l.path))) : l
  const stat = f.io.stat.bind(f.io), canonical = f.io.canonical.bind(f.io), transfer = f.io.transfer.bind(f.io)
  f.io.device = () => ({ id: 'phone', serial: 'SERIAL', transportId: '7', status: 'connected' })
  f.io.canonical = l => l.kind === 'device' ? Promise.resolve(l) : canonical(l)
  f.io.stat = async (l, signal) => ({ ...await stat(map(l), signal), path: l.path })
  f.io.transfer = (from, to, ...rest) => transfer(map(from), map(to), ...rest)
  return { source, items: await Promise.all(paths.map(async file => ({ path: '/sdcard/' + path.basename(file), fingerprint: (await stat(local(file))).fingerprint }))) }
}

test('PC copy publishes native file paths and a subsequent paste copies real Unicode files', async t => {
  const f = await fixture(t), file = await f.write('музыка $ ` (1).txt'), selection = await f.selection([file])
  await f.service.write(selection, 'copy')
  assert.deepEqual(f.port.current.paths, [file]); assert.equal(f.port.current.mode, 'copy')
  const capture = await f.service.read(), [id] = await f.service.paste(capture.token, local(f.destination))
  assert.equal((await f.files.waitForTask(id)).status, 'success')
  assert.equal(await fs.readFile(path.join(f.destination, path.basename(file)), 'utf8'), 'hello')
  assert.equal(await fs.readFile(file, 'utf8'), 'hello'); assert.deepEqual(f.port.current.paths, [file])
})

test('cut is non-destructive until paste, consumed once and verified before source removal', async t => {
  const f = await fixture(t), file = await f.write('cut.txt'), selection = await f.selection([file])
  const capture = await f.service.write(selection, 'move')
  assert.equal(await fs.readFile(file, 'utf8'), 'hello'); assert.equal(f.port.current.mode, 'move')
  const [id] = await f.service.paste(capture.token, local(f.destination))
  assert.equal((await f.files.waitForTask(id)).status, 'success'); assert.equal(await f.io.exists(local(file)), null)
  assert.deepEqual(f.port.current.paths, [])
  await assert.rejects(f.service.paste(capture.token, local(f.source)), /expired/)
})

test('Explorer selections from multiple parents become separate copy tasks', async t => {
  const f = await fixture(t), one = await f.write('one.txt'), other = path.join(f.root, 'other'); await fs.mkdir(other)
  const two = path.join(other, 'two.txt'); await fs.writeFile(two, 'two')
  await f.port.write([one, two, one], 'copy', '')
  const capture = await f.service.read(); assert.equal(capture.groups.length, 2)
  const ids = await f.service.paste(capture.token, local(f.destination)); assert.equal(ids.length, 2)
  assert.ok((await Promise.all(ids.map(id => f.files.waitForTask(id)))).every(t => t.status === 'success'))
  assert.deepEqual(await fs.readdir(f.destination), ['one.txt', 'two.txt'])
})

test('changing the Windows clipboard after confirmation opens blocks the old paste', async t => {
  const f = await fixture(t), file = await f.write('old.txt')
  const capture = await f.service.write(await f.selection([file]), 'move')
  await f.port.write([], 'copy', 'new-text')
  await assert.rejects(f.service.paste(capture.token, local(f.destination)), /clipboard changed/)
  assert.equal(f.files.state.tasks.length, 0); assert.equal(await fs.readFile(file, 'utf8'), 'hello')
  assert.equal(await f.service.read(), undefined)
})

test('changed file fingerprint prevents moving a new file under an old clipboard selection', async t => {
  const f = await fixture(t), file = await f.write('changed.txt')
  const capture = await f.service.write(await f.selection([file]), 'move')
  await fs.writeFile(file, 'different contents')
  const [id] = await f.service.paste(capture.token, local(f.destination)), task = await f.files.waitForTask(id)
  assert.equal(task.status, 'error'); assert.match(task.items[0].message, /changed since selection/)
  assert.equal(await fs.readFile(file, 'utf8'), 'different contents'); assert.deepEqual(await fs.readdir(f.destination), [])
})

test('cut clearing never discards a more recent clipboard', async t => {
  const f = await fixture(t), file = await f.write('cut.txt'), capture = await f.service.write(await f.selection([file]), 'move')
  const clear = f.port.clear.bind(f.port)
  f.port.clear = async expected => { await f.port.write([], 'copy', 'newer'); return clear(expected) }
  const [id] = await f.service.paste(capture.token, local(f.destination)); await f.files.waitForTask(id)
  assert.equal(f.port.current.marker, 'newer')
})

test('all source groups are validated before any clipboard tasks start', async t => {
  const f = await fixture(t), file = await f.write('first.txt')
  const other = path.join(f.root, 'second.txt'); await fs.writeFile(other, 'second')
  await f.port.write([file, other], 'copy', '')
  const capture = await f.service.read(); assert.equal(capture.groups.length, 2)
  const validate = f.files.validateEnqueue.bind(f.files); let validated = 0
  f.files.validateEnqueue = plan => { if (++validated === 2) throw new Error('Files is shutting down.'); return validate(plan) }
  await assert.rejects(f.service.paste(capture.token, local(f.destination)), /shutting down/)
  assert.equal(f.files.state.tasks.length, 0)
})


test('ordinary phone Copy prepares cached files automatically and then pastes from that cache', async t => {
  const f = await fixture(t), file = await f.write('photo.jpg'), selection = await phoneSelection(f, [file])
  const capture = await f.service.write(selection, 'copy'), id = capture.preparationTaskId
  assert.ok(id); await f.files.waitForTask(id)
  const deadline = Date.now() + 3000
  while (f.port.writes.length < 2) { if (Date.now() > deadline) throw Error('No clipboard publication'); await new Promise(r => setTimeout(r, 5)) }
  const [saved] = f.port.current.paths
  assert.equal(path.basename(saved), 'photo.jpg'); assert.ok(path.dirname(saved).startsWith(path.join(f.destination, 'copy-')))
  assert.equal(await fs.readFile(saved, 'utf8'), 'hello'); assert.equal(await fs.readFile(file, 'utf8'), 'hello')
  assert.ok(f.events.some(e => e.type === 'notice' && /ready/.test(e.text)))
  assert.equal((await f.service.read()).preparationTaskId, undefined)
  const target = path.join(f.root, 'paste'); await fs.mkdir(target)
  const [paste] = await f.service.paste(capture.token, local(target))
  assert.equal((await f.files.waitForTask(paste)).source.kind, 'local')
  assert.equal(await fs.readFile(path.join(target, 'photo.jpg'), 'utf8'), 'hello')
})

test('automatic preparation never overwrites newer clipboard contents and keeps saved copies', async t => {
  const f = await fixture(t), file = await f.write('photo.jpg'), selection = await phoneSelection(f, [file]), transfer = f.io.transfer.bind(f.io)
  f.io.transfer = async (...args) => { await transfer(...args); await f.port.write([], 'copy', 'newer') }
  const capture = await f.service.write(selection, 'copy'), task = await f.files.waitForTask(capture.preparationTaskId)
  await new Promise(r => setTimeout(r, 30))
  assert.equal(task.status, 'success'); assert.equal(f.port.current.marker, 'newer')
  assert.equal(await fs.readFile(task.items[0].target, 'utf8'), 'hello')
  assert.ok(f.events.some(e => e.type === 'activity' && /clipboard could not be updated/.test(e.text)))
})

test('Paste waits for phone preparation; a new PC Copy cancels it without changing originals', async t => {
  const f = await fixture(t), file = await f.write('slow.jpg'), selection = await phoneSelection(f, [file])
  let started = false
  f.io.transfer = async (_from, _to, signal) => { started = true; await new Promise((_resolve, reject) => { if (signal.aborted) reject(Error('cancelled')); else signal.addEventListener('abort', () => reject(Error('cancelled')), { once: true }) }) }
  const capture = await f.service.write(selection, 'copy')
  await assert.rejects(f.service.paste(capture.token, local(f.source)), /still being prepared/)
  const limit = Date.now() + 3000
  while (!started) { if (Date.now() > limit) throw Error('Transfer did not start'); await new Promise(r => setTimeout(r, 5)) }
  const pc = await f.write('pc.txt'); await f.service.write(await f.selection([pc]), 'copy')
  assert.equal((await f.files.waitForTask(capture.preparationTaskId)).status, 'cancelled')
  assert.deepEqual(f.port.current.paths, [pc]); assert.equal(await fs.readFile(file, 'utf8'), 'hello')
})

test('failed automatic preparation exposes no incomplete Windows files', async t => {
  const f = await fixture(t), file = await f.write('bad.jpg'), selection = await phoneSelection(f, [file])
  f.io.transfer = async () => { throw new Error('Disconnected') }
  const capture = await f.service.write(selection, 'copy')
  assert.equal((await f.files.waitForTask(capture.preparationTaskId)).status, 'error')
  assert.deepEqual(f.port.current.paths, []); assert.equal(f.port.writes.length, 1)
  await assert.rejects(f.service.paste(capture.token, local(f.source)), /did not finish/)
})

test('phone Cut keeps pinned source metadata and never masquerades as moving cached copies', async t => {
  const f = await fixture(t), file = await f.write('track.mp3'), selection = await phoneSelection(f, [file])
  const result = await f.service.write(selection, 'move')
  assert.equal(result.preparationTaskId, undefined); assert.equal(f.files.state.tasks.length, 0)
  assert.deepEqual(f.port.current.paths, [])
  assert.deepEqual((await f.service.read()).groups[0].source, selection.source)
})
