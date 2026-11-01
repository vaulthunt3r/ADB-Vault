import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { Storage } from '../dist-electron/storage.js'

test('legacy language preferences are discarded while other settings survive saving and reloading', async () => {
  const root = await mkdtemp(path.resolve('desktop-test-results/english-only-'))
  const file = path.join(root, 'backend.json')
  for (const language of ['ru', 'uk', 'en', '../ru']) {
    await writeFile(file, JSON.stringify({ language, paths: {}, known: [], stopAdbOnExit: false, apkZstd: true, appsLoadingMode: 'preload', appsOptions: { early: false }, exportDestination: { mode: 'fixed', folder: root } }))
    const storage = new Storage(root)
    await storage.load()
    assert.equal(Object.hasOwn(storage.data, 'language'), false)
    assert.equal(storage.data.stopAdbOnExit, false)
    assert.equal(storage.data.apkZstd, true)
    assert.equal(storage.data.appsLoadingMode, 'preload')
    assert.equal(storage.data.appsOptions.early, false)
    assert.deepEqual(storage.data.exportDestination, { mode: 'fixed', folder: root })
    await storage.save()
    assert.equal(Object.hasOwn(JSON.parse(await readFile(file, 'utf8')), 'language'), false)
    const restored = new Storage(root)
    await restored.load()
    assert.deepEqual(restored.data, storage.data)
  }
})

