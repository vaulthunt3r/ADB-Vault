import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { Screenshots } from '../dist-electron/screenshots.js'
import { Storage } from '../dist-electron/storage.js'
import { screenshotSettings, validateScreenshotOptions } from '../dist-electron/screenshot-protocol.js'

async function fixture(t, options = {}) {
  const parent = path.resolve('desktop-test-results'); await mkdir(parent, { recursive: true })
  const root = await mkdtemp(path.join(parent, 'screenshots-'))
  t.after(async () => { assert.equal(path.dirname(root), parent); await rm(root, { recursive: true, force: true }) })
  const storage = new Storage(root); await storage.load()
  const frame = path.join(root, 'frame.png'); await writeFile(frame, 'captured frame')
  const copies = [], opened = []
  const folder = path.join(root, 'Screenshots')
  const service = new Screenshots(storage, folder, {
    copyImage: async file => { copies.push(file); if (options.copyError) throw new Error('Clipboard busy') },
    chooseFolder: async () => options.folder || null,
    saveAs: async () => options.saveAs || null,
    openFolder: async file => { opened.push(file) },
  })
  return { root, frame, storage, service, copies, opened, folder }
}

test('default screenshots save and copy, without overwriting an existing capture', async t => {
  const f = await fixture(t)
  const first = await f.service.deliver(f.frame, 'phone.png')
  assert.match(first.message, /saved and copied/)
  assert.equal(first.warning, false)
  await writeFile(f.frame, 'next frame')
  await f.service.deliver(f.frame, 'phone.png')
  assert.equal(await readFile(path.join(f.folder, 'phone.png'), 'utf8'), 'captured frame')
  assert.equal(await readFile(path.join(f.folder, 'phone-1.png'), 'utf8'), 'next frame')
  assert.equal(f.copies.length, 2)
})

test('clipboard-only capture creates no screenshot folder and settings survive restart', async t => {
  const f = await fixture(t)
  await f.service.configure({ saveToFile: false, copyToClipboard: true, askWhereToSave: false })
  assert.match((await f.service.deliver(f.frame, 'phone.png')).message, /copied to clipboard/)
  assert.ok(!(await readdir(f.root)).includes('Screenshots'))
  const reloaded = new Storage(f.root); await reloaded.load()
  assert.equal(reloaded.data.screenshots.saveToFile, false)
  assert.equal(reloaded.data.screenshots.folder, null, 'Default location follows Pictures on the current PC')
  await assert.rejects(f.service.configure({ saveToFile: false, copyToClipboard: false, askWhereToSave: false }), /at least|Choose a file/)
})

test('file-only mode leaves clipboard untouched; cancelling Save as has no output', async t => {
  const f = await fixture(t)
  await f.service.configure({ saveToFile: true, copyToClipboard: false, askWhereToSave: false })
  await f.service.deliver(f.frame, 'phone.png')
  assert.deepEqual(f.copies, [])
  await f.service.configure({ saveToFile: true, copyToClipboard: true, askWhereToSave: true })
  assert.equal(await f.service.deliver(f.frame, 'cancelled.png'), null)
  assert.deepEqual(await readdir(f.folder), ['phone.png'])
  assert.deepEqual(f.copies, [])
})

test('partial output reports what succeeded even if the other destination failed', async t => {
  const f = await fixture(t, { copyError: true })
  const result = await f.service.deliver(f.frame, 'phone.png')
  assert.equal(result.warning, true)
  assert.match(result.message, /Screenshot saved:/)
  assert.match(result.message, /Could not copy image/)
  assert.equal(await readFile(path.join(f.folder, 'phone.png'), 'utf8'), 'captured frame')
  const g = await fixture(t)
  await writeFile(g.folder, 'not a directory')
  const copied = await g.service.deliver(g.frame, 'phone.png')
  assert.equal(copied.warning, true)
  assert.match(copied.message, /copied to clipboard.*Could not save/)
  await g.service.configure({ saveToFile: true, copyToClipboard: false, askWhereToSave: false })
  await assert.rejects(g.service.deliver(g.frame, 'phone.png'), /Could not save/)
})

test('folder selection, reveal and explicit Save as preserve settings and clean temporary files', async t => {
  const f = await fixture(t)
  await f.service.chooseFolder()
  assert.equal(f.storage.data.screenshots, undefined)
  await f.service.openFolder()
  assert.deepEqual(f.opened, [f.folder])
  const g = await fixture(t, { folder: f.folder, saveAs: path.join(f.folder, 'chosen.png') })
  await g.service.chooseFolder()
  await g.service.configure({ saveToFile: true, copyToClipboard: false, askWhereToSave: true })
  await writeFile(path.join(f.folder, 'chosen.png'), 'old')
  await g.service.deliver(g.frame, 'unused.png')
  assert.equal(await readFile(path.join(f.folder, 'chosen.png'), 'utf8'), 'captured frame')
  assert.deepEqual(await readdir(f.folder), ['chosen.png'])
  const loaded = new Storage(g.root); await loaded.load()
  assert.equal(loaded.data.screenshots.folder, f.folder)
})

test('damaged preferences fall back to useful defaults and failed saves roll back', async t => {
  assert.equal(screenshotSettings({ saveToFile: false, copyToClipboard: false }).copyToClipboard, true)
  assert.throws(() => validateScreenshotOptions({ saveToFile: 'yes' }), /Invalid/)
  const f = await fixture(t)
  f.storage.save = async () => { throw new Error('Disk unavailable') }
  await assert.rejects(f.service.configure({ saveToFile: false, copyToClipboard: true, askWhereToSave: false }), /Disk unavailable/)
  assert.equal(f.service.settings.saveToFile, true)
})
