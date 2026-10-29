import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { OperationHistory, recoverSession } from '../dist-electron/operation-history.js'
import { emptyApps } from '../dist-electron/apps-protocol.js'
import { activityIcon } from '../dist-electron/activity-operation.js'

await mkdir('desktop-test-results', { recursive: true })
const root = await mkdtemp(path.resolve('desktop-test-results/history-unit-'))
const context = { connection: { devices: [{ id: 'phone', serial: 'PHONE', endpoint: 'PHONE', name: 'Test phone' }] }, apps: { ...emptyApps(), profiles: [{ id: 10, name: 'Work' }] } }
const activity = text => ({ type: 'activity', source: 'files', tone: 'info', text })
const task = (status = 'running') => ({ id: 'copy-1', action: 'copy', source: { kind: 'local', path: 'C:\\source' }, destination: { kind: 'local', path: 'D:\\target' }, status, createdAt: new Date().toISOString(), completed: 1, bytes: 42, current: 'second.txt', pauseRequested: false, stopRequested: false, undoable: true, items: [{ path: 'first.txt', status: 'success' }, { path: 'second.txt', status: 'running' }, { path: 'third.txt', status: 'pending' }] })
const location = (folder, id) => path.join(folder, 'operation-history', id + '.json')
const icon = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

test('failed app identity is captured on its phone/profile and survives removal, switching phones and restart', async () => {
  const folder = path.join(root, 'icons'), history = new OperationHistory(folder)
  await history.initialize()
  const state = { operationId: 'identity-1', startedAt: new Date().toISOString(), id: 'phone', userId: 10, packageName: 'org.example.app', action: 'disable', status: 'running', message: 'Preparing' }
  const apps = { ...context.apps, deviceId: 'phone', userId: 10, apps: [{ packageName: state.packageName, userId: 10, label: 'Mi Video', iconPng: icon }] }
  history.capture({ type: 'appAction', state }, { ...context, apps })
  assert.equal(history.snapshot().activity[0].operation.items[0].iconPng, undefined, 'progress does not carry icons')
  history.capture({ type: 'appAction', state: { ...state, status: 'error', message: 'Denied' } }, { ...context, apps: { ...apps, deviceId: 'different-phone', apps: [{ ...apps.apps[0], label: 'Wrong phone', iconPng: undefined }] } })
  const failed = history.snapshot().activity[0].operation.items[0]
  assert.equal(failed.label, 'Mi Video'); assert.equal(failed.iconPng, icon)
  await history.close(true)
  const restarted = new OperationHistory(folder); await restarted.initialize()
  assert.deepEqual((await restarted.read(history.overview().current.id)).activity[0].operation.items[0], JSON.parse(JSON.stringify(failed)))
  await restarted.close(true)
})

test('other phone/profile metadata cannot supply a failed app icon; malformed or oversized icons are ignored', async () => {
  for (const patch of [{ deviceId: 'other', userId: 10 }, { deviceId: 'phone', userId: 0 }]) {
    const history = new OperationHistory(path.join(root, 'icon-scope-' + patch.deviceId + patch.userId)); await history.initialize()
    history.capture({ type: 'appAction', state: { operationId: 'scope', id: 'phone', userId: 10, packageName: 'org.example.app', action: 'disable', status: 'error', message: 'Denied' } }, { ...context, apps: { ...context.apps, ...patch, apps: [{ packageName: 'org.example.app', userId: patch.userId, label: 'Wrong', iconPng: icon }] } })
    assert.equal(history.snapshot().activity[0].operation.items[0].label, 'org.example.app')
    assert.equal(history.snapshot().activity[0].operation.items[0].iconPng, undefined)
    await history.close(true)
  }
  for (const bad of ['https://example.com/icon.png', 'data:image/svg+xml,test', 'iVBORw0KGgo' + 'A'.repeat(131072), 42]) assert.equal(activityIcon(bad), undefined)
})

