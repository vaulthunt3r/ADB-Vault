import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import yazl from 'yazl'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { FileIO } from '../dist-electron/files.js'
import { FileSearchService, validateSearchQuery } from '../dist-electron/file-search.js'
import { categoryQuery } from '../dist-electron/file-categories.js'
import { defaultSearchQuery } from '../dist-electron/file-search-protocol.js'

const local = path => ({ kind: 'local', path })

test('category include/exclude rules prune traversal, with exclusions winning and no sibling prefix matches', async t => {
  const f = await fixture(t), wanted = await f.write('Pictures/Trip/a.jpg')
  await f.write('Pictures/Private/b.jpg'); await f.write('Pictures/icons/c.png'); await f.write('Pictures/.cache/d.jpg')
  await f.write('PicturesBackup/e.jpg'); await f.write('Elsewhere/f.jpg')
  const visited = [], original = f.io.list.bind(f.io)
  f.io.list = async (...args) => { visited.push(path.relative(f.folder, args[0].path)); return original(...args) }
  const q = categoryQuery('images', undefined, { include: ['Pictures', 'Pictures/Trip'], exclude: ['Pictures/Private'] })
  const result = await f.search(q)
  assert.equal(result.status, 'complete', result.message); assert.deepEqual(result.results.map(r => r.entry.path), [wanted])
  assert.deepEqual(visited.sort(), ['Pictures', path.join('Pictures', 'Trip')].sort())
  const index = await f.build(); assert.equal(index.status, 'complete')
  const indexed = await f.search({ ...q, source: 'index' })
  assert.deepEqual(indexed.results.map(r => r.entry.path), [wanted])
})

test('service folders and icon extensions can be explicitly included; normal SVG/PNG are retained', async t => {
  const f = await fixture(t)
  for (const name of ['photo.png', 'drawing.svg', 'favicon.ico', 'cursor.cur', 'icon.icns', 'icons/app.png', '.icons/a.svg', 'cache/b.png', '.cache/c.png', 'thumbnails/d.png', '.thumbnails/e.png']) await f.write(name)
  let result = await f.search(categoryQuery('images'))
  assert.deepEqual(result.results.map(r => r.entry.name).sort(), ['drawing.svg', 'photo.png'])
  result = await f.search(categoryQuery('images', { visible: true, iconFiles: true, serviceFolders: ['icons', 'cache', 'thumbnails'] }))
  assert.equal(result.matched, 11)
  const excluded = await f.search(categoryQuery('images', { visible: true, iconFiles: true, serviceFolders: ['icons'] }, { include: [], exclude: ['icons'] }))
  assert.ok(!excluded.results.some(r => r.entry.path === path.join(f.folder, 'icons/app.png')))
})

test('folder rules apply to every category and absent included folders produce notices', async t => {
  const f = await fixture(t)
  for (const [category, extension] of Object.entries({ images: 'jpg', videos: 'mp4', audio: 'mp3', documents: 'pdf', archives: 'zip' })) {
    await f.write(`Keep/file.${extension}`); await f.write(`Skip/file.${extension}`)
    const result = await f.search(categoryQuery(category, undefined, { include: ['Keep', 'Missing'], exclude: ['Skip'] }))
    assert.equal(result.matched, 1); assert.ok(result.warnings.some(w => w.includes('Missing')))
  }
})

test('all excluded roots perform no folder reads and folder-rule validation rejects escapes', async t => {
  const f = await fixture(t); await f.write('Pictures/a.jpg')
  f.io.list = async () => { throw new Error('Excluded folder was read') }
  const result = await f.search(categoryQuery('images', undefined, { include: ['Pictures'], exclude: ['Pictures'] }))
  assert.equal(result.status, 'complete'); assert.equal(result.matched, 0); assert.deepEqual(result.warnings, [])
  for (const entry of ['../private', 'Pictures/../secret', '/sdcard', 'C:\\private', '\\\\server\\share', '.', 'a\0b']) assert.throws(() => validateSearchQuery({ ...defaultSearchQuery, folders: { include: [entry], exclude: [], skipNames: [] } }))
  assert.throws(() => validateSearchQuery({ ...defaultSearchQuery, folders: { include: [], exclude: [], skipNames: ['a/b'] } }))
  assert.throws(() => validateSearchQuery({ ...defaultSearchQuery, folders: null }))
})

