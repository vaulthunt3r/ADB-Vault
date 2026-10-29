import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Storage } from '../dist-electron/storage.js'
import { runPackageAction, parsePackageResult } from '../dist-electron/package-actions.js'
import { validatePackageOptions, evidenceKey, validEvidence } from '../dist-electron/package-actions-protocol.js'
const app = { packageName: 'org.example.app', userId: 11, uid: 1110001, versionCode: 42 }
const context = { fingerprint: 'vendor/build:16/abc', sdk: 36, callerUid: 2000, cachePermission: 'granted' }
const manifest = JSON.parse(await readFile('android-helper/dist/helper-manifest.json', 'utf8'))
function fixture(settings = {}) {
  let state = { installed: true, enabled: true, uid: app.uid, versionCode: app.versionCode }, reads = 0
  const calls = [], observations = []
  const reply = (action, extra = {}) => JSON.stringify({ protocol: 1, action, packageName: app.packageName, userId: app.userId, context: { ...context, ...settings.context, ...(reads > 1 ? settings.afterContext : {}) }, state, outcome: 'confirmed', ...extra })
  const command = async args => { calls.push(args.join(' ')); assert.equal(args[0], 'shell'); return manifest.sha256 + ' file' }
  const shell = async script => {
    calls.push(script)
    if (script.includes("'inspect'")) {
      reads++
      if (reads > 1 && settings.readFailure) throw new Error('connection reset')
      return reply('inspect', { state: { ...state, ...(reads === 1 ? settings.before : settings.after) } })
    }
    if (script === "'pm' 'help'") { if (settings.helpError) throw new Error(settings.helpError); return settings.help ?? 'clear [--cache-only]' }
    const api = script.includes('helper.PackageActions')
    if (!api && settings.shellRejection) {
      if (settings.rejectionAsOutput) return settings.shellRejection
      throw new Error(settings.shellRejection)
    }
    const action = api ? script.match(/PackageActions '([^']+)'/)[1] : script.includes("'uninstall'") ? 'uninstall' : script.includes("'disable-user'") ? 'disable' : script.includes("'enable'") ? 'enable' : script.includes("'--cache-only'") ? 'clear-cache' : 'clear-data'
    if (!settings.noChange) { if (action === 'disable') state.enabled = false; if (action === 'enable') state.enabled = true; if (action === 'uninstall') state.installed = false }
    if (settings.error) throw new Error(settings.error)
    return api ? reply(action, settings.apiResult || {}) : settings.output ?? 'Success'
  }
  return { calls, observations, run: (action, options = {}) => runPackageAction(app, action, options, { directory: 'android-helper/dist', observe: (...args) => observations.push(args) }, command, shell) }
}
test('shell uninstall keeps data only when selected, uses the exact profile and reads back removal', async () => {
  for (const keepData of [false, true]) {
    const f = fixture(); assert.match(await f.run('uninstall', { keepData }), /verified/)
    const mutations = f.calls.filter(c => c.startsWith("'pm' 'uninstall'"))
    assert.equal(mutations.length, 1); assert.equal(mutations[0].includes("'-k'"), keepData)
    assert.ok(mutations[0].includes("'--user' '11'")); assert.equal(f.calls.filter(c => c.includes("'inspect'")).length, 2)
  }
})
test('API stays explicit, receives expected identity and never tries a shell mutation', async () => {
  const f = fixture(); await f.run('disable', { method: 'api' })
  assert.ok(f.calls.some(c => c.includes("PackageActions 'disable' 'org.example.app' '11' '1110001' '42' 'false'")))
  assert.equal(f.calls.some(c => c.startsWith("'pm'")), false)
})
test('missing cache permission prevents automatic and explicit methods from sending cleanup or falling back to data reset', async () => {
  for (const method of [undefined, 'shell', 'api']) {
    const f = fixture({ context: { cachePermission: 'denied' } })
    await assert.rejects(f.run('clear-cache', { method }), e => e.outcome === 'denied')
    assert.equal(f.calls.length, 2); assert.equal(f.observations[0][4], 'denied')
  }
})
test('unknown cache permission is not presented as an Android denial', async () => {
  const f = fixture({ context: { cachePermission: 'unknown' } })
  await assert.rejects(f.run('clear-cache'), e => e.outcome === 'failed')
})
test('shell cache flag must be advertised; API does not rely on pm help', async () => {
  const f = fixture({ help: 'clear [--user USER]' })
  await assert.rejects(f.run('clear-cache', { method: 'shell' }), /does not advertise/)
  assert.equal(f.calls.some(c => c.includes("'pm' 'clear'")), false)
  const api = fixture({ help: '' }); await api.run('clear-cache', { method: 'api' })
  assert.equal(api.calls.some(c => c.includes("'help'")), false)
})

