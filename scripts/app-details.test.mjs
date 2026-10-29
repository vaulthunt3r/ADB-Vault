import { loadDatabase, bundledDatabaseDirectory } from '../dist-electron/databases.js'
const database = await loadDatabase(bundledDatabaseDirectory)
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseAppDetails, validateAppTarget } from '../dist-electron/app-details-protocol.js'
import { AppDetailsReader } from '../dist-electron/app-details.js'
import { emptyApps } from '../dist-electron/apps-protocol.js'
import { collectTrackerBadges, sensorBadge } from '../dist-electron/app-badges.js'
const name = 'org.example.app'
const data = () => ({ type: 'details', protocolVersion: 1, packageName: name, userId: 0, uid: 10123, fields: { mainActivity: 'org.example.app/.Main' }, flags: ['FLAG_HAS_CODE'], badges: { hidden: null, largeHeap: true }, paths: [{ name: 'Data', path: '/data/user/0/org.example.app' }], splits: [], installers: [], storage: { requested: true, appBytes: 100, dataBytes: 20, cacheBytes: 0 }, network: { start: 1, end: 2, wifi: { rx: 0, tx: 12 }, mobile: null }, links: [], issues: [{ area: 'Hidden state', message: 'Access denied' }] })

test('Manifest inventories preserve disabled/exported components and unknown permission grants', () => {
  const d = data()
  d.components = [{ name: name + '.Provider', type: 'Provider', enabled: false, exported: true, directBootAware: false, processName: ':remote', authority: 'example.files', readPermission: 'example.READ', writePermission: null }]
  d.requestedPermissions = [{ name: 'example.PERMISSION', granted: null, protectionLevel: null, declaringPackage: null, label: null, description: null }]
  const parsed = parseAppDetails(JSON.stringify(d), name, 0)
  assert.equal(parsed.components[0].enabled, false)
  assert.equal(parsed.components[0].authority, 'example.files')
  assert.equal(parsed.requestedPermissions[0].granted, null)
  for (const mutate of [d => { d.components[0].exported = 'true' }, d => { d.components[0].readPermission = [] }, d => { d.requestedPermissions[0].granted = 0 }, d => { d.requestedPermissions[0].protectionLevel = -1 }, d => { d.requestedPermissions[0].label = {} }, d => { d.requestedPermissions = Array(10001).fill(d.requestedPermissions[0]) }]) {
    const bad = structuredClone(d); mutate(bad); assert.throws(() => parseAppDetails(JSON.stringify(bad), name, 0))
  }
  assert.equal(parseAppDetails(JSON.stringify(data()), name, 0).requestedPermissions, undefined)
})
test('Details validates identity, counters and nested fields while preserving denied and zero values', () => {
  const valid = parseAppDetails(JSON.stringify(data()), name, 0)
  assert.equal(valid.storage.cacheBytes, 0); assert.equal(valid.network.mobile, null); assert.equal(valid.badges.hidden, null)
  for (const mutate of [d => { d.uid = 1010123 }, d => { d.packageName = 'other' }, d => { d.protocolVersion = 2 }, d => { d.storage.appBytes = -1 }, d => { d.network.wifi.rx = '0' }, d => { d.network.end = 0 }, d => { d.paths[0].path = {} }, d => { d.badges.hidden = 'false' }, d => { d.splits = [{ name: 'x', path: 'x', bytes: 1.5 }] }]) {
    const d = data(); mutate(d); assert.throws(() => parseAppDetails(JSON.stringify(d), name, 0))
  }
  for (const invalid of ['a;id', 'a b', '-h', '', '../pkg', 'a\n']) assert.throws(() => validateAppTarget(invalid, 0))
  for (const id of [-1, 1.5, 100000, undefined]) assert.throws(() => validateAppTarget(name, id))
})

test('Tracker matches count distinct components, ignore unknown blocking and use App Manager substring matching', () => {
  const d = data(); d.components = [
    { name: 'com.google.android.gms.ads.AdActivity', type: 'Activity', enabled: true },
    { name: 'com.google.android.gms.ads.AdActivity', type: 'Activity', enabled: true },
    { name: 'org.example.com.google.android.gms.ads.AdActivity', type: 'Activity', enabled: true },
  ]
  collectTrackerBadges(d, database)
  assert.equal(d.badgeChecks.trackers.items.length, 2)
  assert.equal(d.badges.trackersBlocked, false)
  d.components.forEach(c => { c.enabled = false }); collectTrackerBadges(d, database)
  assert.equal(d.badges.trackersBlocked, true)
  d.components.forEach(c => { c.enabled = null }); collectTrackerBadges(d, database)
  assert.equal(d.badges.trackersBlocked, false)
  delete d.components; collectTrackerBadges(d, database)
  assert.equal(d.badgeChecks.trackers.present, null)
  assert.equal(sensorBadge(' idle\n').present, true)
  assert.equal(sensorBadge('active').present, false)
  assert.throws(() => sensorBadge('Permission denied'))
})

