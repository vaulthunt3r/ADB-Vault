import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { AppsService } from '../dist-electron/apps.js'
import { emptyApps } from '../dist-electron/apps-protocol.js'
const manifest = JSON.parse(await readFile('android-helper/dist/helper-manifest.json', 'utf8'))
const names = ['org.example.one', 'org.example.two']
const ok = stdout => ({ stdout, stderr: '', code: 0 })
const details = name => ({ type: 'details', protocolVersion: 1, packageName: name, userId: 10, uid: 1010123, fields: {}, flags: [], badges: { largeHeap: name === names[0] }, paths: [], splits: [], installers: [], storage: { requested: false, appBytes: null, dataBytes: null, cacheBytes: null }, network: { start: 1, end: 2, wifi: null, mobile: null }, links: [], issues: [] })
function fixture(hook) {
  const calls = [], events = []
  const device = { id: 'phone', serial: 'serial', status: 'connected' }
  const connection = { activeDeviceId: 'phone', devices: [device] }
  const service = new AppsService(path.resolve('android-helper/dist'), () => 'adb.exe', () => connection, e => events.push(e), async (_file, args, _timeout, _input, _env, controls) => {
    calls.push(args)
    assert.deepEqual(args.slice(0, 2), ['-s', 'serial'])
    const command = args.join(' ')
    if (command.includes('sha256sum')) return ok(manifest.sha256)
    const name = command.match(/--details (\S+) (?:--permissions )?10$/)?.[1]
    assert.ok(name, `Unexpected command: ${command}`)
    if (hook) await hook(name, controls)
    return ok(JSON.stringify(details(name)))
  }, () => undefined)
  service.state = { ...emptyApps(), status: 'ready', deviceId: 'phone', userId: 10, profiles: [{ id: 10, name: 'Work' }, { id: 0, name: 'Owner' }], apps: names.map(packageName => ({ packageName, userId: 10 })) }
  service.cache.set(10, service.state)
  return { service, calls, events, connection }
}
test('badge reading collects sequential profile evidence without replacing list or selected Details', async () => {
  const f = fixture(), list = f.service.state.apps
  f.service.state.details = { packageName: 'selected', status: 'ready' }
  const selected = f.service.state.details
  await f.service.readBadges('phone', 10)
  assert.deepEqual(Object.keys(f.service.state.badgeEvidence), names)
  assert.equal(f.service.state.badgeEvidence[names[0]].badges.largeHeap, true)
  assert.equal(f.service.state.badgeEvidence[names[1]].badges.largeHeap, false)
  assert.deepEqual(f.service.state.badgeRead, { status: 'complete', completed: 2, total: 2, failed: 0 })
  assert.equal(f.service.state.apps, list); assert.equal(f.service.state.details, selected)
  assert.equal(f.events.filter(e => e.type === 'apps').every(e => e.apps.status === 'ready'), true)
  assert.equal(f.calls.some(args => /--scan|--root-details|--storage|--permissions/.test(args.join(' '))), false)
  assert.deepEqual(f.service.cache.get(10).badgeEvidence, f.service.state.badgeEvidence)
  await assert.rejects(f.service.readBadges('phone', 0), /loaded profile/)
})
test('a failed app does not stop badge reading or reuse its old evidence', async () => {
  const f = fixture(name => { if (name === names[0]) throw new Error('Access denied') })
  f.service.state.badgeEvidence = { [names[0]]: details(names[0]) }
  await f.service.readBadges('phone', 10)
  assert.equal(f.service.state.badgeRead.failed, 1)
  assert.equal(f.service.state.badgeRead.completed, 2)
  assert.equal(f.service.state.badgeEvidence[names[0]], undefined)
  assert.ok(f.service.state.badgeEvidence[names[1]])
})
test('cancellation retains completed evidence and discards late package replies', async () => {
  let release, started
  const ready = new Promise(resolve => { started = resolve })
  const f = fixture(async name => { if (name === names[1]) { started(); await new Promise(resolve => { release = resolve }) } })
  const pending = f.service.readBadges('phone', 10); await ready
  f.service.cancelBadges(); release(); await pending
  assert.equal(f.service.state.badgeRead.status, 'cancelled')
  assert.equal(f.service.state.badgeRead.completed, 1)
  assert.deepEqual(Object.keys(f.service.state.badgeEvidence), [names[0]])
  assert.equal(f.service.readingBadges, false)
})
test('switching profiles cancels reading and isolates evidence; disconnect clears it', async () => {
  let release, started
  const ready = new Promise(resolve => { started = resolve })
  const f = fixture(async () => { started(); await new Promise(resolve => { release = resolve }) })
  f.service.cache.set(0, { ...f.service.state, userId: 0, apps: [] })
  const pending = f.service.readBadges('phone', 10); await ready
  await f.service.selectProfile('phone', 0); release(); await pending
  assert.equal(f.service.state.userId, 0)
  assert.equal(Object.keys(f.service.state.badgeEvidence || {}).length, 0)
  f.connection.devices = []; f.connection.activeDeviceId = null
  f.service.connectionChanged(f.connection)
  assert.equal(f.service.state.deviceId, null)
  assert.equal(Object.keys(f.service.state.badgeEvidence || {}).length, 0)
})
test('individual Details populates badge evidence and changing root options invalidates it', async () => {
  const f = fixture()
  await f.service.inspect('phone', 10, names[0])
  assert.ok(f.service.state.badgeEvidence[names[0]])
  f.service.configureOptions({ ...f.service.state.options, root: true })
  assert.deepEqual(f.service.state.badgeEvidence, {})
  assert.equal(f.service.state.details, null)
})
