import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { Storage } from '../dist-electron/storage.js'
import path from 'node:path'
import { AppsService } from '../dist-electron/apps.js'
import { parseAppsOutput } from '../dist-electron/apps-protocol.js'
import { run } from '../dist-electron/process.js'
import { parseAndroidProfiles } from '../dist-electron/app-profiles.js'
import { AppsProgressReader } from '../dist-electron/apps-progress.js'
const manifest = JSON.parse(await readFile('android-helper/dist/helper-manifest.json', 'utf8'))

test('absent packages stay separate and a one-package update moves between lists in the selected profile', async () => {
  let installed = false
  const f = fixture({ helper: async (_options, userId) => {
    const values = records(); values[0].userId = userId; values[1] = { ...values[1], installed, userId, uid: userId * 100000 + 10123 }
    return ok(stream(values))
  } })
  await f.service.refresh('device-id', 10)
  assert.equal(f.service.state.apps.length, 0); assert.equal(f.service.state.removedApps[0].userId, 10)
  installed = true; await f.service.refreshAfterAction('device-id', 10, app.packageName)
  assert.equal(f.service.state.apps.length, 1); assert.equal(f.service.state.removedApps.length, 0)
  installed = false; await f.service.refreshAfterAction('device-id', 10, app.packageName)
  assert.equal(f.service.state.apps.length, 0); assert.equal(f.service.state.removedApps.length, 1)
  const malformed = records(); malformed[1].installed = 'false'; assert.throws(() => parseAppsOutput(stream(malformed), 0, '0.1.0'), /installed/)
})
const app = { type: 'app', packageName: 'org.example.app', label: 'Приложение 日本語', versionName: '1.0', versionCode: 42, uid: 10123, userId: 0, enabled: false, system: true, updatedSystemApp: true, sourceDir: '/data/app/example/base.apk', firstInstallTime: 123, lastUpdateTime: 456, targetSdk: 35, minSdk: 26, debuggable: false, suspended: false, stopped: true, enabledState: 3, installer: null, iconPng: null }
const records = () => [{ type: 'header', protocolVersion: 1, helperVersion: '0.1.0', userId: 0, sdk: 36, locale: 'ru-RU', iconSize: 96, total: 1 }, { ...app }, { type: 'complete', count: 1, elapsedMs: 5, warnings: 0 }]
const stream = values => values.map(v => JSON.stringify(v)).join('\n')

test('streamed progress handles partial lines and rejects wrong profiles, duplicates and oversized records', () => {
  const seen = [], reader = new AppsProgressReader(0, '0.1.0', (completed, total) => seen.push([completed, total]))
  const output = stream(records()) + '\n'
  for (let i = 0; i < output.length; i += 7) reader.push(output.slice(i, i + 7))
  assert.deepEqual(seen, [[0, 1], [1, 1]])
  assert.throws(() => reader.push(JSON.stringify(app) + '\n'), /Invalid Apps progress/)
  assert.throws(() => new AppsProgressReader(10, '0.1.0', () => {}).push(JSON.stringify(records()[0]) + '\n'), /header/)
  assert.throws(() => new AppsProgressReader(0, '0.1.0', () => {}).push('x'.repeat(200001)), /size limit/)
})

test('Apps publishes actual counts while streaming without accepting a partial inventory', async () => {
  let release, started
  const ready = new Promise(resolve => { started = resolve })
  const f = fixture({ helper: async options => {
    options.onStdout(JSON.stringify(records()[0]) + '\n' + JSON.stringify(app) + '\n')
    started(); await new Promise(resolve => { release = resolve })
    return ok(stream(records()))
  } })
  const pending = f.service.refresh('device-id'); await ready
  assert.equal(f.service.state.status, 'loading'); assert.deepEqual(f.service.state.progress, { completed: 1, total: 1 }); assert.equal(f.service.state.apps.length, 0)
  release(); await pending; assert.equal(f.service.state.status, 'ready'); assert.equal(f.service.state.progress, null)
})

