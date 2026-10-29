import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { FilePreviewService } from '../dist-electron/file-preview.js'
import { FileIO } from '../dist-electron/files.js'

async function fixture(t, name, content) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adb-vault-preview-test-')), file = path.join(root, name)
  await fs.writeFile(file, content)
  const io = new FileIO(() => null, () => ({ devices: [] })), service = new FilePreviewService(io), location = { kind: 'local', path: file }
  t.after(async () => { await service.shutdown(); assert.ok(path.basename(root).startsWith('adb-vault-preview-test-')); await fs.rm(root, { recursive: true, force: true }) })
  const entry = await io.stat(location)
  return { io, service, location, entry }
}

test('media URL serves selected bytes and ranges, not filesystem paths; closing revokes it', async t => {
  const f = await fixture(t, 'movie.mp4', '0123456789'), preview = await f.service.open('one', f.location, f.entry.fingerprint)
  assert.equal(preview.kind, 'video'); assert.ok(!preview.url.includes('movie'))
  const response = await f.service.respond(new Request(preview.url, { headers: { Range: 'bytes=2-5' } }))
  assert.equal(response.status, 206); assert.equal(response.headers.get('content-range'), 'bytes 2-5/10'); assert.equal(await response.text(), '2345')
  assert.equal(await (await f.service.respond(new Request(preview.url, { headers: { Range: 'bytes=-3' } }))).text(), '789')
  assert.equal((await f.service.respond(new Request(preview.url, { headers: { Range: 'bytes=50-' } }))).status, 416)
  assert.equal((await f.service.respond(new Request(preview.url + '/movie.mp4'))).status, 404)
  assert.equal((await f.service.respond(new Request('vault-media://preview/../../Windows/system.ini'))).status, 404)
  await f.service.close('one')
  assert.equal((await f.service.respond(new Request(preview.url))).status, 404)
})

test('HTML and SVG are inert text, and changed/unsupported/oversized files are rejected', async t => {
  const f = await fixture(t, 'document.html', '<script>alert(1)</script>')
  const result = await f.service.open('text', f.location, f.entry.fingerprint)
  assert.deepEqual(result, { kind: 'text', text: '<script>alert(1)</script>' })
  await f.service.close('text')
  await assert.rejects(f.service.open('changed', f.location, 'stale'), /changed/)
  await assert.rejects(f.service.open('unsupported', { ...f.location, path: f.location.path + '.exe' }, f.entry.fingerprint), /No built-in viewer/)
  await fs.writeFile(f.location.path, Buffer.alloc(2 * 1024 ** 2 + 1, 65))
  await assert.rejects(f.service.open('large', f.location, (await f.io.stat(f.location)).fingerprint), /preview limit/)
})

for (const interruption of ['cancel body', 'abort request']) test(`seeking after ${interruption} keeps the same preview readable`, async t => {
  const bytes = Buffer.alloc(2 * 1024 ** 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251
  const f = await fixture(t, 'track.wav', bytes), preview = await f.service.open('audio', f.location, f.entry.fingerprint)
  for (const start of [0, 1000000, 200000]) {
    const controller = new AbortController()
    const response = await f.service.respond(new Request(preview.url, { headers: { Range: `bytes=${start}-` }, signal: controller.signal }))
    const reader = response.body.getReader()
    const first = await reader.read()
    assert.deepEqual(Buffer.from(first.value), bytes.subarray(start, start + first.value.length))
    if (interruption === 'cancel body') await reader.cancel()
    else { controller.abort(); await reader.closed.catch(() => {}) }
    const seek = await f.service.respond(new Request(preview.url, { headers: { Range: 'bytes=1500000-1500127' } }))
    assert.equal(seek.status, 206)
    assert.deepEqual(Buffer.from(await seek.arrayBuffer()), bytes.subarray(1500000, 1500128))
  }
})

test('overlapping media ranges have independent positions and closing cancels remaining readers', async t => {
  const bytes = Buffer.alloc(2 * 1024 ** 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251
  const f = await fixture(t, 'track.mp3', bytes), preview = await f.service.open('audio', f.location, f.entry.fingerprint)
  const first = await f.service.respond(new Request(preview.url)), reader = first.body.getReader()
  await reader.read()
  const ranges = [[1000000, 1500000], [12, 100003], [500000, 750000]]
  await Promise.all(ranges.map(async ([start, end]) => {
    const response = await f.service.respond(new Request(preview.url, { headers: { Range: `bytes=${start}-${end}` } }))
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes.subarray(start, end + 1))
  }))
  await f.service.close('audio')
  await assert.rejects(reader.closed)
  assert.equal((await f.service.respond(new Request(preview.url))).status, 404)
})

test('a cancelled phone preview cannot become an authorized URL or leave its temporary copy', async () => {
  let copied, started
  const ready = new Promise(resolve => { started = resolve })
  const io = { stat: async () => ({ kind: 'file', name: 'photo.png', size: 10, fingerprint: 'unchanged' }), device: () => ({}), command: async (_l, _c, signal, local) => {
    copied = local; await fs.writeFile(local, 'partial'); started()
    await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }))
  } }
  const service = new FilePreviewService(io), result = service.open('phone', { kind: 'device', path: '/sdcard/photo.png' }, 'unchanged')
  const rejected = assert.rejects(result, /cancelled/)
  await ready; await service.close('phone'); await rejected
  await assert.rejects(fs.stat(path.dirname(copied)), { code: 'ENOENT' })
  await service.shutdown()
})
