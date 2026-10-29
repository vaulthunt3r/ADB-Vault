import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Storage } from '../dist-electron/storage.js'
import { ExportDestination } from '../dist-electron/export-destination.js'

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'adb-vault-destination-')))
  const storage = new Storage(path.join(root, 'settings')); await storage.load()
  const output = path.join(root, 'exports'); await mkdir(output)
  let answer = output, calls = 0
  const destination = new ExportDestination(storage, async () => { calls++; return answer })
  return { root, storage, output, destination, calls: () => calls, answer: value => { answer = value } }
}

test('asks each time by default; fixed folder persists across restarts without a chooser', async () => {
  const f = await fixture()
  assert.equal(f.destination.settings.mode, 'ask')
  assert.equal(await f.destination.resolve(), f.output)
  assert.equal(await f.destination.resolve(), f.output)
  assert.equal(f.calls(), 2)
  await f.destination.configure('fixed')
  assert.equal(f.calls(), 3)
  const reloaded = new Storage(f.storage.root); await reloaded.load()
  const saved = new ExportDestination(reloaded, async () => { assert.fail('Fixed mode must not open a chooser') })
  assert.equal(await saved.resolve(), f.output)
  assert.equal(await saved.resolve(), f.output)
  await f.destination.configure('ask')
  assert.equal(f.destination.settings.folder, f.output)
  f.answer(null)
  assert.equal(await f.destination.resolve(), null)
  assert.equal(f.calls(), 4)
})

test('cancelled folder selection and failed preference saves preserve the previous choice', async () => {
  const f = await fixture()
  f.answer(null); await f.destination.configure('fixed')
  assert.deepEqual(f.destination.settings, { mode: 'ask', folder: null })
  f.answer(f.output); await f.destination.configure('fixed')
  f.answer(null); await f.destination.configure('fixed', true)
  assert.deepEqual(f.destination.settings, { mode: 'fixed', folder: f.output })
  f.storage.save = async () => { throw new Error('Disk unavailable') }
  await assert.rejects(f.destination.configure('ask'), /Disk unavailable/)
  assert.equal(f.destination.settings.mode, 'fixed')
})

test('missing or non-directory fixed destination fails explicitly without choosing a fallback', async () => {
  const f = await fixture()
  f.storage.data.exportDestination = { mode: 'fixed', folder: path.join(f.root, 'missing') }
  await assert.rejects(f.destination.resolve(), /Settings > Apps > Export destination/)
  const file = path.join(f.root, 'file'); await writeFile(file, 'test')
  f.storage.data.exportDestination.folder = file
  await assert.rejects(f.destination.resolve(), /unavailable/)
  assert.equal(f.calls(), 0)
})