test('APK sizes and split counts preserve unknown values and reject invalid metadata', () => {
  for (const size of [null, 10485760]) {
    const values = records(); Object.assign(values[1], { apkSizeBytes: size, splitCount: 3 })
    assert.equal(parseAppsOutput(stream(values), 0, '0.1.0').apps[0].apkSizeBytes, size)
  }
  for (const key of ['apkSizeBytes', 'splitCount']) for (const invalid of [-1, 1.5, '10', Number.MAX_SAFE_INTEGER + 1]) {
    const values = records(); values[1][key] = invalid
    assert.throws(() => parseAppsOutput(stream(values), 0, '0.1.0'), /Invalid application/)
  }
})
test('Profile parser preserves localized names, colons, OEM spaces and running state', () => {
  const profiles = parseAndroidProfiles('Users:\n UserInfo{0:Личный: профиль:c13} running\n UserInfo{10:Work:30} running\n UserInfo{999:Second space:10}')
  assert.equal(profiles[0].name, 'Личный: профиль'); assert.equal(profiles[1].managed, true); assert.equal(profiles[2].running, false)
  assert.throws(() => parseAndroidProfiles('Permission denied'), /profile list/)
  assert.throws(() => parseAndroidProfiles('UserInfo{0:One:10}\nUserInfo{0:Two:10}'), /Duplicate/)
})
test('Apps rejects packages from another profile even if the header claims the requested user', () => {
  const values = records(); values[0].userId = 10; values[1].userId = 10
  assert.throws(() => parseAppsOutput(stream(values), 10, '0.1.0'), /UID belongs/)
})
test('Apps protocol preserves framework flags, nullable metadata and localized text', () => {
  const value = parseAppsOutput(stream(records()), 0, '0.1.0')
  assert.equal(value.apps[0].label, app.label)
  assert.equal(value.apps[0].updatedSystemApp, true)
  assert.equal(value.apps[0].enabled, false)
  assert.equal(value.apps[0].installer, null)
})
test('Apps protocol rejects truncation, protocol drift, wrong users, duplicate packages and bad icons', () => {
  const mutations = [v => v.pop(), v => { v[0].protocolVersion = 99 }, v => { v[1].userId = 10 }, v => { v[0].total = 2; v[2].count = 2; v.splice(2, 0, { ...v[1] }) }, v => { v[1].iconPng = 'not an image' }, v => { v[1].enabled = 'false' }, v => { v[1].versionCode = Number.MAX_SAFE_INTEGER + 1 }]
  for (const mutate of mutations) { const values = records(); mutate(values); assert.throws(() => parseAppsOutput(stream(values), 0, '0.1.0')) }
})
const ok = stdout => ({ stdout, stderr: '', code: 0 })
function fixture({ cached = true, failUpload = false, helper, users = 'Users:\n UserInfo{0:Owner:c13} running\n UserInfo{10:Work:30} running\n UserInfo{999:Second space:10}' } = {}) {
  const device = { id: 'device-id', serial: 'usb-serial', status: 'connected' }
  let connection = { activeDeviceId: device.id, devices: [device] }
  const calls = [], events = []
  const runner = async (_file, args, _timeout, _input, _env, options) => {
    calls.push(args)
    assert.deepEqual(args.slice(0, 2), ['-s', device.serial])
    const cmd = args.slice(2).join(' ')
    if (cmd.includes('ro.build.version.sdk')) return ok('36')
    if (cmd.includes('get-current-user')) return ok('0')
    if (cmd === 'shell pm list users') return ok(users)
    if (cmd.includes('if [ -f')) return ok(cached ? `${manifest.sha256}  manager-server.jar` : '')
    if (cmd.includes('sha256sum')) return ok(`${failUpload ? 'bad' : manifest.sha256}  manager-server.jar.new`)
    if (cmd.includes('app_process')) {
      if (helper) return helper(options, Number(cmd.split(' ').at(-1)))
      const userId = Number(cmd.split(' ').at(-1)), values = records()
      values[0].userId = userId; values[1].userId = userId; values[1].uid = userId * 100000 + 10123
      return ok(stream(values))
    }
    return ok('')
  }
  const service = new AppsService(path.resolve('android-helper/dist'), () => 'adb.exe', () => connection, e => events.push(e), runner)
  return { service, calls, events, getConnection: () => connection, setConnection: value => { connection = value; service.connectionChanged(connection) }, change: () => { connection = { activeDeviceId: 'another', devices: [{ id: 'another', status: 'connected' }] }; service.connectionChanged(connection) } }
}
test('Apps cache skips push; one helper invocation collects metadata and icons', async () => {
  const { service, calls } = fixture()
  await service.refresh('device-id')
  assert.equal(service.state.status, 'ready')
  assert.equal(calls.length, 5)
  assert.equal(calls.filter(a => a.includes('push')).length, 0)
  assert.equal(calls.filter(a => a.some(v => v.includes('app_process'))).length, 1)
})