test('metadata scans remain usable beyond five minutes and still honor cancellation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let entered, release, scanSignal
  const enteredFolder = new Promise(resolve => { entered = resolve }), blocked = new Promise(resolve => { release = resolve })
  const io = { canonical: async location => location, list: async (location, signal) => { scanSignal = signal; entered(); await blocked; return { location, entries: [], parent: '/' } } }
  let finished
  const complete = new Promise(resolve => { finished = resolve })
  const service = new FileSearchService(io, '/unused', event => { if (event.type === 'fileSearch' && event.state.status !== 'running') finished(event.state) })
  service.start(local(path.resolve('pictures')), { ...defaultSearchQuery, name: '.jpg' })
  await enteredFolder
  t.mock.timers.tick(5 * 60_000 + 1)
  assert.equal(scanSignal.aborted, false)
  assert.equal(service.state.status, 'running')
  service.cancel(service.state.id)
  assert.equal(scanSignal.aborted, true)
  release()
  assert.equal((await complete).status, 'cancelled')
  await service.shutdown()
})
const wait = async service => { const start = Date.now(); while (service.busy) { if (Date.now() - start > 12000) throw new Error('Search did not complete'); await new Promise(r => setTimeout(r, 10)) } return service.state }
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'adb-vault-search-test-'))), folder = path.join(root, 'files'), cache = path.join(root, 'indexes')
  await fs.mkdir(folder)
  const io = new FileIO(() => null, () => ({ devices: [] })), events = [], service = new FileSearchService(io, cache, e => events.push(e))
  t.after(async () => { await service.shutdown(); if (!path.basename(root).startsWith('adb-vault-search-test-')) throw new Error('Invalid cleanup target'); await fs.rm(root, { recursive: true, force: true }) })
  const write = async (name, contents = 'hello') => { const target = path.join(folder, name); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, contents); return target }
  const search = async query => { service.start(local(folder), { ...defaultSearchQuery, ...query }); return wait(service) }
  const build = async () => { service.start(local(folder), defaultSearchQuery, 'index'); return wait(service) }
  return { root, folder, cache, io, service, events, write, search, build }
}
test('recursive name search combines wildcard, kind, size and inclusive date limits', async t => {
  const f = await fixture(t), first = await f.write('Report.TXT', '12345'), second = await f.write('nested/report.txt', '1234567890')
  await fs.utimes(first, new Date('2025-01-01'), new Date('2025-01-01')); await fs.utimes(second, new Date('2026-01-01'), new Date('2026-01-01'))
  await f.write('nested/other.bin', '1234567890')
  let s = await f.search({ name: '*.txt', nameMode: 'glob', kind: 'file', minSize: 6, after: Date.parse('2026-01-01'), before: Date.parse('2026-01-01') })
  assert.equal(s.status, 'complete', s.message); assert.deepEqual(s.results.map(r => r.entry.path), [second])
  s = await f.search({ name: '.txt', recursive: false }); assert.deepEqual(s.results.map(r => r.entry.path), [first])
  s = await f.search({ name: 'Report', caseSensitive: true }); assert.equal(s.matched, 1)
  s = await f.search({ name: '^report\\.txt$', nameMode: 'regex' }); assert.equal(s.matched, 2)
})
test('text searches UTF-8 and BOM UTF-16, reports binary and oversized files', async t => {
  const f = await fixture(t)
  await f.write('notes.txt', 'a Russian word: Привет'); await f.write('wide.txt', Buffer.concat([Buffer.from([255, 254]), Buffer.from('ПРИВЕТ', 'utf16le')]))
  await f.write('binary.bin', Buffer.from([0, 255, 1])); await f.write('huge.txt', Buffer.alloc(2 * 1024 ** 2 + 1, 65))
  const s = await f.search({ text: 'привет' }); assert.equal(s.status, 'complete', s.message); assert.equal(s.matched, 2); assert.ok(s.warnings.some(w => /Binary/.test(w))); assert.ok(s.warnings.some(w => /larger/.test(w)))
})
test('ZIP results identify members without extracting files; archive containers need not match name', async t => {
  const f = await fixture(t), archive = path.join(f.folder, 'bundle.apks'), zip = new yazl.ZipFile()
  zip.addBuffer(Buffer.from('find this needle'), 'docs/notes.txt'); zip.addBuffer(Buffer.from([0, 3, 8]), 'base.apk'); zip.addEmptyDirectory('empty')
  const saving = pipeline(zip.outputStream, createWriteStream(archive)); zip.end(); await saving
  const s = await f.search({ name: '*.txt', nameMode: 'glob', text: 'needle', archives: true })
  assert.equal(s.status, 'complete', s.message); assert.equal(s.matched, 1); assert.equal(s.results[0].archive, archive); assert.equal(s.results[0].member, 'docs/notes.txt'); assert.equal(s.results[0].entry.path, archive)
  assert.deepEqual(await fs.readdir(f.folder), ['bundle.apks']); assert.equal((await f.search({ name: '*.txt', nameMode: 'glob', text: 'needle' })).matched, 0)
})
test('persistent index works without filesystem scanning, is explicitly stale and updates or deletes', async t => {
  const f = await fixture(t), target = await f.write('old.txt'); await f.write('nested/deep.txt')
  assert.equal((await f.build()).status, 'complete'); const info = await f.service.indexInfo(local(f.folder)); assert.equal(info.count, 3)
  await fs.unlink(target); await f.write('new.txt')
  const original = f.io.list; f.io.list = () => { throw new Error('Unexpected rescan') }
  let s = await f.search({ source: 'index', name: '.txt', recursive: false }); assert.equal(s.status, 'complete', s.message); assert.deepEqual(s.results.map(r => r.entry.path), [target]); assert.ok(s.index.updatedAt)
  const fresh = new FileSearchService(f.io, f.cache, () => {}); t.after(() => fresh.shutdown()); fresh.start(local(f.folder), { ...defaultSearchQuery, source: 'index', name: 'deep' }); assert.equal((await wait(fresh)).matched, 1)
  f.io.list = original; assert.equal((await f.build()).status, 'complete'); s = await f.search({ source: 'index', name: 'old' }); assert.equal(s.matched, 0)
  await f.service.deleteIndex(local(f.folder)); assert.equal(await f.service.indexInfo(local(f.folder)), undefined)
})
test('cancelled or incomplete index rebuild preserves the previous index and does not follow links', async t => {
  const f = await fixture(t); await f.write('nested/first.txt'); assert.equal((await f.build()).status, 'complete'); const before = await f.service.indexInfo(local(f.folder))
  const original = f.io.list.bind(f.io)
  f.io.list = async (l, ...args) => { if (l.path.endsWith('nested')) throw new Error('Permission denied'); return original(l, ...args) }
  const s = await f.build(); assert.equal(s.status, 'error'); assert.match(s.message, /previous index is unchanged/); assert.deepEqual(await f.service.indexInfo(local(f.folder)), before)
  f.io.list = async (l, signal) => { await new Promise((resolve, reject) => { const timer = setTimeout(resolve, 4000); signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true }) }); return original(l, signal) }
  f.service.start(local(f.folder), defaultSearchQuery, 'index'); f.service.cancel(f.service.state.id); assert.equal((await wait(f.service)).status, 'cancelled'); assert.deepEqual(await f.service.indexInfo(local(f.folder)), before)
})
test('invalid and pathological regular expressions fail without blocking the main event loop', async t => {
  const f = await fixture(t)
  await f.write('a'.repeat(90) + '!')
  assert.equal((await f.search({ name: '[', nameMode: 'regex' })).status, 'error')
  let ticks = 0; const timer = setInterval(() => ticks++, 10)
  const s = await f.search({ name: '(a+)+$', nameMode: 'regex' }); clearInterval(timer)
  assert.equal(s.status, 'error'); assert.match(s.message, /took too long/); assert.ok(ticks > 20, `main thread only ticked ${ticks} times`)
  assert.equal((await f.search({ name: 'a' })).status, 'complete')
})
test('links stay untraversed, malformed archives report errors alongside real results', async t => {
  const f = await fixture(t), elsewhere = path.join(f.root, 'elsewhere'); await fs.mkdir(elsewhere); await fs.writeFile(path.join(elsewhere, 'secret.txt'), 'not in scope')
  await fs.symlink(elsewhere, path.join(f.folder, 'link'), 'junction'); await f.write('ok.txt'); await f.write('broken.zip', 'not a zip')
  const s = await f.search({ name: '.txt', archives: true }); assert.equal(s.status, 'complete'); assert.equal(s.matched, 1); assert.equal(s.results[0].entry.name, 'ok.txt'); assert.ok(s.warnings.some(w => /broken.zip/.test(w)))
})
test('a root alias index stores canonical paths but remains bound to its requested scope', async t => {
  const f = await fixture(t); await f.write('one.txt'); const alias = path.join(f.root, 'alias'); await fs.symlink(f.folder, alias, 'junction')
  f.service.start(local(alias), defaultSearchQuery, 'index'); assert.equal((await wait(f.service)).status, 'complete')
  f.service.start(local(alias), { ...defaultSearchQuery, source: 'index', recursive: false }); const s = await wait(f.service); assert.equal(s.status, 'complete', s.message); assert.equal(s.matched, 1)
})
test('search validation rejects contradictory bounds and unavailable indexed-content mode', () => {
  assert.throws(() => validateSearchQuery({ ...defaultSearchQuery, minSize: 10, maxSize: 1 }), /minimum/)
  assert.throws(() => validateSearchQuery({ ...defaultSearchQuery, after: Number.NaN }), /limits/)
  assert.throws(() => validateSearchQuery({ ...defaultSearchQuery, source: 'index', archives: true }), /index contains/)
})
test('phone text search retains the exact transport and safely quotes file paths; disconnect aborts', async t => {
  const f = await fixture(t), l = { kind: 'device', path: '/sdcard', id: 'phone', serial: 'SERIAL', transportId: '8' }, commands = []
  let available = true
  const e = { name: "a'b.txt", path: "/storage/emulated/0/a'b.txt", kind: 'file', fingerprint: 'fp', size: 6, modified: 1 }
  const io = { device: x => { assert.equal(x.transportId, '8'); if (!available) throw new Error('phone disconnected') }, canonical: async x => ({ ...x, path: '/storage/emulated/0' }), list: async x => ({ location: x, entries: [e] }), stat: async () => e, command: async (location, command, _signal, target) => { commands.push({ location, command }); await fs.writeFile(target, 'needle') } }
  const service = new FileSearchService(io, f.cache, () => {}); t.after(() => service.shutdown())
  service.start(l, { ...defaultSearchQuery, text: 'needle' }); assert.equal((await wait(service)).matched, 1); assert.match(commands[0].command, /head -c/); assert.ok(commands[0].command.includes("'\\''")); assert.equal(commands[0].location.transportId, '8')
  io.list = async (_x, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  service.start(l, defaultSearchQuery); available = false; service.connectionChanged(); const stopped = await wait(service); assert.equal(stopped.status, 'error'); assert.match(stopped.message, /disconnected/)
})


test('virtual categories find nested real files and publish their canonical source for file operations', async t => {
  const f = await fixture(t)
  const files = { images: 'DCIM/photo.JPG', videos: 'Movies/clip.mp4', audio: 'Music/song.flac', documents: 'Documents/report.pdf', archives: 'Downloads/backup.tar.gz' }
  for (const name of Object.values(files)) await f.write(name)
  await f.write('DCIM/photo.JPG.exe')
  await fs.mkdir(path.join(f.folder, 'folder.png'))
  for (const [category, name] of Object.entries(files)) {
    const state = await f.search(categoryQuery(category))
    assert.equal(state.status, 'complete', state.message)
    assert.deepEqual(state.results.map(r => r.entry.path), [path.join(f.folder, name)])
    assert.equal(state.canonicalLocation.path, await fs.realpath(f.folder))
  }
})
