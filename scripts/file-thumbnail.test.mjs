import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { FileIO } from '../dist-electron/files.js'
import { readThumbnailBytes } from '../dist-electron/file-thumbnail.js'
import { thumbnailKey, thumbnailMaxBytes } from '../dist-electron/file-thumbnail-protocol.js'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=', 'base64')
const signal = () => new AbortController().signal
const location = { kind: 'device', id: 'phone', serial: 'PHONE', transportId: '3', path: "/sdcard/Pictures/it's a photo.png" }

test('local thumbnails require current regular images and bound file reads', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'adb-vault-thumbnail-test-'))
  t.after(() => fs.rm(folder, { recursive: true, force: true }))
  const file = { kind: 'local', path: path.join(folder, 'sample.png') }, io = new FileIO(() => null, () => ({ devices: [] }))
  await fs.writeFile(file.path, png)
  const entry = await io.stat(file)
  assert.deepEqual(await readThumbnailBytes(io, file, entry.fingerprint, signal()), png)
  assert.equal(await readThumbnailBytes(io, file, 'old', signal()), undefined)
  await fs.writeFile(file.path, Buffer.alloc(thumbnailMaxBytes + 1))
  assert.equal(await readThumbnailBytes(io, file, (await io.stat(file)).fingerprint, signal()), undefined)
  assert.equal(await readThumbnailBytes(io, { ...file, path: path.join(folder, 'unsupported.apk') }, 'x', signal()), undefined)
  await fs.mkdir(path.join(folder, 'folder.jpg'))
  const directory = { ...file, path: path.join(folder, 'folder.jpg') }
  assert.equal(await readThumbnailBytes(io, directory, (await io.stat(directory)).fingerprint, signal()), undefined)
})

async function phoneFixture(mode = 'success', root = false) {
  let output, reads = 0, metadata = 0
  const commands = [], device = { ...location, status: 'connected', root: { status: 'available', method: 'su' } }
  const source = { ...location, root }
  const io = new FileIO(() => 'adb.exe', () => ({ devices: [device] }), async (_exe, args, timeout, _input, _env, controls) => {
    controls.signal?.throwIfAborted()
    commands.push(args)
    assert.deepEqual(args.slice(0, 2), ['-t', '3'])
    if (args[2] === 'shell') {
      metadata++
      const type = mode === 'link' ? 'a1ff' : '81a4', size = mode === 'large' ? thumbnailMaxBytes + 1 : png.length
      return { stdout: `${type}\t${size}\t1700000000\t0\t0\t25\t1700000000\t${mode === 'changed' && metadata > 1 ? 'new' : 'precise'}\n${source.path}\0`, stderr: '', code: 0 }
    }
    reads++; output = controls.stdoutFile
    assert.equal(timeout, 55_000)
    assert.match(args[3], /head -c 32000001 --/)
    assert.match(args[3], /test ! -L/)
    assert.equal(args[3].includes('su -c'), root)
    if (mode === 'cancel') await new Promise((_resolve, reject) => { controls.signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true }) })
    const token = args[3].match(/ADB_VAULT_EXPORT_([a-f0-9-]{36})/)[1]
    const bytes = mode === 'short' ? png.subarray(0, 12) : png
    const status = mode === 'denied' ? '1' : '0'
    const frame = mode === 'missing-frame' ? Buffer.alloc(0) : Buffer.from(`\nADB_VAULT_EXPORT_${token}:${status}\n`)
    await fs.writeFile(output, Buffer.concat([bytes, frame]))
    controls.onStdoutBytes?.(bytes.length + frame.length)
    if (mode === 'reconnect') device.transportId = '4'
    return { stdout: '', stderr: '', code: 0 }
  })
  return { io, source, commands, fingerprint: `${mode === 'link' ? 'a1ff' : '81a4'}:${mode === 'large' ? thumbnailMaxBytes + 1 : png.length}:25:1700000000:precise`, output: () => output, reads: () => reads }
}

test('phone previews use pinned binary reads, preserve originals and remove private staging', async () => {
  for (const root of [false, true]) {
    const f = await phoneFixture('success', root)
    assert.deepEqual(await readThumbnailBytes(f.io, f.source, f.fingerprint, signal()), png)
    assert.equal(f.reads(), 1)
    assert.equal(f.commands.length, 3)
    await assert.rejects(fs.stat(path.dirname(f.output())), { code: 'ENOENT' })
    assert.ok(f.commands.every(args => !/reconnect|kill-server|start-server|push| rm |chmod/.test(args.join(' '))))
  }
})

test('oversized files, links and stale listing entries never start a phone download', async () => {
  for (const mode of ['large', 'link', 'stale']) {
    const f = await phoneFixture(mode)
    assert.equal(await readThumbnailBytes(f.io, f.source, mode === 'stale' ? 'old' : f.fingerprint, signal()), undefined)
    assert.equal(f.reads(), 0)
  }
})

test('changed or short image downloads are discarded and staging is removed', async () => {
  for (const mode of ['short', 'changed']) {
    const f = await phoneFixture(mode)
    assert.equal(await readThumbnailBytes(f.io, f.source, f.fingerprint, signal()), undefined)
    await assert.rejects(fs.stat(path.dirname(f.output())), { code: 'ENOENT' })
  }
})

test('denial, incomplete stream and reconnect cannot produce an image', async () => {
  for (const mode of ['denied', 'missing-frame', 'reconnect']) {
    const f = await phoneFixture(mode)
    await assert.rejects(readThumbnailBytes(f.io, f.source, f.fingerprint, signal()))
    await assert.rejects(fs.stat(path.dirname(f.output())), { code: 'ENOENT' })
  }
})

test('cancelling an active preview stops its read and removes staging', async () => {
  const f = await phoneFixture('cancel'), controller = new AbortController()
  const result = readThumbnailBytes(f.io, f.source, f.fingerprint, controller.signal)
  const assertion = assert.rejects(result, /Cancelled/)
  while (!f.reads()) await new Promise(resolve => setTimeout(resolve, 5))
  controller.abort(); await assertion
  await assert.rejects(fs.stat(path.dirname(f.output())), { code: 'ENOENT' })
})

test('preview cache identity distinguishes device, transport, access and file revisions', () => {
  const original = thumbnailKey(location, 'a')
  for (const change of [{ serial: 'OTHER' }, { transportId: '4' }, { root: true }, { kind: 'local' }, { path: '/other.png' }]) assert.notEqual(thumbnailKey({ ...location, ...change }, 'a'), original)
  assert.notEqual(thumbnailKey(location, 'b'), original)
})