test('post-action update reads one package, keeps the table ready and updates the profile cache', async () => {
  let changed = false
  const f = fixture({ helper: async (_options, userId) => {
    const values = records(); values[1].stopped = changed
    values[0].userId = userId; values[1].userId = userId; values[1].uid = userId * 100000 + 10123
    return ok(stream(values))
  } })
  await f.service.refresh('device-id', 0)
  const other = { ...app, packageName: 'org.example.other' }
  f.service.state.apps.push(other)
  const timestamp = f.service.state.collectedAt
  changed = true; f.calls.length = 0; f.events.length = 0
  await f.service.refreshAfterAction('device-id', 0, app.packageName)
  assert.equal(f.service.state.apps[0].stopped, true)
  assert.equal(f.service.state.apps[1], other)
  assert.equal(f.service.state.collectedAt, timestamp)
  assert.equal(f.events.filter(e => e.type === 'apps').every(e => e.apps.status === 'ready' && e.apps.apps.length === 2), true)
  const collection = f.calls.filter(args => args.join(' ').includes('app_process'))
  assert.equal(collection.length, 1)
  assert.match(collection[0].join(' '), /--package org\.example\.app 0$/)
  await f.service.selectProfile('device-id', 10)
  const before = f.calls.length
  await f.service.selectProfile('device-id', 0)
  assert.equal(f.calls.length, before)
  assert.equal(f.service.state.apps[0].stopped, true)
  assert.equal(f.service.state.apps.length, 2)
})

test('restored application is appended when absent without rereading the full inventory', async () => {
  const f = fixture()
  await f.service.refresh('device-id', 0)
  const other = { ...app, packageName: 'org.example.other' }
  f.service.state.apps = [other]; f.calls.length = 0; f.events.length = 0
  await f.service.refreshAfterAction('device-id', 0, app.packageName)
  assert.deepEqual(f.service.state.apps.map(a => a.packageName), ['org.example.other', app.packageName])
  assert.equal(f.service.state.apps[0], other)
  assert.ok(f.events.filter(e => e.type === 'apps').every(e => e.apps.status === 'ready'))
  assert.equal(f.calls.filter(args => args.join(' ').includes('app_process')).length, 1)
})

test('post-action removal drops only the requested package without full inventory loading', async () => {
  let removed = false
  const f = fixture({ helper: async () => {
    const values = records()
    if (removed) { values[0].total = 0; values[2].count = 0; values.splice(1, 1) }
    return ok(stream(values))
  } })
  await f.service.refresh('device-id', 0)
  f.service.state.apps.push({ ...app, packageName: 'org.example.other' })
  removed = true; f.events.length = 0
  await f.service.refreshAfterAction('device-id', 0, app.packageName)
  assert.deepEqual(f.service.state.apps.map(a => a.packageName), ['org.example.other'])
  assert.equal(f.events.filter(e => e.type === 'apps').every(e => e.apps.status === 'ready'), true)
})

test('failed or wrong-package post-action reads preserve the visible inventory', async () => {
  for (const failure of ['error', 'wrong-package']) {
    let updating = false
    const f = fixture({ helper: async () => {
      if (updating && failure === 'error') throw new Error('Lost connection')
      const values = records()
      if (updating) values[1].packageName = 'org.wrong.app'
      return ok(stream(values))
    } })
    await f.service.refresh('device-id', 0)
    const list = f.service.state.apps
    updating = true; f.events.length = 0
    await assert.rejects(f.service.refreshAfterAction('device-id', 0, app.packageName))
    assert.equal(f.service.state.apps, list)
    assert.equal(f.events.filter(e => e.type === 'apps').every(e => e.apps.status === 'ready'), true)
  }
})

