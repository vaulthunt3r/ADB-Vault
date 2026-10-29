import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { FileIO, FilesService, validateFilePlan, validateLocation } from '../dist-electron/files.js'
import { filePattern, nameProblem } from '../dist-electron/files-protocol.js'
import { run } from '../dist-electron/process.js'

const emptyConnection = () => ({ devices: [] })
const local = p => ({ kind: 'local', path: p })
const waitFor = async fn => { const start = Date.now(); while (!fn()) { if (Date.now() - start > 7000) throw new Error('Timed out waiting for file task'); await new Promise(r => setTimeout(r, 10)) } }
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'adb-vault-files-test-')))
  t.after(async () => { if (!path.basename(root).startsWith('adb-vault-files-test-')) throw new Error('Unexpected cleanup path'); await fs.rm(root, { recursive: true, force: true }) })
  const source = path.join(root, 'source'), destination = path.join(root, 'destination'); await fs.mkdir(source); await fs.mkdir(destination)
  const io = new FileIO(() => null, emptyConnection), events = [], service = new FilesService(io, e => events.push(e))
  t.after(() => service.shutdown())
  const write = async (name, text = 'hello') => { const p = path.join(source, name); await fs.writeFile(p, text); return p }
  const plan = async (action, paths, extra = {}) => ({ action, source: local(source), destination: ['copy', 'move'].includes(action) ? local(destination) : undefined, confirmed: true, conflict: 'ask', items: await Promise.all(paths.map(async p => ({ path: p, fingerprint: (await io.stat(local(p))).fingerprint }))), ...extra })
  const finish = async id => { await waitFor(() => ['success', 'partial', 'error', 'cancelled'].includes(service.state.tasks.find(t => t.id === id).status)); return service.state.tasks.find(t => t.id === id) }
  return { root, source, destination, io, service, events, write, plan, finish }
}

test('actual local listing handles unicode, spaces and hidden files; path validation rejects escapes', async t => {
  const f = await fixture(t); await f.write('отчёт final.txt'); await f.write('.hidden')
  const result = await f.io.list(local(f.source)); assert.equal(result.entries.length, 2); assert.equal(result.parent, f.root)
  assert.throws(() => validateLocation(local(path.join(f.source, 'x') + path.sep + '..')), /normalized/)
  assert.throws(() => validateLocation(local('relative')), /absolute/)
  assert.throws(() => validateFilePlan({ ...{ action: 'delete', source: local(f.source), confirmed: true, conflict: 'ask' }, items: [{ path: f.root, fingerprint: '' }] }), /outside/)
  assert.equal(filePattern('*.ap?').test('Hello.apk'), true); assert.equal(nameProblem('CON.txt', true), 'This name cannot be used on Windows.')
})
test('copies real files using complete staging; never overwrites before conflict choice', async t => {
  const f = await fixture(t), p = await f.write('a.txt', 'new')
  await fs.writeFile(path.join(f.destination, 'a.txt'), 'old')
  const id = f.service.enqueue(await f.plan('copy', [p])); await waitFor(() => f.service.state.tasks[0].status === 'conflict')
  assert.equal(await fs.readFile(path.join(f.destination, 'a.txt'), 'utf8'), 'old')
  f.service.resolve(id, 'keep-both', true); const task = await f.finish(id)
  assert.equal(task.status, 'success'); assert.equal(await fs.readFile(path.join(f.destination, 'a (2).txt'), 'utf8'), 'new')
  assert.equal((await fs.readdir(f.destination)).some(n => n.endsWith('.partial')), false)
  assert.equal(f.events.at(-2)?.source === 'files' || f.events.some(e => e.type === 'activity' && e.source === 'files'), true)
})
test('copies folders recursively, and verified move removes the source only after success', async t => {
  const f = await fixture(t), folder = path.join(f.source, 'nested'); await fs.mkdir(folder); await fs.writeFile(path.join(folder, 'payload.bin'), Buffer.from([0, 1, 255, 5]))
  const id = f.service.enqueue(await f.plan('move', [folder])), task = await f.finish(id)
  assert.equal(task.status, 'success', JSON.stringify(task.items)); assert.equal(await f.io.exists(local(folder)), null)
  assert.deepEqual(await fs.readFile(path.join(f.destination, 'nested', 'payload.bin')), Buffer.from([0, 1, 255, 5]))
  assert.equal(task.undoable, true)
  await f.service.control(id, 'undo'); await f.finish(f.service.state.tasks.at(-1).id)
  assert.ok(await fs.stat(folder))
})