test('progress coalesces journal delivery while failures and final results remain immediate and durable', async () => {
  const notifications = [], history = new OperationHistory(path.join(root, 'progress'), overview => notifications.push(structuredClone(overview)))
  await history.initialize(); notifications.length = 0
  const state = { operationId: 'progress', startedAt: new Date().toISOString(), id: 'phone', userId: 10, operation: 'backup', status: 'running', message: 'Preparing', items: [{ packageName: 'org.example.app', label: 'App', status: 'running' }] }
  history.capture({ type: 'backup', state }, context)
  for (let i = 0; i < 500; i++) history.capture({ type: 'backup', state: { ...state, message: `Progress ${i}` } }, context)
  assert.equal(notifications.length, 1)
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.equal(notifications.length, 2)
  assert.equal(notifications.at(-1).activity[0].operation.message, 'Progress 499')
  const failed = { ...state, message: 'Denied', items: [{ ...state.items[0], status: 'error', message: 'Permission denied' }] }
  history.capture({ type: 'backup', state: failed }, context)
  assert.equal(notifications.length, 3)
  history.capture({ type: 'backup', state: { ...failed, status: 'error' } }, context)
  assert.equal(notifications.at(-1).activity[0].operation.status, 'error')
  await history.close(true)
  const disk = JSON.parse(await readFile(location(path.join(root, 'progress'), history.overview().current.id), 'utf8'))
  assert.equal(disk.activity[0].operation.status, 'error')
  assert.equal(disk.activity[0].operation.items[0].message, 'Permission denied')
})

test('clean restart separates sessions and preserves final results without restoring a queue', async () => {
  const folder = path.join(root, 'clean'), first = new OperationHistory(folder)
  await first.initialize(); first.capture(activity('Old operation'), context)
  first.capture({ type: 'files', state: { tasks: [task('success')] } }, context)
  await first.close(true)
  const second = new OperationHistory(folder); await second.initialize()
  assert.notEqual(first.overview().current.id, second.overview().current.id)
  assert.deepEqual(second.snapshot().activity, [])
  const previous = await second.read(first.overview().current.id)
  assert.equal(previous.session.status, 'closed'); assert.ok(previous.session.endedAt)
  assert.equal(previous.activity[0].text, 'Old operation'); assert.equal(previous.tasks[0].status, 'success')
  assert.deepEqual((await second.read(second.overview().current.id)).tasks, [])
  await second.close(true)
})

test('crash recovery preserves confirmed items, marks current item uncertain and never marks pending items successful', async () => {
  const folder = path.join(root, 'crash'), first = new OperationHistory(folder)
  await first.initialize()
  for (const status of ['running', 'paused', 'conflict', 'queued']) {
    first.capture({ type: 'files', state: { tasks: [{ ...task(status), id: status }] } }, context)
    const saved = await first.read(first.overview().current.id); saved.session.status = 'interrupted'
    const recovered = recoverSession(saved), t = recovered.tasks[0]
    assert.equal(t.status, 'interrupted'); assert.equal(t.previousStatus, status); assert.equal(t.undoable, false)
    assert.equal(t.items[0].status, 'success'); assert.equal(t.items[1].status, 'interrupted'); assert.equal(t.items[1].uncertain, true)
    assert.equal(t.items[2].status, 'pending'); assert.equal(t.completed, 1)
    assert.equal(saved.tasks[0].status, status, 'recovery must not mutate the original')
  }
  await first.flush()
  const file = location(folder, first.overview().current.id), saved = JSON.parse(await readFile(file, 'utf8'))
  saved.session.pid = 2147483647; await writeFile(file, JSON.stringify(saved))
  const second = new OperationHistory(folder); await second.initialize()
  assert.equal(second.overview().sessions[0].status, 'interrupted')
  assert.ok(second.overview().sessions[0].unfinished > 0)
  assert.equal((await second.read(saved.session.id)).tasks[0].status, 'interrupted')
  await second.close(true)
})

test('concurrent instances keep separate journals and are not mislabeled as crashes', async () => {
  const folder = path.join(root, 'parallel'), a = new OperationHistory(folder), b = new OperationHistory(folder)
  await Promise.all([a.initialize(), b.initialize()])
  a.capture(activity('A only'), context); b.capture(activity('B only'), context)
  await Promise.all([a.flush(), b.flush()]); await a.refresh()
  assert.equal((await a.read(b.overview().current.id)).session.status, 'open')
  assert.equal(a.snapshot().activity[0].text, 'A only'); assert.equal(b.snapshot().activity[0].text, 'B only')
  await Promise.all([a.close(true), b.close(true)])
})

test('rapid updates and final flush retain the latest state, and missing history does not break startup', async () => {
  const history = new OperationHistory(path.join(root, 'flush')); await history.initialize()
  for (let n = 0; n < 50; n++) { history.capture(activity('Entry ' + n), context); if (n % 5 === 0) void history.flush() }
  await history.close(true)
  const disk = JSON.parse(await readFile(location(path.join(root, 'flush'), history.overview().current.id), 'utf8'))
  assert.equal(disk.activity[0].text, 'Entry 49'); assert.equal(disk.activity.length, 50); assert.equal(disk.session.status, 'closed')
  assert.ok(!(await readdir(path.join(root, 'flush', 'operation-history'))).some(name => name.endsWith('.tmp')))
})

