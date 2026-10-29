import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { RootBadgeReader, parseRootChecks, keyStoreCheck, shellQuote } from '../dist-electron/root-badges.js'
import { ConnectionService } from '../dist-electron/connections.js'
import { Storage } from '../dist-electron/storage.js'

const ok = stdout => ({ stdout, stderr: '', code: 0 })
const target = () => ({ packageName: 'org.example.app', userId: 0, uid: 10234, badges: { hidden: null }, issues: [{ area: 'Hidden state', message: 'Denied' }], badgeChecks: { saf: { present: false, reason: 'Shell', items: [] } } })
const payload = d => ({ type: 'root-details', protocolVersion: 1, ...d, badgeChecks: { ssaid: { present: true, reason: 'Root', items: [{ name: 'SSAID', value: '1234567890abcdef' }] }, hidden: { present: false, reason: 'Root', items: [] }, saf: { present: true, reason: 'Root', items: [] }, systemless: { present: false, reason: 'Disabled modules excluded', items: [] } } })
test('root protocol rejects other profiles, changed UID and malformed evidence', () => {
  const d = target(), p = payload(d)
  assert.equal(parseRootChecks(JSON.stringify(p), d).ssaid.present, true)
  for (const patch of [{ uid: 10235 }, { userId: 10 }, { packageName: 'another.app' }, { badgeChecks: { ssaid: { present: 'yes' } } }]) assert.throws(() => parseRootChecks(JSON.stringify({ ...p, ...patch }), d))
  assert.equal(keyStoreCheck('Keys:').present, false)
  assert.equal(keyStoreCheck('Keys:\nalias 1\nalias 2').items.length, 2)
  assert.throws(() => keyStoreCheck('Permission denied'))
  assert.throws(() => keyStoreCheck('Keys:\nError: access denied'))
  assert.equal(shellQuote("a'b"), "'a'\\''b'")
})
test('root denial is cached, reset retries; ordinary Details remain intact', async () => {
  const reader = new RootBadgeReader(); let count = 0
  const denied = async () => { count++; return { code: 1, stdout: '', stderr: 'Permission denied' } }
  for (let i = 0; i < 2; i++) { const d = target(); await reader.collect(d, 'adb', 'phone', 'a'.repeat(64), denied, new AbortController().signal); assert.equal(d.packageName, 'org.example.app'); assert.equal(d.badgeChecks.ssaid.present, null); assert.equal(d.badgeChecks.saf.present, false) }
  assert.equal(count, 1)
  reader.reset(); await reader.collect(target(), 'adb', 'phone', 'a'.repeat(64), denied, new AbortController().signal); assert.equal(count, 2)
})
test('root collectors verify helper hash and identity, preserve successful shell checks', async () => {
  const d = target(), calls = []
  const reader = new RootBadgeReader()
  await reader.collect(d, 'adb', 'phone', 'a'.repeat(64), async (_, args) => {
    const cmd = args.at(-1); calls.push(cmd)
    if (cmd === "'id'") return ok('uid=0(root)')
    if (cmd.includes('app_process')) { assert.match(cmd, /sha256sum/); assert.match(cmd, /10234 0/); return ok(JSON.stringify(payload(d))) }
    if (cmd.includes('keystore_cli_v2')) return ok('Keys:\nexample_alias')
    if (cmd.includes('magisk -v')) return ok('30.7:MAGISK:R')
    if (cmd.includes('--denylist status')) return { ...ok(''), stderr: 'Denylist is enforced' }
    if (cmd.includes('--denylist ls')) return ok('org.example.app|org.example.app:worker\norg.other.app|other')
    throw new Error(cmd)
  }, new AbortController().signal)
  assert.equal(d.badgeChecks.ssaid.present, true); assert.equal(d.badgeChecks.keyStore.present, true)
  assert.equal(d.badgeChecks.magiskDenyList.items.length, 1)
  assert.equal(d.badgeChecks.saf.present, false); assert.equal(d.badgeChecks.hidden.present, false); assert.equal(d.issues.length, 0)
  assert.ok(calls.every(c => !/--denylist (add|rm|enable|disable)/.test(c)))
})

await mkdir('desktop-test-results', { recursive: true })
const directory = await mkdtemp(path.resolve('desktop-test-results/reconnect-'))
async function fixture(name) {
  const storage = new Storage(path.join(directory, name)); await storage.load()
  storage.data.known = [{ id: 'wifi:serial123', hardwareId: 'serial123', name: 'Test phone', serial: '192.168.1.2:11111', endpoint: '192.168.1.2:11111', method: 'Wi-Fi', status: 'disconnected', known: true, lastSeen: '', android: '13', canDetach: true }]
  const f = { live: '', mdns: 'adb-serial123-new _adb-tls-connect._tcp 192.168.1.2:22222', calls: [] }
  f.service = new ConnectionService(storage, () => 'adb', () => {}, async (_, args) => {
    f.calls.push(args)
    if (args[0] === 'devices') return ok(f.live)
    if (args[0] === 'host-features') return ok('')
    if (args[0] === 'mdns') return ok(f.mdns)
    if (args[0] === 'connect') { f.live = `${args[1]} device model:Test_phone`; return ok(`connected to ${args[1]}`) }
    if (args.includes('ro.serialno')) return ok('serial123')
    if (args.includes('ro.build.version.release')) return ok('13')
    throw new Error(args.join(' '))
  }); return f
}
test('discovery requires a live known identity, does not connect, and confirmation uses fresh address', async () => {
  const f = await fixture('fresh'); f.mdns += '\nadb-stranger _adb-tls-connect._tcp 192.168.1.2:11111'
  await f.service.findReconnect()
  assert.equal(f.service.state.discovery.candidates.length, 1)
  const c = f.service.state.discovery.candidates[0]; assert.equal(c.address, '192.168.1.2:22222')
  assert.ok(!f.calls.some(a => ['connect', 'disconnect'].includes(a[0])))
  await f.service.confirmReconnect(c.token)
  assert.equal(f.service.state.activeDeviceId, 'wifi:serial123')
  assert.ok(f.calls.some(a => a[0] === 'connect' && a[1].endsWith(':22222')))
  await assert.rejects(f.service.confirmReconnect(c.token), /expired/)
})
test('stale, expired and unknown candidates never connect', async () => {
  const f = await fixture('stale'); await f.service.findReconnect()
  const c = f.service.state.discovery.candidates[0]
  f.mdns = f.mdns.replace('22222', '33333')
  await assert.rejects(f.service.confirmReconnect(c.token), /changed or disappeared/)
  assert.ok(!f.calls.some(a => a[0] === 'connect'))
  await assert.rejects(f.service.confirmReconnect('invented'), /expired/)
  await f.service.findReconnect(); const expired = f.service.state.discovery.candidates[0]
  f.service.reconnectCandidates.get(expired.token).expiresAt = 0
  await assert.rejects(f.service.confirmReconnect(expired.token), /expired/)
  f.mdns = ''; await f.service.findReconnect(); assert.equal(f.service.state.discovery.candidates.length, 0)
})
test('choosing an already connected phone never disconnects or reconnects it', async () => {
  const f = await fixture('connected'); f.live = '192.168.1.2:22222 device model:Test_phone'
  await f.service.findReconnect()
  const c = f.service.state.discovery.candidates[0]; assert.equal(c.connected, true)
  await f.service.confirmReconnect(c.token)
  assert.equal(f.service.state.activeDeviceId, 'wifi:serial123')
  assert.ok(!f.calls.some(a => ['connect', 'disconnect'].includes(a[0])))
})
