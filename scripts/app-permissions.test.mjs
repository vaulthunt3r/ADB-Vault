import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { AppActionsService } from '../dist-electron/app-actions.js'
import { AppsService } from '../dist-electron/apps.js'
import { emptyApps } from '../dist-electron/apps-protocol.js'
import { permissionRestriction, parsePermissionSnapshot, validatePermissionChange } from '../dist-electron/app-permissions-protocol.js'

const manifest = JSON.parse(await readFile('android-helper/dist/helper-manifest.json', 'utf8'))
const target = { id: 'phone', userId: 11, packageName: 'org.example.notes', permission: 'android.permission.CAMERA', granted: true, expectedGranted: false }
const permission = () => ({ name: target.permission, granted: false, protectionLevel: 1, flags: 0, definitionFlags: 0, declaringPackage: 'android', label: 'Camera', description: null })
const data = () => ({ type: 'permissions', protocolVersion: 1, packageName: target.packageName, userId: 11, uid: 1110001, versionCode: 9, targetSdk: 35, sharedUidPackages: [target.packageName], requestedPermissions: [permission()] })
const ok = stdout => ({ stdout, stderr: '', code: 0 })
function fixture(options = {}) {
  const state = data()
  if (options.mutate) options.mutate(state)
  const app = { packageName: target.packageName, uid: 1110001, versionCode: 9, userId: 11, label: 'Notes', targetSdk: 35 }
  const apps = { ...emptyApps(), status: 'ready', deviceId: 'phone', userId: 11, apps: [app] }
  const connection = { activeDeviceId: 'phone', devices: [{ id: 'phone', status: 'connected', name: 'Phone', serial: 'SERIAL', transportId: '7', hardwareId: 'hardware' }] }
  const calls = [], patches = [], events = [], logs = []
  let reads = 0, refreshes = 0, writes = 0
  const runner = async (_, args, timeout, input, env, control) => {
    calls.push(args)
    assert.deepEqual(args.slice(0, 2), ['-t', '7'])
    assert.ok(control.signal)
    const cmd = args[3]
    if (cmd.startsWith('if [ -f ')) return ok(manifest.sha256 + ' file')
    if (cmd.includes('--permission-state')) {
      reads++
      await options.read?.({ state, connection, apps, reads, control })
      return ok(JSON.stringify(state))
    }
    assert.match(cmd, /^'pm' '(grant|revoke)' '--user' '11' 'org.example.notes' 'android.permission.CAMERA'$/)
    writes++
    if (options.write) return options.write(state, control)
    state.requestedPermissions[0].granted = cmd.includes("'grant'")
    return ok('')
  }
  const service = new AppActionsService(() => 'adb', () => connection, () => apps, s => events.push(s), (text, tone) => logs.push({ text, tone }), { confirm: async () => { throw new Error('Unexpected dialog') }, exportFolder: async () => null }, async () => { refreshes++ }, runner,
    { directory: path.resolve('android-helper/dist'), publish: (t, s) => patches.push({ target: t, state: s ? structuredClone(s) : null }) })
  return { service, calls, patches, events, logs, state, apps, connection, reads: () => reads, writes: () => writes, refreshes: () => refreshes }
}
test('grant and revoke are profile/transport scoped, verified and do not reread the app inventory', async () => {
  const f = fixture()
  await f.service.executePermission(target)
  assert.equal(f.service.state.status, 'success'); assert.equal(f.writes(), 1); assert.equal(f.reads(), 2); assert.equal(f.refreshes(), 0)
  assert.equal(f.patches.at(-1).state.requestedPermissions[0].granted, true)
  assert.ok(f.events.every(e => e.permission === target.permission && e.operationId === f.service.state.operationId))
  await f.service.executePermission({ ...target, granted: false, expectedGranted: true })
  assert.equal(f.service.state.status, 'success'); assert.equal(f.patches.at(-1).state.requestedPermissions[0].granted, false)
  assert.equal(f.logs.at(-1).tone, 'success')
  assert.ok(f.calls.every(a => !a.join(' ').includes('su -c') && !a.join(' ').includes('reset-permissions')))
})
for (const [name, mutate, pattern] of [
  ['normal permission', s => { s.requestedPermissions[0].protectionLevel = 0 }, /Managed by Android/],
  ['signature permission', s => { s.requestedPermissions[0].protectionLevel = 2 }, /Managed by Android/],
  ['system fixed', s => { s.requestedPermissions[0].flags = 0x10 }, /Fixed by Android/],
  ['policy fixed', s => { s.requestedPermissions[0].flags = 4 }, /administrator/],
  ['unknown restrictions', s => { s.requestedPermissions[0].flags = null }, /did not report/],
  ['hard restricted', s => { s.requestedPermissions[0].definitionFlags = 4 }, /allowlist/],
  ['old target SDK', s => { s.targetSdk = 22 }, /runtime permissions/],
  ['shared UID', s => { s.sharedUidPackages.push('org.example.other') }, /shares its UID/],
  ['not requested', s => { s.requestedPermissions = [] }, /does not request/],
  ['stale grant state', s => { s.requestedPermissions[0].granted = true }, /changed on the phone/],
  ['replaced package', s => { s.versionCode++ }, /application changed/],
]) test(`${name} is rejected by the backend before any mutation`, async () => {
  const f = fixture({ mutate }); await f.service.executePermission(target)
  assert.equal(f.writes(), 0); assert.equal(f.service.state.status, 'error'); assert.match(f.service.state.message, pattern)
})
test('transport replacement while checking permissions cancels the operation before mutation', async () => {
  const f = fixture({ read: ({ connection }) => { connection.devices[0].transportId = '8' } })
  await f.service.executePermission(target)
  assert.equal(f.service.state.status, 'error'); assert.equal(f.writes(), 0)
})
test('concurrent permission clicks are rejected while the first operation is running', async () => {
  let release, started
  const ready = new Promise(resolve => { started = resolve })
  const hold = new Promise(resolve => { release = resolve })
  const f = fixture({ read: async ({ reads }) => { if (reads === 1) { started(); await hold } } })
  const task = f.service.executePermission(target); await ready
  await assert.rejects(f.service.executePermission(target), /current application action/)
  release(); await task; assert.equal(f.writes(), 1)
})
test('Android rejection is shown, no root fallback or automatic retry occurs', async () => {
  const f = fixture({ write: () => ok('SecurityException: Permission denied by policy') })
  await f.service.executePermission(target)
  assert.equal(f.writes(), 1); assert.equal(f.service.state.status, 'error'); assert.match(f.service.state.message, /Permission denied/)
  assert.equal(f.patches.at(-1).state.requestedPermissions[0].granted, false)
  assert.match(f.patches.at(-1).state.requestedPermissions[0].changeRestriction, /Android denied permission management/)
})
test('a successful exit without an actual permission change is not reported as success', async () => {
  const f = fixture({ write: () => ok('') }); await f.service.executePermission(target)
  assert.equal(f.service.state.status, 'error'); assert.match(f.service.state.message, /did not apply/)
})
test('a lost reply is reconciled once; an unreadable result invalidates permissions rather than displaying stale state', async () => {
  const f = fixture({ write: () => { throw new Error('Command timed out') }, read: ({ reads }) => { if (reads > 1) throw new Error('offline') } })
  await f.service.executePermission(target)
  assert.equal(f.writes(), 1); assert.equal(f.service.state.status, 'error'); assert.equal(f.patches.at(-1).state, null)
  assert.match(f.service.state.message, /may already have been applied/)
})
test('malformed names, cross-profile replies and invalid flag types are rejected', () => {
  for (const patch of [{ permission: 'android.permission.CAMERA;reboot' }, { userId: -1 }, { granted: 'yes' }, { expectedGranted: true }]) assert.throws(() => validatePermissionChange({ ...target, ...patch }))
  const s = data(); s.userId = 0; assert.throws(() => parsePermissionSnapshot(JSON.stringify(s), target))
  s.userId = 11; s.requestedPermissions[0].flags = '0'; assert.throws(() => parsePermissionSnapshot(JSON.stringify(s), target))
  assert.equal(permissionRestriction({ ...permission(), definitionFlags: 4, flags: 0x800 }, 35), null)
})
test('publishing permissions preserves the app table and detail content, including other apps', () => {
  const f = fixture(), events = []
  const service = new AppsService('', () => null, () => f.connection, e => events.push(e), async () => { throw new Error('Unexpected ADB call') })
  const apps = f.apps.apps, fields = { test: 'retained' }
  service.state = { ...f.apps, details: { packageName: target.packageName, userId: 11, deviceId: 'phone', status: 'ready', data: { fields, requestedPermissions: [] } } }
  service.applyPermissions(target, data())
  assert.equal(service.state.apps, apps); assert.equal(service.state.status, 'ready'); assert.equal(service.state.details.data.fields, fields)
  assert.equal(service.state.details.data.requestedPermissions.length, 1)
  service.applyPermissions({ ...target, packageName: 'other' }, null)
  assert.equal(events.length, 1); assert.equal(service.state.details.data.requestedPermissions.length, 1)
})