test('Apps operations remain grouped with profile, per-app results and diagnostics', async () => {
  const history = new OperationHistory(path.join(root, 'apps')); await history.initialize()
  const state = { operationId: 'backup-1', startedAt: new Date().toISOString(), id: 'phone', userId: 10, operation: 'backup', name: 'Backup', status: 'running', message: 'Copying', items: [{ packageName: 'org.example.one', label: 'One', status: 'success' }, { packageName: 'org.example.two', label: 'Two', status: 'running' }], completed: 1, total: 2 }
  history.capture({ type: 'backup', state }, context)
  history.capture({ type: 'backup', state: { ...state, message: 'More progress' } }, context)
  let saved = await history.read(history.overview().current.id)
  assert.equal(saved.activity.length, 1); assert.equal(saved.activity[0].operation.profileName, 'Work')
  saved.session.status = 'interrupted'; saved = recoverSession(saved)
  assert.equal(saved.activity[0].operation.status, 'interrupted'); assert.equal(saved.activity[0].operation.items[1].uncertain, true)
  history.capture({ type: 'backup', state: { ...state, status: 'partial', message: 'Disk full' } }, context)
  await history.close(true)
  assert.equal(history.snapshot().activity[0].operation.status, 'partial')
})

test('clear applies only to current Activity and never deletes saved Files or other sessions', async () => {
  const folder = path.join(root, 'clear'), old = new OperationHistory(folder); await old.initialize(); old.capture(activity('Keep old'), context); await old.close(true)
  const current = new OperationHistory(folder); await current.initialize(); current.capture(activity('Clear this'), context)
  current.capture({ type: 'files', state: { tasks: [task('success')] } }, context)
  await current.clear()
  assert.equal(current.snapshot().activity.length, 0)
  assert.equal((await current.read(current.overview().current.id)).tasks.length, 1)
  assert.equal((await current.read(old.overview().current.id)).activity[0].text, 'Keep old')
  await current.close(true)
})

test('corrupt files and failed writes are visible; they do not discard intact history or stop operations', async () => {
  const folder = path.join(root, 'broken'); await mkdir(path.join(folder, 'operation-history'), { recursive: true })
  const id = randomUUID(); await writeFile(location(folder, id), '{invalid')
  const history = new OperationHistory(folder); await history.initialize()
  assert.match(history.overview().error, /damaged/); assert.equal(await readFile(location(folder, id), 'utf8'), '{invalid')
  await assert.rejects(history.read('../backend'), /Invalid/)
  await history.close(true)
  const blocked = path.join(root, 'blocked'); await writeFile(blocked, 'not a directory')
  const failure = new OperationHistory(blocked); await failure.initialize(); failure.capture(activity('Still available'), context); await failure.flush()
  assert.match(failure.overview().error, /could not be saved or read/); assert.equal(failure.snapshot().activity[0].text, 'Still available')
  await failure.close(false)
})

test('retention limits finished entries and file tasks without dropping live operations', async () => {
  const history = new OperationHistory(path.join(root, 'retention')); await history.initialize()
  for (let i = 0; i < 510; i++) history.capture(activity('Event ' + i), context)
  assert.equal(history.snapshot().activity.length, 500)
  history.capture({ type: 'files', state: { tasks: Array.from({ length: 110 }, (_, i) => ({ ...task(i === 0 ? 'paused' : 'success'), id: String(i) })) } }, context)
  const saved = await history.read(history.overview().current.id)
  assert.equal(saved.tasks.length, 100); assert.ok(saved.tasks.some(t => t.id === '0'))
  await history.close(true)
})

test('uncompleted request markers are retained without credentials and removed after completion', async () => {
  const history = new OperationHistory(path.join(root, 'requests')); await history.initialize()
  const id = history.startRequest('Connection · Pairing', 'connection', 'phone')
  let saved = await history.read(history.overview().current.id); saved.session.status = 'interrupted'
  assert.equal(recoverSession(saved).activity[0].interrupted, true)
  history.finishRequest(id); await history.close(true)
  assert.equal((await history.read(history.overview().current.id)).pending.length, 0)
})