test('folder transfer counts the entire tree before copying and reuses each directory listing', async t => {
  const f = await fixture(t), folder = path.join(f.source, 'photos')
  await fs.mkdir(path.join(folder, 'nested'), { recursive: true }); await fs.mkdir(path.join(folder, 'empty'))
  await fs.writeFile(path.join(folder, 'a.txt'), 'a'); await fs.writeFile(path.join(folder, 'nested', 'b.txt'), 'bb'); await fs.writeFile(path.join(folder, 'nested', 'c.txt'), 'ccc')
  const list = f.io.listComplete.bind(f.io), transfer = f.io.transfer.bind(f.io), visited = []
  let transfers = 0, waiting = false, release
  const gate = new Promise(resolve => { release = resolve })
  t.after(() => release())
  f.io.listComplete = (...args) => { visited.push(args[0].path); return list(...args) }
  f.io.transfer = async (...args) => { if (++transfers === 2) { waiting = true; await gate }; return transfer(...args) }
  const id = f.service.enqueue(await f.plan('copy', [folder]))
  await waitFor(() => waiting)
  const active = f.service.state.tasks.find(t => t.id === id)
  assert.equal(active.completed, 0); assert.equal(active.items.length, 1)
  assert.equal(active.processedContents.files, 1); assert.equal(active.totalBytes, 6)
  assert.deepEqual(active.totalContents, { files: 3, folders: 3 })
  assert.ok(f.events.some(e => e.type === 'files' && e.state.tasks.some(t => t.id === id && t.phase === 'scanning' && t.bytes === 0)))
  assert.ok(f.events.some(e => e.type === 'files' && e.state.tasks.some(t => t.id === id && t.completed === 0 && t.processedContents?.files === 1)))
  release(); const result = await f.finish(id)
  assert.equal(result.status, 'success'); assert.deepEqual(result.processedContents, { files: 3, folders: 3 }); assert.equal(result.completed, 1)
  assert.equal(visited.length, 3); assert.equal(new Set(visited).size, 3)
  assert.equal(await fs.readFile(path.join(f.destination, 'photos', 'nested', 'c.txt'), 'utf8'), 'ccc')
})

test('counting can pause and resume before any destination is changed', async t => {
  const f = await fixture(t), folder = path.join(f.source, 'album')
  await fs.mkdir(folder); await fs.writeFile(path.join(folder, 'track.mp3'), 'music')
  const list = f.io.listComplete.bind(f.io)
  let entered = false, release
  const gate = new Promise(resolve => { release = resolve }); t.after(() => release())
  f.io.listComplete = async (...args) => { entered = true; await gate; return list(...args) }
  const id = f.service.enqueue(await f.plan('copy', [folder]))
  await waitFor(() => entered)
  assert.equal(f.service.state.tasks[0].phase, 'scanning')
  await f.service.control(id, 'pause'); release()
  await waitFor(() => f.service.state.tasks[0].status === 'paused')
  assert.deepEqual(await fs.readdir(f.destination), [])
  await f.service.control(id, 'resume')
  const task = await f.finish(id)
  assert.equal(task.status, 'success'); assert.equal(task.totalBytes, 5)
  assert.deepEqual(task.processedContents, task.totalContents)
})

test('stopping the folder count performs no copy or move', async t => {
  const f = await fixture(t), folder = path.join(f.source, 'album')
  await fs.mkdir(folder); await fs.writeFile(path.join(folder, 'track.mp3'), 'music')
  const list = f.io.listComplete.bind(f.io)
  let entered = false, release
  const gate = new Promise(resolve => { release = resolve }); t.after(() => release())
  f.io.listComplete = async (...args) => { entered = true; await gate; return list(...args) }
  const id = f.service.enqueue(await f.plan('move', [folder])); await waitFor(() => entered)
  await f.service.control(id, 'cancel'); release()
  const task = await f.finish(id)
  assert.equal(task.status, 'cancelled'); assert.equal(task.bytes, 0)
  assert.deepEqual(await fs.readdir(f.destination), [])
  assert.equal(await fs.readFile(path.join(folder, 'track.mp3'), 'utf8'), 'music')
})

test('skipped nested folders are excluded from byte totals and counted separately', async t => {
  const f = await fixture(t), folder = path.join(f.source, 'album')
  await fs.mkdir(path.join(folder, 'skip'), { recursive: true }); await fs.writeFile(path.join(folder, 'skip', 'old.mp3'), '1234567')
  await fs.writeFile(path.join(folder, 'new.mp3'), '123')
  await fs.mkdir(path.join(f.destination, 'album', 'skip'), { recursive: true })
  const id = f.service.enqueue(await f.plan('copy', [folder]))
  await waitFor(() => f.service.state.tasks[0].status === 'conflict'); f.service.resolve(id, 'merge', false)
  await waitFor(() => f.service.state.tasks[0].conflict?.source === path.join(folder, 'skip'))
  f.service.resolve(id, 'skip', false)
  const task = await f.finish(id)
  assert.equal(task.status, 'partial'); assert.equal(task.bytes, 3); assert.equal(task.totalBytes, 3)
  assert.deepEqual(task.totalContents, { files: 1, folders: 1 }); assert.deepEqual(task.skippedContents, { files: 1, folders: 1 })
  assert.deepEqual(await fs.readdir(path.join(f.destination, 'album', 'skip')), [])
})

test('unreadable folder count leaves totals unknown and does not block other selected files', async t => {
  const f = await fixture(t), folder = path.join(f.source, 'denied'), file = await f.write('readable.txt', 'ok')
  await fs.mkdir(folder)
  const list = f.io.listComplete.bind(f.io)
  f.io.listComplete = async (...args) => { if (args[0].path === folder) throw new Error('Permission denied'); return list(...args) }
  const task = await f.finish(f.service.enqueue(await f.plan('copy', [folder, file])))
  assert.equal(task.status, 'partial'); assert.equal(task.totalBytes, undefined); assert.equal(task.totalContents, undefined)
  assert.match(task.progressNote, /Overall total unavailable.*Permission denied/)
  assert.equal(await fs.readFile(path.join(f.destination, 'readable.txt'), 'utf8'), 'ok')
})