test('automatic cache clearing uses API when pm lacks the cache-only flag, never pm clear-data', async () => {
  const f = fixture({ help: 'clear [--user USER]' })
  assert.match(await f.run('clear-cache'), /Cache cleared.*Android API/)
  assert.equal(f.calls.some(c => c.includes("'pm' 'clear'")), false)
  assert.equal(f.calls.filter(c => c.includes("PackageActions 'clear-cache'")).length, 1)
  assert.deepEqual(f.observations.map(o => [o[2].method, o[4]]), [['shell', 'failed'], ['api', 'confirmed']])
})

test('automatic fallback preserves action, profile and keep-data policy after a parser rejection', async () => {
  for (const action of ['enable', 'disable', 'uninstall', 'clear-data']) {
    for (const rejectionAsOutput of [false, true]) {
      const cmd = action === 'disable' ? 'disable-user' : action === 'clear-data' ? 'clear' : action
      const f = fixture({ shellRejection: `Unknown command: ${cmd}`, rejectionAsOutput })
      const options = action === 'uninstall' ? { keepData: true } : {}
      assert.match(await f.run(action, options), /Android API/)
      assert.ok(f.calls.some(c => c.includes(`PackageActions '${action}' 'org.example.app' '11' '1110001' '42' '${action === 'uninstall'}'`)))
      assert.equal(f.calls.some(c => c.includes('su ') || c.includes('--user\' \'0')), false)
      assert.deepEqual(f.observations.map(o => [o[2].method, o[4]]), [['shell', 'failed'], ['api', 'confirmed']])
    }
  }
})

test('a rejected option may select API; an unrelated option or mixed reply cannot', async () => {
  const f = fixture({ shellRejection: 'Error: Unknown option: --user' })
  await f.run('clear-data')
  assert.equal(f.calls.filter(c => c.includes("PackageActions 'clear-data'")).length, 1)
  for (const shellRejection of ['Error: Unknown option: --other', 'Unknown command: clear\nSuccess', 'Unknown command: clear\nerror: device offline']) {
    const rejected = fixture({ shellRejection })
    await assert.rejects(rejected.run('clear-data'))
    assert.equal(rejected.calls.some(c => c.includes("PackageActions 'clear-data'")), false)
  }
})

test('alternate operation is stopped if app, firmware, access or connection changes during preflight', async () => {
  for (const changed of [{ after: { versionCode: 43 } }, { after: { uid: 1110002 } }, { after: { installed: false } }, { after: { enabled: false } }, { afterContext: { fingerprint: 'new-build' } }, { afterContext: { callerUid: 0 } }, { readFailure: true }]) {
    const f = fixture({ shellRejection: 'Unknown command: uninstall', ...changed })
    await assert.rejects(f.run('uninstall'))
    assert.equal(f.calls.some(c => c.includes("PackageActions 'uninstall'")), false)
  }
})

test('unknown pm help result from a lost connection never starts the API operation', async () => {
  const f = fixture({ helpError: 'Connection reset' })
  await assert.rejects(f.run('clear-cache'))
  assert.equal(f.calls.some(c => c.includes("PackageActions 'clear-cache'")), false)
})

