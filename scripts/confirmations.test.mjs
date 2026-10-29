import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Confirmations } from '../dist-electron/confirmations.js'
import { batchActionConfirmation, singleActionConfirmation, restoreConfirmation } from '../dist-electron/app-confirmations.js'
const content = { title: 'Delete', confirmLabel: 'Delete', description: 'Test', tone: 'danger', effects: ['Deletes data.'] }
test('only the active one-use confirmation can execute; cancellation settles pending work', async () => {
  const events = [], broker = new Confirmations(s => events.push(s))
  const first = broker.ask(content), id = broker.state.prompt.id
  assert.throws(() => broker.ask(content), /open confirmation/)
  assert.throws(() => broker.answer('wrong-id', true), /no longer active/)
  broker.cancel()
  assert.equal(await first, false)
  assert.throws(() => broker.answer(id, true), /no longer active/)
  const next = broker.ask(content)
  assert.notEqual(broker.state.prompt.id, id)
  broker.answer(broker.state.prompt.id, true)
  assert.equal(await next, true)
  assert.deepEqual(events.map(s => s.revision), [1, 2, 3, 4])
  assert.equal(broker.state.prompt, null)
})
test('batch confirmation keeps individual cleanup targets, skips, profile and permanent-loss warning', () => {
  const prompt = batchActionConfirmation({ action: 'clear-storage', userId: 10, batch: { deviceName: 'Phone', profileName: 'Work', items: [
    { label: 'Photos', packageName: 'org.photos', system: true, status: 'pending', steps: [{ part: 'data' }, { part: 'media' }] },
    { label: 'Other', packageName: 'org.other', system: true, status: 'skipped', message: 'Unavailable' },
  ] } }, [])
  assert.deepEqual(prompt.selection, { total: 2, affected: 1, skipped: 1 })
  assert.match(prompt.context[1].value, /Work · ID 10/)
  assert.equal(prompt.applications[1].skipped, true)
  assert.ok(prompt.effects.some(e => /photos, recordings/.test(e)))
  assert.ok(prompt.effects.some(e => /cannot be recovered/.test(e)))
  assert.ok(prompt.warnings.some(w => /System applications/.test(w)))
  const cache = singleActionConfirmation('clear-cache', { label: 'App', packageName: 'org.app', userId: 10 }, 'Phone', 'Work')
  assert.ok(cache.effects.some(e => /not be reset as a fallback/.test(e)))
  assert.ok(!cache.effects.some(e => /login data/.test(e)))
})
test('Freeze explains Android suspension without promising stopped background services or deleted data', () => {
  const prompt = singleActionConfirmation('suspend', { label: 'App', packageName: 'org.app', userId: 10, system: true }, 'Phone', 'Work')
  assert.equal(prompt.title, 'Freeze application')
  assert.ok(prompt.effects.some(text => /files and data stay/.test(text)))
  assert.ok(prompt.details.some(text => /does not disable.*guarantee/.test(text)))
  assert.ok(prompt.warnings.some(text => /System applications/.test(text)))
  const resume = singleActionConfirmation('unsuspend', { label: 'App', packageName: 'org.app', userId: 10 }, 'Phone', 'Work')
  assert.equal(resume.title, 'Unfreeze application')
  assert.ok(resume.details.some(text => /administrator.*may remain/.test(text)))
})
test('restore separates data replacement from installing APKs and retains cross-profile warning', () => {
  const state = { deviceName: 'Phone', profileName: 'Work', userId: 10, packageName: 'org.app', applications: [{ packageName: 'org.app', label: 'App', versionCode: 1 }] }
  const install = restoreConfirmation(state), files = restoreConfirmation({ ...state, operation: 'files', selectedParts: ['data'] })
  assert.ok(install.effects.some(e => /other profiles/.test(e)))
  assert.ok(install.effects.some(e => /will not be restored/.test(e)))
  assert.equal(files.tone, 'danger')
  assert.ok(files.effects.some(e => /will be replaced/.test(e)))
  assert.ok(files.warnings.some(e => /manual recovery/.test(e)))
})