test('post-action response is discarded when the device disconnects', async () => {
  let updating = false, started, release
  const startedPromise = new Promise(resolve => { started = resolve })
  const f = fixture({ helper: async () => {
    if (updating) { started(); await new Promise(resolve => { release = resolve }) }
    return ok(stream(records()))
  } })
  await f.service.refresh('device-id', 0); updating = true
  const pending = f.service.refreshAfterAction('device-id', 0, app.packageName)
  await startedPromise
  f.change(); release()
  await assert.rejects(pending, /context changed/)
  assert.equal(f.service.state.apps.length, 0)
  assert.equal(f.service.state.status, 'idle')
})
test('Apps missing helper uploads once, verifies hash before activation and blocks corrupt upload', async () => {
  const valid = fixture({ cached: false }); await valid.service.refresh('device-id')
  assert.equal(valid.calls.filter(a => a.includes('push')).length, 1)
  assert.ok(valid.calls.some(a => a.some(v => v.includes('chmod 444'))))
  const bad = fixture({ cached: false, failUpload: true })
  await assert.rejects(bad.service.refresh('device-id'), /checksum/)
  assert.equal(bad.service.state.status, 'error')
  assert.ok(!bad.calls.some(a => a.some(v => v.includes('app_process'))))
})
test('Apps device switch cancels the command and never publishes stale inventory', async () => {
  let reached
  const running = new Promise(resolve => { reached = resolve })
  const f = fixture({ helper: options => new Promise((_, reject) => { reached(); options.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }) }) })
  const pending = f.service.refresh('device-id'); await running; f.change(); await pending
  assert.equal(f.service.state.deviceId, null)
  assert.equal(f.service.state.apps.length, 0)
  assert.equal(f.events.some(e => e.type === 'apps' && e.apps.status === 'ready'), false)
})
test('Apps cancellation and malformed stream leave no apparent successful result', async () => {
  const f = fixture({ helper: async () => ok(stream(records().slice(0, 2))) })
  await assert.rejects(f.service.refresh('device-id'), /interrupted/)
  assert.equal(f.service.state.apps.length, 0)
  f.service.cancel(); assert.equal(f.service.state.status, 'idle')
  await assert.rejects(f.service.refresh('missing'), /Select a connected/)
})
test('Apps selects an explicit profile and keeps it on refresh without switching Android users', async () => {
  const { service, calls } = fixture()
  await service.refresh('device-id', 10)
  assert.equal(service.state.userId, 10); assert.equal(service.state.currentUserId, 0)
  assert.equal(service.state.apps[0].userId, 10); assert.equal(service.state.profiles.length, 3)
  await service.refresh('device-id')
  assert.equal(service.state.userId, 10)
  assert.equal(calls.some(args => args.some(arg => /switch-user|start-user|unlock-user/.test(arg))), false)
  await service.refresh('device-id', 999)
  assert.equal(service.state.userId, 999)
})
test('Apps rejects missing or invalid profiles and exposes discovery failure without inventing others', async () => {
  const { service, calls } = fixture()
  await assert.rejects(service.refresh('device-id', '10;reboot'), /Invalid Android profile/)
  await assert.rejects(service.refresh('device-id', 42), /no longer available/)
  assert.equal(service.state.apps.length, 0); assert.equal(service.state.profiles.length, 3)
  assert.equal(calls.some(args => args.some(arg => arg.includes('app_process'))), false)
  const denied = fixture({ users: 'Permission denied' })
  await denied.service.refresh('device-id')
  assert.equal(denied.service.state.status, 'ready'); assert.equal(denied.service.state.profiles.length, 1)
  assert.match(denied.service.state.profilesError, /could not be listed/)
  await assert.rejects(denied.service.refresh('device-id', 10), /no longer available/)
})
test('Runner preserves split UTF-8, enforces configured output limit and supports cancellation', async () => {
  const result = await run(process.execPath, ['-e', "const b=Buffer.from('Привет');process.stdout.write(b.subarray(0,1));setTimeout(()=>process.stdout.write(b.subarray(1)),20)"])
  assert.equal(result.stdout, 'Привет')
  await assert.rejects(run(process.execPath, ['-e', "process.stdout.write('x'.repeat(1000))"], 2000, undefined, undefined, { maxOutputBytes: 100 }), /limit/)
  const controller = new AbortController()
  const pending = run(process.execPath, ['-e', 'setInterval(()=>{},1000)'], 5000, undefined, undefined, { signal: controller.signal })
  controller.abort(); await assert.rejects(pending, /cancelled/)
})