test('counted file metadata is still checked before a move; changed originals are kept', async t => {
  const f = await fixture(t), folder = path.join(f.source, 'album')
  await fs.mkdir(folder); await fs.writeFile(path.join(folder, 'a.mp3'), 'first'); await fs.writeFile(path.join(folder, 'b.mp3'), 'second')
  const transfer = f.io.transfer.bind(f.io)
  f.io.transfer = async (...args) => { await transfer(...args); if (args[0].path.endsWith('a.mp3')) await fs.writeFile(path.join(folder, 'b.mp3'), 'changed since counting') }
  const task = await f.finish(f.service.enqueue(await f.plan('move', [folder])))
  assert.equal(task.status, 'error'); assert.match(task.items[0].message, /changed since selection/)
  assert.equal(await fs.readFile(path.join(folder, 'a.mp3'), 'utf8'), 'first')
  assert.equal(await fs.readFile(path.join(folder, 'b.mp3'), 'utf8'), 'changed since counting')
  assert.deepEqual(await fs.readdir(f.destination), [])
})

test('zero-byte files and empty nested folders have countable overall progress', async t => {
  const f = await fixture(t), folder = path.join(f.source, 'empty')
  await fs.mkdir(path.join(folder, 'nested'), { recursive: true }); await fs.writeFile(path.join(folder, 'zero.txt'), '')
  const task = await f.finish(f.service.enqueue(await f.plan('copy', [folder])))
  assert.equal(task.status, 'success'); assert.equal(task.totalBytes, 0)
  assert.deepEqual(task.totalContents, { files: 1, folders: 2 }); assert.deepEqual(task.processedContents, task.totalContents)
})

test('failed and skipped transfers do not count incomplete files as processed', async t => {
  const f = await fixture(t), a = await f.write('a.txt'), b = await f.write('b.txt'), original = f.io.transfer.bind(f.io)
  f.io.transfer = async (from, ...args) => { if (from.path === b) throw new Error('Read failed'); return original(from, ...args) }
  const result = await f.finish(f.service.enqueue(await f.plan('copy', [a, b])))
  assert.equal(result.status, 'partial'); assert.deepEqual(result.processedContents, { files: 1, folders: 0 })
  const skipped = await f.finish(f.service.enqueue(await f.plan('copy', [a], { conflict: 'skip' })))
  assert.equal(skipped.items[0].status, 'skipped'); assert.equal(skipped.completed, 1); assert.deepEqual(skipped.processedContents, { files: 0, folders: 0 })
})

