import test from 'node:test'
import assert from 'node:assert/strict'
import { launchApplication } from '../dist-electron/app-launch.js'

const pkg = 'com.android.contacts'
function runner(query, started = 'Status: ok') {
  const calls = []
  return { calls, shell: async args => {
    calls.push(args)
    return args[0] === 'am' ? started : query(args)
  } }
}

test('launch selects an actual package entry when Android would resolve to a chooser', async () => {
  const f = runner(args => args.includes('android.intent.category.LAUNCHER') ? `${pkg}/.activities.PeopleActivity\n${pkg}/.activities.TwelveKeyDialer` : 'No activities found')
  assert.equal(await launchApplication(pkg, 11, f.shell), pkg + '/.activities.PeopleActivity')
  assert.ok(f.calls.every(args => args[args.indexOf('--user') + 1] === '11'))
  assert.equal(f.calls.at(-1).at(-1), pkg + '/.activities.PeopleActivity')
  assert.ok(f.calls.at(-1).includes('0x10200000'))
  assert.equal(f.calls.some(args => args.includes('resolve-activity')), false)
})

for (const category of ['INFO', 'LEANBACK_LAUNCHER']) test(`launch supports ${category} entries`, async () => {
  const f = runner(args => args.includes(`android.intent.category.${category}`) ? pkg + '/.Main' : 'No activities found')
  assert.equal(await launchApplication(pkg, 0, f.shell), pkg + '/.Main')
  assert.ok(f.calls.at(-1).includes(`android.intent.category.${category}`))
})

test('foreign chooser components and packages without entry screens never start', async () => {
  for (const output of ['No activities found', 'com.android.intentresolver/.ResolverActivity', `${pkg}.other/.Main`, `${pkg}/.Main;reboot`]) {
    const f = runner(() => output)
    await assert.rejects(launchApplication(pkg, 11, f.shell), /No launchable screen.*profile 11/)
    assert.equal(f.calls.some(args => args[0] === 'am'), false)
  }
})

test('system modules without a launcher open their declared MAIN/DEFAULT screen', async () => {
  const f = runner(args => args.includes('android.intent.action.MAIN') && args.includes('android.intent.category.DEFAULT') ? pkg + '/.Main' : 'No activities found')
  assert.equal(await launchApplication(pkg, 0, f.shell), pkg + '/.Main')
  assert.ok(f.calls.at(-1).includes('android.intent.action.MAIN'))
  assert.ok(f.calls.at(-1).includes('android.intent.category.DEFAULT'))
})

test('an available application preferences entry is supported without substituting another package', async () => {
  const f = runner(args => args.includes('android.intent.action.APPLICATION_PREFERENCES') ? pkg + '/.Preferences' : 'No activities found')
  assert.equal(await launchApplication(pkg, 11, f.shell), pkg + '/.Preferences')
  assert.ok(f.calls.at(-1).includes('android.intent.action.APPLICATION_PREFERENCES'))
})

test('ambiguous auxiliary screens never start an arbitrary settings, account or diagnostic page', async () => {
  const f = runner(args => args.includes('android.intent.category.DEFAULT') ? `${pkg}/.Settings\n${pkg}/.Diagnostic` : 'No activities found')
  await assert.rejects(launchApplication(pkg, 0, f.shell), /several auxiliary screens.*no single launch entry/)
  assert.equal(f.calls.some(args => args[0] === 'am'), false)
})

test('duplicate intent-filter results count as one entry and a disabled service screen stays unavailable', async () => {
  const f = runner(args => args.includes('android.intent.category.DEFAULT') ? `${pkg}/.Main\n${pkg}/.Main` : 'No activities found')
  assert.equal(await launchApplication(pkg, 0, f.shell), pkg + '/.Main')
  const missing = runner(() => 'No activities found')
  await assert.rejects(launchApplication('com.xiaomi.mi_connect_service', 11, missing.shell), /Service packages.*Open app settings/)
  assert.equal(missing.calls.some(args => args.includes('am')), false)
})

test('older Android falls back to resolve only for unsupported query commands', async () => {
  const f = runner(args => args.includes('query-activities') ? 'Unknown command: query-activities' : pkg + '/.Main')
  assert.equal(await launchApplication(pkg, 0, f.shell), pkg + '/.Main')
  assert.equal(f.calls[1][2], 'resolve-activity')
  const denied = runner(() => { throw new Error('SecurityException: permission denied') })
  await assert.rejects(launchApplication(pkg, 0, denied.shell), /permission denied/)
  assert.equal(denied.calls.length, 1)
})

test('missing launch status, timeout or Android failure cannot produce a false success', async () => {
  for (const output of ['', 'Starting: Intent', 'Status: timeout', 'Error: Activity not started']) {
    const f = runner(() => pkg + '/.Main', output)
    await assert.rejects(launchApplication(pkg, 11, f.shell), /did not confirm.*profile 11/)
  }
})