const profileOutput = userId => { const values = records(); values[0].userId = userId; values[1].userId = userId; values[1].uid = userId * 100000 + 10123; return ok(stream(values)) }
async function waitFor(predicate) { for (let n = 0; n < 200; n++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)) }; assert.fail('Timed out waiting for Apps queue') }
test('On-demand caches visited profiles; explicit Refresh re-reads; preload starts only after Apps collection', async () => {
  const f = fixture()
  f.service.configure('preload'); assert.equal(f.calls.length, 0)
  f.service.configure('selected')
  await f.service.refresh('device-id', 0)
  assert.deepEqual(f.service.state.cachedUserIds, [0]); assert.equal(f.service.state.backgroundUserId, null)
  await f.service.selectProfile('device-id', 10)
  const count = f.calls.length
  await f.service.selectProfile('device-id', 0); assert.equal(f.calls.length, count)
  await f.service.refresh('device-id', 0); assert.equal(f.calls.length, count + 5)
  f.service.configure('preload')
  await waitFor(() => f.service.state.cachedUserIds.length === 3 && f.service.state.backgroundUserId === null)
  assert.equal(f.service.state.userId, 0); assert.equal(f.service.state.status, 'ready')
  const complete = f.calls.length
  await f.service.selectProfile('device-id', 999); assert.equal(f.calls.length, complete)
})
test('Disabling preload aborts background read, preserves foreground and does not continue queue', async () => {
  let aborted = false
  const f = fixture({ helper: (options, userId) => userId === 0 ? profileOutput(0) : new Promise((_, reject) => options.signal.addEventListener('abort', () => { aborted = true; reject(new Error('cancelled')) }, { once: true })) })
  f.service.configure('preload'); await f.service.refresh('device-id', 0)
  await waitFor(() => f.calls.filter(a => a.some(v => v.includes('app_process'))).length === 2)
  assert.equal(f.service.state.status, 'ready'); assert.equal(f.service.state.userId, 0)
  f.service.configure('selected'); await waitFor(() => aborted)
  assert.equal(f.service.state.backgroundUserId, null); assert.equal(f.service.state.apps.length, 1)
  assert.deepEqual(f.service.state.cachedUserIds, [0])
})
test('User selection preempts background work and the interrupted profile is collected later', async () => {
  let firstTen = true, aborted = false
  const f = fixture({ helper: (options, userId) => {
    if (userId === 10 && firstTen) { firstTen = false; return new Promise((_, reject) => options.signal.addEventListener('abort', () => { aborted = true; reject(new Error('cancelled')) }, { once: true })) }
    return profileOutput(userId)
  } })
  f.service.configure('preload'); await f.service.refresh('device-id', 0)
  await waitFor(() => !firstTen)
  await f.service.selectProfile('device-id', 999)
  assert.equal(aborted, true); assert.equal(f.service.state.userId, 999)
  await waitFor(() => f.service.state.cachedUserIds.length === 3 && f.service.state.backgroundUserId === null)
  assert.equal(f.service.state.userId, 999)
})
test('A denied profile is attempted once, other profiles continue, and disconnect clears every cache', async () => {
  let denied = 0
  const f = fixture({ helper: (_options, userId) => { if (userId === 10) { denied++; throw new Error('Profile access denied') }; return profileOutput(userId) } })
  f.service.configure('preload'); await f.service.refresh('device-id', 0)
  await waitFor(() => f.service.state.cachedUserIds.includes(999) && f.service.state.backgroundUserId === null)
  assert.equal(denied, 1); assert.match(f.service.state.preloadErrors[10], /denied/)
  assert.equal(f.service.state.userId, 0); assert.equal(f.service.state.status, 'ready')
  await f.service.selectProfile('device-id', 999); assert.equal(denied, 1)
  f.change(); assert.deepEqual(f.service.state.cachedUserIds, []); assert.equal(f.service.state.deviceId, null)
  assert.equal(f.service.state.loadingMode, 'preload')
})
test('Loading preference survives Storage reload and invalid saved values use on-demand', async () => {
  await mkdir('desktop-test-results', { recursive: true })
  const folder = await mkdtemp(path.resolve('desktop-test-results/apps-mode-'))
  const storage = new Storage(folder); await storage.load(); storage.data.appsLoadingMode = 'preload'; await storage.save()
  const restored = new Storage(folder); await restored.load(); assert.equal(restored.data.appsLoadingMode, 'preload')
  await writeFile(path.join(folder, 'backend.json'), JSON.stringify({ appsLoadingMode: 'invalid', paths: {}, known: [] }))
  await restored.load(); assert.equal(restored.data.appsLoadingMode, 'selected')
})