test('move reports current-file bytes separately from verification and finalization', async t => {
  const f = await fixture(t), folder = path.join(f.source, 'album')
  await fs.mkdir(folder); await fs.writeFile(path.join(folder, 'track.mp3'), '0123456789')
  let transferWaiting = false, verifyWaiting = false, releaseTransfer, releaseVerify
  const transferring = new Promise(resolve => { releaseTransfer = resolve }), verifying = new Promise(resolve => { releaseVerify = resolve })
  t.after(() => { releaseTransfer(); releaseVerify() })
  f.io.transfer = async (from, to, _signal, progress) => {
    const bytes = await fs.readFile(from.path)
    await fs.writeFile(to.path, bytes.subarray(0, 4)); progress(4); transferWaiting = true; await transferring
    await fs.appendFile(to.path, bytes.subarray(4)); progress(6)
  }
  const hash = f.io.hash.bind(f.io)
  f.io.hash = async (...args) => { verifyWaiting = true; await verifying; return hash(...args) }
  const id = f.service.enqueue(await f.plan('move', [folder]))
  await waitFor(() => transferWaiting)
  let active = f.service.state.tasks.find(t => t.id === id)
  assert.equal(active.phase, 'transferring'); assert.deepEqual(active.fileProgress, { bytes: 4, totalBytes: 10 })
  assert.equal(active.bytes, 4); assert.equal(active.totalBytes, 10)
  assert.equal(active.completed, 0); assert.equal(active.processedContents.files, 0)
  releaseTransfer(); await waitFor(() => verifyWaiting)
  active = f.service.state.tasks.find(t => t.id === id)
  assert.equal(active.phase, 'verifying'); assert.equal(active.fileProgress.bytes, 10)
  assert.equal(active.processedContents.files, 0); assert.ok(await fs.stat(folder))
  releaseVerify(); const result = await f.finish(id)
  assert.equal(result.status, 'success'); assert.equal(result.phase, undefined); assert.equal(result.fileProgress, undefined)
  assert.deepEqual(result.processedContents, { files: 1, folders: 1 })
  assert.ok(f.events.some(e => e.type === 'files' && e.state.tasks.some(t => t.id === id && t.phase === 'finishing' && !t.fileProgress)))
  assert.equal(await fs.readFile(path.join(f.destination, 'album', 'track.mp3'), 'utf8'), '0123456789')
})
test('a failed or cancelled copy retains source and existing destination and cleans staging', async t => {
  const f = await fixture(t), p = await f.write('a.txt', 'original'); await fs.writeFile(path.join(f.destination, 'a.txt'), 'previous')
  f.io.transfer = async (_from, to) => { await fs.writeFile(to.path, 'partial'); throw new Error('Simulated disk failure') }
  const id = f.service.enqueue(await f.plan('move', [p], { conflict: 'replace' })), task = await f.finish(id)
  assert.equal(task.status, 'error'); assert.equal(await fs.readFile(p, 'utf8'), 'original'); assert.equal(await fs.readFile(path.join(f.destination, 'a.txt'), 'utf8'), 'previous')
  assert.deepEqual(await fs.readdir(f.destination), ['a.txt'])
})
test('stale selection and self/descendant targets are rejected without deleting data', async t => {
  const f = await fixture(t), p = await f.write('a.txt'), stale = await f.plan('delete', [p]); await fs.writeFile(p, 'changed content')
  const task = await f.finish(f.service.enqueue(stale)); assert.equal(task.status, 'error'); assert.match(task.items[0].message, /changed/)
  const same = await f.finish(f.service.enqueue(await f.plan('copy', [p], { destination: local(f.source) }))); assert.equal(same.status, 'error'); assert.match(same.items[0].message, /itself/)
  assert.equal(await fs.readFile(p, 'utf8'), 'changed content')
})
test('batch rename preflight rejects collisions before any rename; undo checks identities', async t => {
  const f = await fixture(t), a = await f.write('a.txt'), b = await f.write('b.txt')
  const base = await f.plan('rename', [a, b]); base.items[0].name = 'next.txt'; base.items[1].name = 'a.txt'
  const bad = await f.finish(f.service.enqueue(base)); assert.equal(bad.status, 'error'); assert.ok(await fs.stat(a))
  base.items[1].name = 'other.txt'; const id = f.service.enqueue(base), good = await f.finish(id); assert.equal(good.status, 'success')
  await fs.writeFile(path.join(f.source, 'next.txt'), 'changed')
  await assert.rejects(() => f.service.control(id, 'undo'), /changed/); assert.ok(await fs.stat(path.join(f.source, 'other.txt')))
})
test('queue pauses between files and stopping a conflict releases the next task', async t => {
  const f = await fixture(t), a = await f.write('a.txt'), b = await f.write('b.txt'); await fs.writeFile(path.join(f.destination, 'a.txt'), 'old')
  const one = f.service.enqueue(await f.plan('copy', [a])), two = f.service.enqueue(await f.plan('copy', [b]))
  await waitFor(() => f.service.state.tasks.find(t => t.id === one).status === 'conflict')
  assert.equal(f.service.state.tasks.find(t => t.id === two).status, 'queued')
  await f.service.control(two, 'pause'); await f.service.control(one, 'cancel')
  await waitFor(() => f.service.state.tasks.find(t => t.id === two).status === 'paused')
  assert.equal(await f.io.exists(local(path.join(f.destination, 'b.txt'))), null)
  await f.service.control(two, 'resume'); assert.equal((await f.finish(two)).status, 'success')
})
test('cancel during transfer cleans staging and never removes the source', async t => {
  const f = await fixture(t), p = await f.write('a.txt')
  let started = false
  f.io.transfer = async (_from, to, signal) => { await fs.writeFile(to.path, 'partial'); started = true; await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Operation cancelled.')), { once: true })) }
  const id = f.service.enqueue(await f.plan('move', [p])); await waitFor(() => started); await f.service.control(id, 'cancel')
  assert.equal((await f.finish(id)).status, 'cancelled'); assert.ok(await fs.stat(p)); assert.deepEqual(await fs.readdir(f.destination), [])
})
test('directory links are not traversed by recursive mutation', async t => {
  const f = await fixture(t), outside = path.join(f.root, 'outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'keep.txt'), 'keep')
  const folder = path.join(f.source, 'folder'); await fs.mkdir(folder); await fs.symlink(outside, path.join(folder, 'link'), process.platform === 'win32' ? 'junction' : 'dir')
  const task = await f.finish(f.service.enqueue(await f.plan('delete', [folder]))); assert.equal(task.status, 'error'); assert.match(task.items[0].message, /link/); assert.equal(await fs.readFile(path.join(outside, 'keep.txt'), 'utf8'), 'keep')
})
test('only unfinished known outcomes are retried; successful objects are not repeated', async t => {
  const f = await fixture(t), a = await f.write('a.txt'), b = await f.write('b.txt'), original = f.io.transfer.bind(f.io)
  f.io.transfer = async (from, ...args) => { if (from.path === b) throw new Error('Temporary error'); return original(from, ...args) }
  const id = f.service.enqueue(await f.plan('copy', [a, b])), task = await f.finish(id); assert.equal(task.status, 'partial')
  f.io.transfer = original; await f.service.control(id, 'retry'); const retry = f.service.state.tasks.at(-1); assert.deepEqual(retry.items.map(i => i.path), [b]); assert.equal((await f.finish(retry.id)).status, 'success')
})
test('phone metadata is NUL-framed, names are shell quoted, and exact transport is enforced', async () => {
  const d = { id: 'p', serial: 'SERIAL', transportId: '4', status: 'connected', root: { status: 'available', method: 'su' } }, calls = []
  const io = new FileIO(() => 'adb.exe', () => ({ devices: [d] }), async (_f, args) => { calls.push(args); return { stdout: "81a4\t5\t123\t2000\t2000\t9\t123\t2026-10-08 12:00:00.000000000\n/sdcard/O'Brien.txt\0", stderr: '', code: 0 } })
  const l = { kind: 'device', path: "/sdcard/O'Brien.txt", id: 'p', serial: 'SERIAL', transportId: '4', root: true }, e = await io.stat(l)
  assert.equal(e.name, "O'Brien.txt"); assert.equal(e.kind, 'file'); assert.equal(e.size, 5)
  assert.deepEqual(calls[0].slice(0, 4), ['-t', '4', 'shell', '-T']); assert.ok(calls[0][4].startsWith('su -c ')); assert.ok(calls[0][4].includes("'\\''"))
  d.transportId = '5'; await assert.rejects(() => io.stat(l), /connection changed/); assert.equal(calls.length, 1)
})

const phoneRecord = (p, mode = '41ed') => `${mode}\t5\t123\t2000\t2000\t9\t123\t2026-10-08 12:00:00.000000000\n${p}\0`
function phoneListing(result, folder = '/') {
  const d = { id: 'p', serial: 'PHONE', transportId: '4', status: 'connected', root: { status: 'available', method: 'adb' } }
  const location = { kind: 'device', path: folder, id: d.id, serial: d.serial, transportId: d.transportId }, calls = []
  const io = new FileIO(() => 'adb.exe', () => ({ devices: [d] }), async (_file, args) => {
    calls.push(args)
    const script = args.at(-1)
    if (script.startsWith('readlink ')) return { stdout: folder + '\n', stderr: '', code: 0 }
    if (script.startsWith('sh -c ')) return { stdout: phoneRecord(folder), stderr: '', code: 0 }
    assert.ok(script.startsWith('find '), 'Unexpected device command: ' + script)
    return result
  })
  return { io, location, calls }
}

test('phone listing retains readable entries when find denies protected children', async () => {
  const errors = ['/cache', '/data_mirror', '/init', '/init.environ.rc', '/linkerconfig', '/metadata', '/postinstall', '/system_dlkm']
  const f = phoneListing({ stdout: phoneRecord('/storage') + phoneRecord('/system'), stderr: errors.map(p => `find: '${p}': Permission denied`).join('\n'), code: 1 })
  const listing = await f.io.list(f.location)
  assert.deepEqual(listing.entries.map(e => e.name), ['storage', 'system', ...errors.map(p => p.slice(1))])
  assert.ok(listing.entries.slice(2).every(e => e.access === 'restricted' && e.kind === 'other' && !e.fingerprint && e.mode === undefined))
  assert.equal(listing.warning, '8 restricted items shown with a lock. Some properties or contents are unavailable; root may help.')
  assert.equal(f.calls.length, 3); assert.ok(f.calls.every(args => args.slice(0, 4).join(' ') === '-t 4 shell -T'))
  await assert.rejects(() => f.io.listComplete(f.location), /Cannot read every item/)
})

test('stat denials remain partial even when find returns zero, including an entirely restricted listing', async () => {
  const f = phoneListing({ stdout: phoneRecord('/sdcard/visible.txt', '81a4'), stderr: "stat: '/sdcard/secret': Permission denied\nfind: '/sdcard/secret': Permission denied\n", code: 0 }, '/sdcard')
  const listing = await f.io.list(f.location)
  assert.deepEqual(listing.entries.map(e => e.name), ['visible.txt', 'secret']); assert.match(listing.warning, /^1 restricted item shown with a lock/)
  assert.equal(listing.entries[1].access, 'restricted')
  const empty = phoneListing({ stdout: '', stderr: "stat: '/private/secret': Operation not permitted", code: 1 }, '/private')
  const restricted = await empty.io.list({ ...empty.location, root: true })
  assert.equal(restricted.entries.length, 1); assert.equal(restricted.entries[0].name, 'secret'); assert.equal(restricted.entries[0].access, 'restricted'); assert.match(restricted.warning, /even with the requested root access/)
  const clean = phoneListing({ stdout: '', stderr: '', code: 0 })
  assert.equal((await clean.io.list(clean.location)).warning, undefined)
})

test('phone listing access checks retain fingerprints and do not add device commands', async () => {
  const restrictedRecord = phoneRecord('/data').replace('\n', '\r\trestricted\r\n')
  const openRecord = phoneRecord('/storage').replace('\n', '\t\n')
  const f = phoneListing({ stdout: restrictedRecord + openRecord, stderr: '', code: 0 })
  const listing = await f.io.list(f.location)
  assert.equal(listing.entries[0].access, 'restricted'); assert.equal(listing.entries[0].kind, 'directory')
  assert.equal(listing.entries[1].access, undefined)
  assert.equal(listing.entries[0].fingerprint, '41ed:5:9:123:2026-10-08 12:00:00.000000000')
  assert.equal(f.calls.length, 3)
  assert.match(f.calls[2].at(-1), /\[ ! -r "\$f" \]/); assert.match(f.calls[2].at(-1), /\[ ! -x "\$f" \]/)
  const duplicate = phoneListing({ stdout: restrictedRecord, stderr: "find: '/data': Permission denied", code: 1 })
  const entries = (await duplicate.io.list(duplicate.location)).entries
  assert.equal(entries.length, 1); assert.equal(entries[0].kind, 'directory'); assert.ok(entries[0].fingerprint)
  const invalid = phoneListing({ stdout: phoneRecord('/storage').replace('\n', '\tunexpected\n'), stderr: '', code: 0 })
  await assert.rejects(() => invalid.io.list(invalid.location), /Invalid file access metadata/)
})

test('restricted name-only entries cannot become file-operation inputs', () => {
  const source = { kind: 'device', path: '/', id: 'phone', serial: 'PHONE', transportId: '4' }
  assert.throws(() => validateFilePlan({ action: 'delete', source, confirmed: true, conflict: 'ask', items: [{ path: '/private', fingerprint: '' }] }), /Properties of this object are unavailable/)
})

test('phone listing never suppresses denied parent access, unrelated errors, disconnects, or invalid metadata', async () => {
  const cases = [
    [{ code: 1, stderr: "find: '/': Permission denied" }, /does not allow reading this folder/],
    [{ code: 1, stderr: "find: '/cache/child': Permission denied" }, /Permission denied/],
    [{ code: 1, stderr: "find: '/cache': Permission denied\nerror: device offline" }, /device offline/],
    [{ code: 0, stderr: 'stat: unsupported option' }, /unsupported option/],
    [{ code: 2, stderr: "find: '/cache': Permission denied" }, /Permission denied/],
    [{ code: 1, stderr: '', stdout: '' }, /Command exited with code 1/],
    [{ code: 1, stderr: "find: '/cache': Permission denied", stdout: 'broken record\0' }, /supported file metadata/],
  ]
  for (const [result, expected] of cases) {
    const f = phoneListing({ stdout: phoneRecord('/storage'), ...result })
    await assert.rejects(() => f.io.list(f.location), expected)
  }
})

test('partial directory reads never publish a copy, delete a source, or report a complete size', async t => {
  const f = await fixture(t), folder = path.join(f.source, 'restricted'); await fs.mkdir(folder)
  const visible = path.join(folder, 'visible.txt'), hidden = path.join(folder, 'secret.txt')
  await fs.writeFile(visible, 'visible'); await fs.writeFile(hidden, 'keep private content')
  const originalList = f.io.list.bind(f.io)
  f.io.list = async (...args) => {
    const listing = await originalList(...args)
    return args[0].path === folder ? { ...listing, entries: listing.entries.filter(e => e.path !== hidden), warning: '1 restricted item skipped. Android denied access.' } : listing
  }
  for (const action of ['copy', 'move', 'delete']) {
    const task = await f.finish(f.service.enqueue(await f.plan(action, [folder])))
    assert.equal(task.status, 'error', action); assert.match(task.items[0].message, /Cannot read every item/)
    assert.equal(await fs.readFile(hidden, 'utf8'), 'keep private content'); assert.equal(await fs.readFile(visible, 'utf8'), 'visible')
    assert.deepEqual(await fs.readdir(f.destination), [], 'No incomplete destination or staging directory may remain')
  }
  await assert.rejects(() => f.service.properties(local(folder), true), /Cannot read every item/)
  assert.match((await f.service.list(local(f.source), true)).warning, /restricted item/)
})

test('Android LF and CRLF metadata produce identical fingerprints without trimming filenames or timestamp precision', async () => {
  const device = { id: 'p', serial: 'PHONE', transportId: '3', status: 'connected' }
  const source = { kind: 'device', id: 'p', serial: 'PHONE', transportId: '3', path: '/sdcard' }
  const file = '/sdcard/ photo.jpg ', preciseTime = '2025-12-09 14:39:44.549616531 +0300'
  const expected = `81f8:387154:152868:1765485141:${preciseTime}`
  for (const ending of ['\n', '\r\n']) {
    const record = (file, hex = '81f8') => `${hex}\t387154\t1765294784\t0\t0\t152868\t1765485141\t${preciseTime}${ending}${file}\0`
    const io = new FileIO(() => 'adb.exe', () => ({ devices: [device] }), async (_exe, args) => ({ code: 0, stderr: '', stdout: args.at(-1).startsWith('readlink') ? source.path : args.at(-1).startsWith('find') || args.at(-1).includes('photo.jpg') ? record(file) : record(source.path, '41ed') }))
    const stat = await io.stat({ ...source, path: file }), listing = await io.list(source, undefined, false)
    assert.equal(stat.fingerprint, expected); assert.equal(listing.entries[0].fingerprint, expected)
    assert.equal(stat.name, ' photo.jpg '); assert.equal(listing.entries[0].path, file)
    assert.doesNotMatch(stat.fingerprint, /[\x00-\x1f]/)
  }
})

test('phone binary copies use exec-out with a completion frame, retaining LF and CR bytes', async t => {
  const f = await fixture(t), payload = Buffer.from([80, 75, 3, 4, 0, 10, 13, 255, 128, 0])
  const device = { id: 'p', serial: 'PHONE', transportId: '4', status: 'connected' }
  const location = { kind: 'device', path: '/sdcard/data.bin', id: 'p', serial: 'PHONE', transportId: '4' }
  for (const status of ['0', '1', 'missing']) {
    const file = path.join(f.destination, status + '.bin')
    const io = new FileIO(() => 'adb.exe', () => ({ devices: [device] }), async (_file, args, _timeout, _input, _env, controls) => {
      assert.deepEqual(args.slice(0, 3), ['-t', '4', 'exec-out'])
      const token = args[3].match(/ADB_VAULT_EXPORT_([a-f0-9-]{36})/)[1]
      await fs.writeFile(controls.stdoutFile, Buffer.concat([payload, status === 'missing' ? Buffer.alloc(0) : Buffer.from(`\nADB_VAULT_EXPORT_${token}:${status}\n`)]))
      return { stdout: '', stderr: '', code: 0 }
    })
    if (status === '0') { await io.command(location, "cat -- '/sdcard/data.bin'", undefined, file); assert.deepEqual(await fs.readFile(file), payload) }
    else await assert.rejects(() => io.command(location, "cat -- '/sdcard/data.bin'", undefined, file), /No complete copy was saved/)
  }
})

test('binary streaming reports bytes without altering the file or command result', async t => {
  const f = await fixture(t), target = path.join(f.destination, 'bytes.bin'); let bytes = 0
  const result = await run(process.execPath, ['-e', 'process.stdout.write(Buffer.from([0,10,13,255,128,0]))'], 5000, undefined, undefined, { stdoutFile: target, onStdoutBytes: n => { bytes += n } })
  assert.equal(result.code, 0); assert.equal(bytes, 6); assert.deepEqual(await fs.readFile(target), Buffer.from([0, 10, 13, 255, 128, 0]))
})
test('two independent local transfers can run concurrently', async t => {
  const f = await fixture(t), g = await fixture(t), a = await f.write('a.txt'), b = await g.write('b.txt')
  let started = 0, release; const gate = new Promise(resolve => { release = resolve }), original = f.io.transfer.bind(f.io)
  f.io.transfer = async (...args) => { started++; await gate; return original(...args) }
  const one = f.service.enqueue(await f.plan('copy', [a])), two = f.service.enqueue(await g.plan('copy', [b]))
  await waitFor(() => started === 2); release(); assert.equal((await f.finish(one)).status, 'success'); assert.equal((await f.finish(two)).status, 'success')
})
test('late change inside a copied folder prevents deletion of the source', async t => {
  const f = await fixture(t), folder = path.join(f.source, 'folder'); await fs.mkdir(folder)
  const a = path.join(folder, 'a.txt'), b = path.join(folder, 'b.txt'); await fs.writeFile(a, 'first'); await fs.writeFile(b, 'second')
  const original = f.io.rename.bind(f.io)
  f.io.rename = async (...args) => { await original(...args); await fs.writeFile(a, 'changed after copying') }
  const result = await f.finish(f.service.enqueue(await f.plan('move', [folder])))
  assert.equal(result.status, 'partial'); assert.match(result.items[0].message, /changed/); assert.equal(await fs.readFile(a, 'utf8'), 'changed after copying')
  assert.equal(await fs.readFile(path.join(f.destination, 'folder', 'a.txt'), 'utf8'), 'first')
})
test('connection loss interrupts the active transfer promptly without redirecting it', async t => {
  const f = await fixture(t), originalStat = f.io.stat.bind(f.io), originalCanonical = f.io.canonical.bind(f.io)
  const source = { kind: 'device', path: '/sdcard', id: 'p', serial: 'PHONE', transportId: '7' }
  f.io.device = () => ({ id: 'p', serial: 'PHONE', transportId: '7', status: 'connected' })
  f.io.canonical = l => l.kind === 'device' ? Promise.resolve(l) : originalCanonical(l)
  f.io.stat = l => l.kind === 'device' ? Promise.resolve({ name: 'a.txt', path: l.path, kind: l.path === '/sdcard' ? 'directory' : 'file', size: 5, modified: 1, fingerprint: 'original' }) : originalStat(l)
  let started = false
  f.io.transfer = async (_from, to, signal) => { await fs.writeFile(to.path, 'partial'); started = true; await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Operation cancelled.')), { once: true })) }
  const id = f.service.enqueue({ action: 'copy', source, destination: local(f.destination), items: [{ path: '/sdcard/a.txt', fingerprint: 'original' }], conflict: 'ask', confirmed: true })
  await waitFor(() => started)
  f.service.connectionChanged({ devices: [{ id: 'p', serial: 'OTHER', transportId: '8', status: 'connected' }] })
  const task = await f.finish(id); assert.equal(task.status, 'error'); assert.match(task.items[0].message, /connection changed or was lost/)
  assert.deepEqual(await fs.readdir(f.destination), [])
})


test('folder merge keeps destination-only files and asks separately about nested file collisions', async t => {
  const f = await fixture(t), from = path.join(f.source, 'album'), to = path.join(f.destination, 'album')
  await fs.mkdir(path.join(from, 'nested'), { recursive: true }); await fs.mkdir(path.join(to, 'nested'), { recursive: true })
  await fs.writeFile(path.join(from, 'nested', 'track.txt'), 'new'); await fs.writeFile(path.join(to, 'nested', 'track.txt'), 'old')
  await fs.writeFile(path.join(to, 'keep.txt'), 'destination only'); await fs.writeFile(path.join(from, 'extra.txt'), 'extra')
  const id = f.service.enqueue(await f.plan('copy', [from]))
  await waitFor(() => f.service.state.tasks[0].conflict?.mergeable)
  f.service.resolve(id, 'merge', true)
  await waitFor(() => f.service.state.tasks[0].conflict?.source === path.join(from, 'nested', 'track.txt'))
  assert.equal(f.service.state.tasks[0].conflict.mergeable, false)
  assert.equal(await fs.readFile(path.join(to, 'nested', 'track.txt'), 'utf8'), 'old')
  f.service.resolve(id, 'keep-both', false)
  const result = await f.finish(id)
  assert.equal(result.status, 'success', JSON.stringify(result.items)); assert.equal(result.undoable, false)
  assert.equal(await fs.readFile(path.join(to, 'nested', 'track (2).txt'), 'utf8'), 'new')
  assert.equal(await fs.readFile(path.join(to, 'keep.txt'), 'utf8'), 'destination only')
  assert.equal(await fs.readFile(path.join(from, 'extra.txt'), 'utf8'), 'extra')
})

test('merge move leaves skipped originals and removes only fully moved directories', async t => {
  const f = await fixture(t), from = path.join(f.source, 'album'), to = path.join(f.destination, 'album')
  await fs.mkdir(path.join(from, 'empty'), { recursive: true }); await fs.mkdir(path.join(to, 'empty'), { recursive: true })
  await fs.writeFile(path.join(from, 'a.txt'), 'keep source'); await fs.writeFile(path.join(to, 'a.txt'), 'keep dest')
  await fs.writeFile(path.join(from, 'b.txt'), 'move this')
  const id = f.service.enqueue(await f.plan('move', [from], { conflict: 'merge' }))
  await waitFor(() => f.service.state.tasks[0].conflict?.source === path.join(from, 'a.txt'))
  f.service.resolve(id, 'skip', true)
  const result = await f.finish(id)
  assert.equal(result.status, 'partial', JSON.stringify(result.items)); assert.equal(result.items[0].skipped, 1)
  assert.deepEqual(await fs.readdir(from), ['a.txt'])
  assert.equal(await fs.readFile(path.join(from, 'a.txt'), 'utf8'), 'keep source')
  assert.equal(await fs.readFile(path.join(to, 'a.txt'), 'utf8'), 'keep dest')
  assert.equal(await fs.readFile(path.join(to, 'b.txt'), 'utf8'), 'move this')
  assert.equal(result.undoable, false)
  await assert.rejects(f.service.control(id, 'retry'), /No safe/)
})

test('complete merge move removes source and preserves destination-only children', async t => {
  const f = await fixture(t), from = path.join(f.source, 'album'), to = path.join(f.destination, 'album')
  await fs.mkdir(from); await fs.mkdir(to); await fs.writeFile(path.join(from, 'new.txt'), 'new'); await fs.writeFile(path.join(to, 'old.txt'), 'old')
  const result = await f.finish(f.service.enqueue(await f.plan('move', [from], { conflict: 'merge' })))
  assert.equal(result.status, 'success', JSON.stringify(result.items)); assert.equal(await f.io.exists(local(from)), null)
  assert.deepEqual(await fs.readdir(to), ['new.txt', 'old.txt'])
})

test('failed verification during merge move retains that original and earlier completed changes', async t => {
  const f = await fixture(t), from = path.join(f.source, 'album'), to = path.join(f.destination, 'album')
  await fs.mkdir(from); await fs.mkdir(to)
  await fs.writeFile(path.join(from, 'a.txt'), 'one'); await fs.writeFile(path.join(from, 'b.txt'), 'two')
  const transfer = f.io.transfer.bind(f.io)
  f.io.transfer = async (...args) => { await transfer(...args); if (args[0].path.endsWith('b.txt')) await fs.writeFile(args[1].path, 'bad') }
  const result = await f.finish(f.service.enqueue(await f.plan('move', [from], { conflict: 'merge' })))
  assert.equal(result.status, 'partial', JSON.stringify(result.items))
  assert.equal(await fs.readFile(path.join(from, 'b.txt'), 'utf8'), 'two'); assert.equal(await f.io.exists(local(path.join(from, 'a.txt'))), null)
  assert.equal(await fs.readFile(path.join(to, 'a.txt'), 'utf8'), 'one'); assert.deepEqual(await fs.readdir(to), ['a.txt'])
})

test('merge refuses replacement by a different directory while conflict is pending', async t => {
  const f = await fixture(t), from = path.join(f.source, 'album'), to = path.join(f.destination, 'album')
  await fs.mkdir(from); await fs.mkdir(to); await fs.writeFile(path.join(from, 'a.txt'), 'safe')
  const id = f.service.enqueue(await f.plan('move', [from]))
  await waitFor(() => f.service.state.tasks[0].conflict?.mergeable)
  await fs.rename(to, to + '-original'); await fs.mkdir(to)
  f.service.resolve(id, 'merge', true)
  const result = await f.finish(id)
  assert.equal(result.status, 'error'); assert.equal(await fs.readFile(path.join(from, 'a.txt'), 'utf8'), 'safe')
  assert.deepEqual(await fs.readdir(to), [])
})

test('a newly added source child during merge move is never recursively deleted', async t => {
  const f = await fixture(t), from = path.join(f.source, 'album'), to = path.join(f.destination, 'album')
  await fs.mkdir(from); await fs.mkdir(to); await fs.writeFile(path.join(from, 'a.txt'), 'a')
  const transfer = f.io.transfer.bind(f.io)
  f.io.transfer = async (...args) => { await transfer(...args); await fs.writeFile(path.join(from, 'late.txt'), 'keep me') }
  const result = await f.finish(f.service.enqueue(await f.plan('move', [from], { conflict: 'merge' })))
  assert.equal(result.status, 'partial'); assert.equal(await fs.readFile(path.join(from, 'late.txt'), 'utf8'), 'keep me')
  assert.equal(await fs.readFile(path.join(to, 'a.txt'), 'utf8'), 'a')
})

test('merge mode does not merge a file and folder with the same name', async t => {
  const f = await fixture(t), from = await f.write('same'), to = path.join(f.destination, 'same'); await fs.mkdir(to)
  const id = f.service.enqueue(await f.plan('copy', [from], { conflict: 'merge' }))
  await waitFor(() => f.service.state.tasks[0].status === 'conflict')
  assert.equal(f.service.state.tasks[0].conflict.mergeable, false)
  assert.throws(() => f.service.resolve(id, 'merge', false), /only for two folders/)
  f.service.resolve(id, 'keep-both', false)
  assert.equal((await f.finish(id)).status, 'success'); assert.equal(await fs.readFile(to + ' (2)', 'utf8'), 'hello')
})


test('skipping all files in a merge is partial completion, not an operation error', async t => {
  const f = await fixture(t), from = path.join(f.source, 'album'), to = path.join(f.destination, 'album')
  await fs.mkdir(from); await fs.mkdir(to)
  await fs.writeFile(path.join(from, 'a.txt'), 'source'); await fs.writeFile(path.join(to, 'a.txt'), 'dest')
  const id = f.service.enqueue(await f.plan('move', [from], { conflict: 'merge' }))
  await waitFor(() => f.service.state.tasks[0].status === 'conflict')
  f.service.resolve(id, 'skip', false)
  assert.equal((await f.finish(id)).status, 'partial')
  assert.equal(await fs.readFile(path.join(from, 'a.txt'), 'utf8'), 'source')
  assert.equal(await fs.readFile(path.join(to, 'a.txt'), 'utf8'), 'dest')
})