test('automatic API denial and missing callback end the operation without another mutation', async () => {
  for (const outcome of ['denied', 'uncertain', 'failed']) {
    const f = fixture({ help: 'clear [--user USER]', apiResult: { outcome, message: 'Android result' } })
    await assert.rejects(f.run('clear-cache'), e => e.outcome === outcome)
    assert.equal(f.calls.filter(c => c.includes("PackageActions 'clear-cache'")).length, 1)
    assert.equal(f.calls.some(c => c.includes("'pm' 'clear'")), false)
  }
})
test('timeout followed by verified desired state is success, with no second mutation', async () => {
  for (const action of ['disable', 'uninstall']) {
    const f = fixture({ error: 'Command timed out' }); assert.match(await f.run(action), /verified/)
    assert.equal(f.calls.filter(c => c.startsWith("'pm'")).length, 1)
    assert.equal(f.calls.some(c => c.includes(`PackageActions '${action}'`)), false)
  }
})
test('success text without actual state change is not accepted', async () => {
  const f = fixture({ noChange: true }); await assert.rejects(f.run('disable'), e => e.outcome === 'failed')
})
test('vendor denial is recorded for the operation and method, with no fallback', async () => {
  const f = fixture({ noChange: true, error: 'SecurityException: Cannot disable system packages.' })
  await assert.rejects(f.run('disable'), e => e.outcome === 'denied')
  assert.equal(f.calls.filter(c => c.startsWith("'pm'")).length, 1); assert.equal(f.observations[0][1], 'disable')
  assert.equal(f.calls.some(c => c.includes("PackageActions 'disable'")), false)
})
test('verification failure stays uncertain and is not a reusable denial', async () => {
  const f = fixture({ readFailure: true }); await assert.rejects(f.run('uninstall'), e => e.outcome === 'uncertain')
})
test('timeout with unchanged state stays uncertain: a service can finish later', async () => {
  const f = fixture({ noChange: true, error: 'Command timed out' }); await assert.rejects(f.run('disable'), e => e.outcome === 'uncertain')
})
test('cleanup timeout is uncertain: empty cache or data size is not proof', async () => {
  const f = fixture({ error: 'Command timed out' }); await assert.rejects(f.run('clear-data'), e => e.outcome === 'uncertain')
  assert.equal(f.calls.filter(c => c.includes("'inspect'")).length, 1)
})
test('API compatibility error never triggers an automatic alternate mutation', async () => {
  const f = fixture({ noChange: true, apiResult: { outcome: 'failed', message: 'NoSuchMethodException: clearApplicationUserData' } })
  await assert.rejects(f.run('clear-data', { method: 'api' }), e => e.outcome === 'failed')
  assert.equal(f.calls.some(c => c.startsWith("'pm'")), false)
})
test('changed app and unexpected access level stop before mutation', async () => {
  for (const settings of [{ before: { versionCode: 43 } }, { context: { callerUid: 0 } }]) {
    const f = fixture(settings); await assert.rejects(f.run('clear-data'))
    assert.equal(f.calls.length, 2)
  }
})
test('options reject invalid values and preservation on cleanup', () => {
  for (const options of [{ method: 'automatic' }, { root: 'true' }, { keepData: true }, { allUsers: true }]) assert.throws(() => validatePackageOptions(options, 'clear-data'))
  validatePackageOptions({ keepData: true, method: 'api', root: false }, 'uninstall')
})
test('evidence scope includes device, firmware, profile, app version, method, root and data policy', () => {
  const e = { device: 'one', fingerprint: 'buildA', userId: 0, packageName: app.packageName, versionCode: 42, action: 'disable', method: 'shell', root: false, keepData: false, outcome: 'denied', message: 'test', at: new Date().toISOString() }
  assert.ok(validEvidence(e)); assert.equal(validEvidence({ ...e, outcome: 'allowed' }), false)
  for (const [key, value] of Object.entries({ device: 'two', fingerprint: 'buildB', userId: 11, versionCode: 43, action: 'uninstall', method: 'api', root: true, keepData: true })) assert.notEqual(evidenceKey(e), evidenceKey({ ...e, [key]: value }))
})
test('helper output must match the expected app and profile', () => {
  assert.throws(() => parsePackageResult(JSON.stringify({ protocol: 1, action: 'inspect', packageName: app.packageName, userId: 0, context, outcome: 'confirmed' }), app, 'inspect'), /does not match/)
})
test('capability evidence survives restart, without accepting malformed saved records', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'adb-vault-action-evidence-'))
  const first = new Storage(directory); await first.load()
  const record = { device: 'one', fingerprint: 'buildA', userId: 0, packageName: app.packageName, versionCode: 42, action: 'disable', method: 'shell', root: false, keepData: false, outcome: 'denied', message: 'test', at: new Date().toISOString() }
  first.data.packageActionEvidence = [record, { ...record, root: 'yes' }]; await first.save()
  const second = new Storage(directory); await second.load()
  assert.deepEqual(second.data.packageActionEvidence, [record])
})
