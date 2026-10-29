import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AppNotes } from '../dist-electron/app-notes.js'
import { parseAppNotes, appNotesFile } from '../dist-electron/app-notes-protocol.js'

const origin = { deviceName: 'Phone A', model: 'Model A', android: '16', build: 'build', fingerprint: 'vendor/build', profileName: 'Work', userId: 10, appLabel: 'Example', versionName: '2', versionCode: 2 }
const draft = { packageName: 'org.example.app', label: 'Keep', text: 'Used on my work phone', color: '#5681c2' }
async function fixture() { const root = await mkdtemp(path.join(tmpdir(), 'adb-notes-')); const service = new AppNotes(root, () => {}); await service.load(); return { root, service } }
test('records persist globally by package; edits preserve original phone and guard against stale writers', async () => {
  const { root, service } = await fixture()
  await service.save(draft, origin)
  const first = service.state.entries[0]
  await service.save({ ...draft, id: first.id, expectedUpdatedAt: first.updatedAt, text: 'Works on Phone B too' }, { ...origin, deviceName: 'Phone B' })
  const updated = service.state.entries[0]
  assert.deepEqual(updated.origin, origin); assert.equal(updated.createdAt, first.createdAt); assert.ok(updated.updatedAt > first.updatedAt)
  await assert.rejects(service.save({ ...draft, id: first.id, expectedUpdatedAt: first.updatedAt }, origin), /changed/)
  const reload = new AppNotes(root, () => {}); await reload.load(); assert.deepEqual(reload.state.entries, service.state.entries)
  await service.save({ ...draft, label: 'Another observation' }, { ...origin, deviceName: 'Phone B' })
  assert.equal(service.state.entries.length, 2)
  await assert.rejects(service.delete(first.id, first.updatedAt), /changed/)
  await service.delete(updated.id, updated.updatedAt); assert.equal(service.state.entries.length, 1)
})
test('export/import merges without overwriting conflicting records and is repeatable', async () => {
  const a = await fixture(), b = await fixture()
  await a.service.save(draft, origin)
  const file = path.join(a.root, 'export.json'); await a.service.export(file)
  assert.deepEqual(await b.service.import(file), { added: 1, skipped: 0 })
  assert.deepEqual(await b.service.import(file), { added: 0, skipped: 1 })
  const saved = b.service.state.entries[0]
  await b.service.save({ ...draft, id: saved.id, expectedUpdatedAt: saved.updatedAt, text: 'Changed' }, null)
  assert.deepEqual(await b.service.import(file), { added: 1, skipped: 0 })
  assert.equal(new Set(b.service.state.entries.map(n => n.id)).size, 2)
  assert.deepEqual(await b.service.import(file), { added: 0, skipped: 1 })
  assert.ok(b.service.state.entries.every(n => n.origin.deviceName === 'Phone A'))
})
test('corrupt stored database is preserved and cannot be silently replaced', async () => {
  const { root } = await fixture(), file = path.join(root, 'app-notes.json')
  await writeFile(file, '{invalid')
  const broken = new AppNotes(root, () => {}); await broken.load()
  assert.equal(broken.state.status, 'error'); await assert.rejects(broken.save(draft, null), /existing file/)
  assert.equal(await readFile(file, 'utf8'), '{invalid')
})
test('invalid imports leave the database intact; schema bounds and source metadata are enforced', async () => {
  const { service, root } = await fixture(); await service.save(draft, null)
  const first = structuredClone(service.state.entries[0]), file = path.join(root, 'bad.json')
  for (const bad of [{ ...first, color: 'url(file)' }, { ...first, text: 'x'.repeat(8001) }, { ...first, packageName: 'bad;command' }, { ...first, origin: { ...origin, userId: -1 } }, { ...first, updatedAt: 'bad' }]) {
    await writeFile(file, JSON.stringify(appNotesFile([bad]))); await assert.rejects(service.import(file)); assert.deepEqual(service.state.entries, [first])
  }
  assert.throws(() => parseAppNotes(appNotesFile([first, first])), /duplicate/)
})
