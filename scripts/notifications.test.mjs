import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { OperationNotifications } from '../dist-electron/operation-notifications.js'
import { DesktopNotifications } from '../dist-electron/desktop-notifications.js'
import { defaultNotificationSettings, notificationSettings, validateNotificationSettings, notificationEvents } from '../dist-electron/notifications-protocol.js'
import { Storage } from '../dist-electron/storage.js'

function harness(t, overrides = {}) {
  const settings = { ...defaultNotificationSettings(), ...overrides }, alerts = []
  const ui = { focused: false }
  const service = new OperationNotifications(() => settings, () => ui.focused, (alert, delivery) => alerts.push({ ...alert, delivery }))
  t.after(() => service.stop())
  return { service, settings, alerts, ui }
}
const file = (id, status) => ({ id, action: 'copy', status, items: [{ status: 'success' }, { status: 'success' }], completed: 2 })
const files = (...tasks) => ({ type: 'files', state: { tasks } })
const backup = status => ({ type: 'backup', state: { operationId: 'backup-1', id: 'phone', userId: 0, status, operation: 'backup', items: Array.from({ length: 20 }, (_, i) => ({ packageName: 'app' + i, status: i === 19 ? 'error' : 'success' })), message: 'Done' } })

test('one backup result, no per-item/progress/history/repeated terminal notifications', t => {
  const { service, alerts } = harness(t)
  service.capture(backup('running'))
  for (let i = 0; i < 10; i++) service.capture(backup('running'))
  service.flush(); assert.equal(alerts.length, 0)
  service.capture(backup('partial')); service.capture(backup('partial'))
  service.capture({ type: 'history', overview: { activity: [{ operation: { status: 'error' } }] } })
  service.flush(); assert.equal(alerts.length, 1)
  assert.equal(alerts[0].category, 'problems'); assert.match(alerts[0].body, /19 completed.*1 failed/)
})
test('old terminal states and cancelled tasks are silent; retries can report their new result', t => {
  const { service, alerts } = harness(t)
  service.capture(files(file('old', 'success'), file('cancel', 'running')))
  service.capture(files(file('old', 'success'), file('cancel', 'cancelled')))
  service.flush(); assert.equal(alerts.length, 0)
  service.capture(files(file('old', 'running'))); service.capture(files(file('old', 'success'))); service.flush()
  assert.equal(alerts.length, 1)
})
test('file conflict alerts once, opens tasks, and a later resolution can complete', t => {
  const { service, alerts } = harness(t)
  for (const status of ['queued', 'running', 'conflict', 'conflict']) service.capture(files(file('a', status)))
  service.flush(); assert.equal(alerts.length, 1); assert.equal(alerts[0].taskPanel, true)
  assert.equal(alerts[0].category, 'problems')
  service.capture(files(file('a', 'running'))); service.capture(files(file('a', 'success'))); service.flush()
  assert.equal(alerts.length, 2); assert.equal(alerts[1].category, 'completed')
})
test('bursts coalesce and preference changes also filter already pending alerts', t => {
  const { service, alerts, settings } = harness(t)
  service.capture(files(file('a', 'running'), file('b', 'running')))
  service.capture(files(file('a', 'success'), file('b', 'error')))
  service.flush(); assert.equal(alerts.length, 1); assert.equal(alerts[0].category, 'problems'); assert.match(alerts[0].title, /2 operation/)
  service.capture(files(file('c', 'running'))); service.capture(files(file('c', 'success')))
  settings.events['file-copy'] = { desktop: false, sound: false }; service.flush(); assert.equal(alerts.length, 1)
})
test('background-only, disabled channels, problem filters and shutdown suppress alerts without replay', t => {
  const { service, alerts, settings, ui } = harness(t, { backgroundOnly: true })
  ui.focused = true
  service.capture(files(file('a', 'running'))); service.capture(files(file('a', 'success'))); service.flush()
  ui.focused = false; service.capture(files(file('a', 'success'))); service.flush(); assert.equal(alerts.length, 0)
  settings.desktop = settings.sound = false
  service.capture(files(file('b', 'running'))); service.capture(files(file('b', 'error'))); service.flush()
  settings.desktop = true; settings.events['file-error'] = { desktop: false, sound: false }
  service.capture(files(file('c', 'running'))); service.capture(files(file('c', 'error'))); service.flush()
  assert.equal(alerts.length, 0)
  service.capture(files(file('d', 'running'))); service.capture(files(file('d', 'success')))
  service.stop(); service.flush(); assert.equal(alerts.length, 0)
})
test('disconnect transition, not first snapshot or every offline poll; includes vanished phone', t => {
  const { service, alerts } = harness(t)
  const connection = status => ({ type: 'connection', connection: { devices: status ? [{ id: 'phone', name: 'Tablet', status }] : [] } })
  service.capture(connection('offline')); service.flush(); assert.equal(alerts.length, 0)
  service.capture(connection('connected')); service.capture(connection('offline')); service.capture(connection('offline')); service.flush()
  assert.equal(alerts.length, 1); assert.match(alerts[0].body, /Tablet/)
  service.capture(connection('connected')); service.capture(connection(null)); service.flush(); assert.equal(alerts.length, 2)
})
test('component checking stays silent; installation and Android report completion notify', t => {
  const { service, alerts } = harness(t)
  const component = status => ({ type: 'components', components: [{ id: 'adb', name: 'ADB', status }] })
  service.capture(component('Checking')); service.capture(component('Detected')); service.flush(); assert.equal(alerts.length, 0)
  service.capture(component('Downloading')); service.capture(component('Installing')); service.capture(component('Checking')); service.capture(component('Installed')); service.flush()
  assert.equal(alerts.length, 1)
  for (const status of ['running', 'success', 'success']) service.capture({ type: 'androidDiagnostics', state: { job: { id: 'report', kind: 'bugreport', status, message: 'Saved' } } })
  service.flush(); assert.equal(alerts.length, 2); assert.equal(alerts[1].title, 'Bug report ready')
})
test('app collection and scans report final results, not cached inventories or badge progress', t => {
  const { service, alerts } = harness(t)
  const apps = { deviceId: 'phone', userId: 10, profiles: [{ id: 10, name: 'Work' }], apps: [{}, {}], status: 'ready' }
  service.capture({ type: 'apps', apps }); service.flush(); assert.equal(alerts.length, 0)
  service.capture({ type: 'apps', apps: { ...apps, status: 'loading' } })
  service.capture({ type: 'apps', apps }); service.capture({ type: 'apps', apps }); service.flush()
  assert.equal(alerts.length, 1); assert.match(alerts[0].body, /Work.*2 applications/)
  service.capture({ type: 'apps', apps: { ...apps, badgeRead: { status: 'running', completed: 1, total: 2, failed: 1 } } })
  service.capture({ type: 'apps', apps: { ...apps, badgeRead: { status: 'complete', completed: 2, total: 2, failed: 1 } } }); service.flush()
  assert.equal(alerts.length, 2); assert.equal(alerts[1].category, 'problems')
})
test('file search success and failure notify once; cancelled searches remain silent', t => {
  const { service, alerts } = harness(t)
  const search = (id, status) => ({ type: 'fileSearch', state: { id, status, operation: 'search', matched: 8, scanned: 20, message: 'Cannot read folder' } })
  for (const status of ['running', 'complete', 'complete']) service.capture(search('first', status))
  service.flush(); assert.equal(alerts.length, 1); assert.match(alerts[0].body, /8 matches/)
  service.capture(search('second', 'running')); service.capture(search('second', 'error')); service.flush()
  assert.equal(alerts.length, 2); assert.equal(alerts[1].category, 'problems')
  service.capture(search('third', 'running')); service.capture(search('third', 'cancelled')); service.flush(); assert.equal(alerts.length, 2)
})
test('notification settings validate, persist false independently, and tolerate damaged preferences', async () => {
  const root = await mkdtemp(path.resolve('desktop-test-results/notification-settings-'))
  const storage = new Storage(root)
  const expected = { ...defaultNotificationSettings(), sound: false, backgroundOnly: true }
  expected.events['apps-loaded'].desktop = false
  expected.events['file-copy'].sound = false
  storage.data.notifications = expected; await storage.save()
  const restored = new Storage(root); await restored.load(); assert.deepEqual(restored.data.notifications, expected)
  const data = JSON.parse(await readFile(path.join(root, 'backend.json'), 'utf8')); data.notifications = { sound: 'false', desktop: false }
  await writeFile(path.join(root, 'backend.json'), JSON.stringify(data)); await restored.load()
  assert.equal(restored.data.notifications.sound, true); assert.equal(restored.data.notifications.desktop, false)
  assert.throws(() => validateNotificationSettings({ sound: false }), /Invalid/)
  assert.throws(() => validateNotificationSettings({ ...expected, surprise: true }), /Invalid/)
  assert.deepEqual(notificationSettings(null), defaultNotificationSettings())
  const migrated = notificationSettings({ completed: false, problems: false, disconnected: true, desktop: false, sound: true })
  for (const event of notificationEvents) assert.deepEqual(migrated.events[event.id], { desktop: event.category === 'disconnected', sound: event.category === 'disconnected' })
  assert.equal(migrated.desktop, false); assert.equal(migrated.sound, true)
  assert.throws(() => validateNotificationSettings({ ...expected, events: { ...expected.events, 'file-copy': { desktop: true, sound: 'false' } } }), /Invalid/)
  const missing = structuredClone(expected); delete missing.events['apps-loaded']
  assert.throws(() => validateNotificationSettings(missing), /Invalid/)
})
test('event channels remain independent when different tasks finish together', t => {
  const { service, alerts, settings } = harness(t)
  settings.events['file-copy'] = { desktop: false, sound: true }
  settings.events['file-move'] = { desktop: true, sound: false }
  const move = status => ({ ...file('move', status), action: 'move' })
  service.capture(files(file('copy', 'running'), move('running')))
  service.capture(files(file('copy', 'success'), move('success'))); service.flush()
  assert.equal(alerts.length, 2)
  assert.deepEqual(alerts[0].delivery, { desktop: true, sound: false }); assert.match(alerts[0].title, /Move/); assert.doesNotMatch(alerts[0].body, /Copy/)
  assert.deepEqual(alerts[1].delivery, { desktop: false, sound: true }); assert.match(alerts[1].title, /Copy/)
  settings.events['file-move'].sound = true
  service.capture(files(file('copy', 'running'), move('running')))
  service.capture(files(file('copy', 'success'), move('success'))); service.flush()
  assert.equal(alerts.length, 3); assert.deepEqual(alerts[2].delivery, { desktop: true, sound: true })
})
test('disabling an event does not suppress other completions or errors', t => {
  const { service, alerts, settings } = harness(t)
  settings.events['file-copy'] = { desktop: false, sound: false }
  service.capture(files(file('a', 'running'))); service.capture(files(file('a', 'success'))); service.flush(); assert.equal(alerts.length, 0)
  service.capture(files(file('b', 'running'))); service.capture(files(file('b', 'error'))); service.flush(); assert.equal(alerts[0].event, 'file-error')
  service.capture(backup('running')); service.capture(backup('complete')); service.flush(); assert.equal(alerts[1].event, 'apps-backup')
})
test('optional reading start, APK analysis and reconnect events obey their own switches', t => {
  const { service, alerts, settings } = harness(t)
  for (const id of ['apps-reading', 'apps-apk-scan', 'device-connected']) settings.events[id] = { desktop: true, sound: false }
  const apps = { deviceId: 'phone', userId: 0, profiles: [], apps: [], status: 'loading' }
  service.capture({ type: 'apps', apps: { ...apps, userId: null } }); service.capture({ type: 'apps', apps }); service.capture({ type: 'apps', apps }); service.flush()
  assert.equal(alerts.length, 1); assert.equal(alerts[0].event, 'apps-reading')
  for (const status of ['running', 'complete']) service.capture({ type: 'apps', apps: { ...apps, details: { deviceId: 'phone', userId: 0, packageName: 'org.test', data: { analysis: { status } } } } })
  service.flush(); assert.equal(alerts[1].event, 'apps-apk-scan')
  const connection = status => ({ type: 'connection', connection: { devices: [{ id: 'phone', name: 'Phone', method: 'Wi-Fi', status }] } })
  service.capture(connection('connected')); service.flush(); assert.equal(alerts.length, 2)
  settings.events['device-disconnected'] = { desktop: false, sound: false }
  service.capture(connection('offline')); service.capture(connection('connected')); service.capture(connection('connected')); service.flush()
  assert.equal(alerts.length, 3); assert.equal(alerts[2].event, 'device-connected')
})
test('native delivery channels are independent, click routing works and failures reach the caller', async t => {
  const settings = defaultNotificationSettings(), created = [], navigations = []; let beeps = 0, fail = false
  const service = new DesktopNotifications(() => settings, (...args) => navigations.push(args), {
    isSupported: () => true, beep: () => beeps++, create: options => {
      const notification = new EventEmitter()
      notification.options = options; notification.show = () => queueMicrotask(() => fail ? notification.emit('failed', {}, 'denied') : notification.emit('show'))
      notification.close = () => notification.emit('close'); created.push(notification); return notification
    },
  })
  t.after(() => service.stop())
  const alert = { event: 'file-copy', title: 'Copy completed', body: 'Saved', category: 'completed', destination: 'files', taskPanel: true }
  await service.show(alert); assert.equal(created[0].options.silent, false); assert.equal(beeps, 0)
  created[0].emit('click'); assert.deepEqual(navigations, [['files', true]])
  settings.sound = false; await service.show(alert); assert.equal(created[1].options.silent, true); assert.equal(beeps, 0)
  settings.desktop = false; settings.sound = true; await service.show(alert); assert.equal(beeps, 1); assert.equal(created.length, 2)
  settings.sound = false; await service.show(alert); assert.equal(beeps, 1); await assert.rejects(service.test(), /Enable/)
  settings.desktop = true; fail = true; await assert.rejects(service.test(), /denied/)
  service.stop(); created[0].emit('click'); assert.equal(navigations.length, 1)
})