test('Badge evidence validates tri-state, item bounds and component types', () => {
  const d = data(); d.badgeChecks = { saf: { present: null, reason: 'Denied', items: [] } }; d.components = []
  assert.equal(parseAppDetails(JSON.stringify(d), name, 0).badgeChecks.saf.present, null)
  d.badgeChecks.saf.present = 'false'; assert.throws(() => parseAppDetails(JSON.stringify(d), name, 0))
  d.badgeChecks.saf.present = true; d.components = [{ name: 'x', type: 'Unknown', enabled: true }]
  assert.throws(() => parseAppDetails(JSON.stringify(d), name, 0))
})
const manifest = JSON.parse(await readFile('android-helper/dist/helper-manifest.json', 'utf8'))
test('Play signing evidence survives the helper protocol without deriving a result from the installer', () => {
  for (const present of [true, false, null]) {
    const d = data()
    d.badgeChecks = { playAppSigning: { present, reason: 'Manifest metadata only; not cryptographic verification.', items: [
      { name: 'com.android.stamp.type', value: 'STAMP_TYPE_DISTRIBUTION_APK' },
      { name: 'com.android.stamp.source', value: 'https://play.google.com/store' },
    ] } }
    assert.deepEqual(parseAppDetails(JSON.stringify(d), name, 0).badgeChecks.playAppSigning, d.badgeChecks.playAppSigning)
  }
  const d = data(); d.installers = [{ role: 'Installer of record', packageName: 'com.android.vending', label: 'Google Play' }]
  assert.equal(parseAppDetails(JSON.stringify(d), name, 0).badgeChecks?.playAppSigning, undefined)
})
const ok = stdout => ({ stdout, stderr: '', code: 0 })
function setup(helper) {
  let apps = { ...emptyApps(), deviceId: 'phone', userId: 0, status: 'ready', apps: [{ packageName: name }] }
  const connection = { activeDeviceId: 'phone', devices: [{ id: 'phone', serial: 'serial', status: 'connected' }] }
  const calls = [], states = []
  const reader = new AppDetailsReader(path.resolve('android-helper/dist'), () => 'adb', () => connection, () => apps, s => states.push(s), async (_, args, timeout, input, env, options) => {
    calls.push(args); assert.deepEqual(args.slice(0, 2), ['-s', 'serial'])
    if (args.some(a => a.includes('if [ -f'))) return ok(`${manifest.sha256} file`)
    if (args.some(a => a.includes('app_process'))) return helper ? helper(options, args) : ok(JSON.stringify(data()))
    throw new Error('Unexpected command')
  })
  return { reader, calls, states, connection, profile: userId => { apps = { ...apps, userId }; reader.clear() } }
}
test('Details coalesces reads, targets one package/profile and honours storage collection off', async () => {
  const f = setup(); await Promise.all([f.reader.read('phone', 0, name), f.reader.read('phone', 0, name)])
  assert.equal(f.calls.length, 2); assert.equal(f.states.at(-1).status, 'ready')
  assert.match(f.calls[1].join(' '), /--details org.example.app --permissions 0$/)
  assert.doesNotMatch(f.calls[1].join(' '), /--storage|--no-icons/)
  assert.throws(() => f.reader.read('phone', 10, name), /current connected profile/)
  assert.throws(() => f.reader.read('phone', 0, 'unknown'), /current connected profile/)
})
test('Details discards late profile replies and a failed read allows a fresh retry', async () => {
  let finish, started
  const ready = new Promise(resolve => { started = resolve })
  const f = setup(() => new Promise(resolve => { finish = resolve; started() }))
  const pending = f.reader.read('phone', 0, name); await ready
  f.profile(10); finish(ok(JSON.stringify(data()))); await pending
  assert.equal(f.states.at(-1), null); assert.ok(!f.states.some(s => s?.status === 'ready'))
  let fail = true
  const g = setup(() => { if (fail) throw new Error('Device refused'); return ok(JSON.stringify(data())) })
  await g.reader.read('phone', 0, name); assert.equal(g.states.at(-1).status, 'error')
  fail = false; await g.reader.read('phone', 0, name); assert.equal(g.states.at(-1).status, 'ready')
})

test('Deep scan cancellation on profile switch cannot publish late results; scan failure preserves About data', async () => {
  let release, scanning
  const started = new Promise(resolve => { scanning = resolve })
  const s = setup(async (options, args) => {
    if (!args.some(a => a.includes('--scan'))) return ok(JSON.stringify(data()))
    scanning()
    return new Promise(resolve => { release = () => resolve(ok('{}')) })
  })
  const pending = s.reader.read('phone', 0, name, true)
  await started
  assert.equal(s.states.at(-1).data.analysis.status, 'running')
  s.profile(10); release(); await pending
  assert.equal(s.states.at(-1), null)
  const failed = setup(async (_options, args) => {
    if (args.some(a => a.includes('--scan'))) throw new Error('Device disconnected during scan')
    return ok(JSON.stringify(data()))
  })
  await failed.reader.read('phone', 0, name, true)
  assert.equal(failed.states.at(-1).status, 'ready')
  assert.equal(failed.states.at(-1).data.analysis.status, 'error')
  assert.equal(failed.states.at(-1).data.packageName, name)
})