test('Collection options persist and unknown values revert to safe defaults', async () => {
  const folder = await mkdtemp(path.resolve('desktop-test-results/apps-options-'))
  const store = new Storage(folder); await store.load()
  store.data.appsOptions = { icons: false, early: true, storage: true, root: true }; await store.save()
  const restored = new Storage(folder); await restored.load()
  assert.deepEqual(restored.data.appsOptions, store.data.appsOptions)
  await writeFile(path.join(folder, 'backend.json'), JSON.stringify({ appsOptions: { icons: 'false', early: 1, storage: null, root: 'true' } }))
  await restored.load(); assert.deepEqual(restored.data.appsOptions, { icons: true, early: false, storage: false, root: false })
})

test('Early loading waits for a stable active connection, runs once and retries only after reconnect', async () => {
  const f = fixture()
  const c = { ...f.getConnection(), scanning: true }
  f.setConnection(c)
  f.service.configureOptions({ icons: false, early: true, storage: true })
  assert.equal(f.calls.length, 0)
  f.setConnection({ ...c, scanning: false })
  await waitFor(() => f.service.state.status === 'ready')
  assert.ok(f.calls.some(a => a.some(v => v.includes('--no-icons --storage 0'))))
  const count = f.calls.length
  for (let i = 0; i < 4; i++) f.service.connectionChanged(f.getConnection())
  assert.equal(f.calls.length, count)
  await f.service.selectProfile('device-id', 0); assert.equal(f.calls.length, count)
  f.setConnection({ ...c, activeDeviceId: null, devices: [], scanning: false })
  assert.equal(f.service.state.status, 'idle')
  f.setConnection({ ...c, scanning: false })
  await waitFor(() => f.service.state.status === 'ready')
  assert.ok(f.calls.length > count)
})

test('Early collection failures and cancellation do not cause scan retry loops', async () => {
  const f = fixture({ helper: () => { throw new Error('permission denied') } })
  f.service.configureOptions({ icons: true, early: true, storage: false })
  await waitFor(() => f.service.state.status === 'error')
  const count = f.calls.length
  f.service.cancel()
  for (let i = 0; i < 4; i++) f.service.connectionChanged(f.getConnection())
  assert.equal(f.calls.length, count)
  assert.equal(f.service.state.status, 'idle')
})

test('Changing collection options invalidates profile caches without rereading the visible list', async () => {
  const f = fixture(); await f.service.refresh('device-id', 0)
  await f.service.selectProfile('device-id', 10)
  const count = f.calls.length
  f.service.configureOptions({ icons: false, early: false, storage: true })
  assert.equal(f.calls.length, count); assert.equal(f.service.state.status, 'ready')
  assert.deepEqual(f.service.state.cachedUserIds, [])
  await f.service.selectProfile('device-id', 0)
  assert.ok(f.calls.length > count)
  assert.ok(f.calls.at(-1).some(v => v.includes('--no-icons --storage 0')))
})

test('Storage metadata distinguishes zero, unavailable and not requested', () => {
  const v = records(); Object.assign(v[1], { iconSkipped: true, storageRequested: true, dataBytes: 100, cacheBytes: 0 })
  const app = parseAppsOutput(stream(v), 0, '0.1.0').apps[0]
  assert.equal(app.cacheBytes, 0); assert.equal(app.iconSkipped, true)
  v[1].cacheBytes = null; v[1].storageError = 'Access denied'
  assert.equal(parseAppsOutput(stream(v), 0, '0.1.0').apps[0].cacheBytes, null)
  v[1].cacheBytes = -1; assert.throws(() => parseAppsOutput(stream(v), 0, '0.1.0'), /cacheBytes/)
})
