import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { PhoneNetworkService, parseSocketTable, parsePackageUids, parseTrace, validateTraceAddress, validateNetworkTarget } from '../dist-electron/phone-network.js'
import { GeoIpService, ipScope } from '../dist-electron/geoip.js'

const header = 'sl local_address rem_address st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode'
const row = '0: 0201A8C0:C350 08080808:01BB 01 00000000:00000000 00:00000000 00000000 10123 0 12345'
const table = header + '\n' + row
const target = { id: 'phone', serial: 'serial', transportId: '7' }
const state = () => ({ activeDeviceId: 'phone', devices: [{ ...target, status: 'connected' }] })
const ok = stdout => ({ stdout, stderr: '', code: 0 })
const geo = { record: { status: 'Not installed' }, lookup: ip => ({ scope: ipScope(ip) }) }

test('socket parser decodes IPv4 and IPv6 words, ports, state and profile UID', () => {
  const s = parseSocketTable(table, 'TCP', 4)[0]
  assert.equal(s.localAddress, '192.168.1.2'); assert.equal(s.remoteAddress, '8.8.8.8')
  assert.equal(s.localPort, 50000); assert.equal(s.remotePort, 443); assert.equal(s.uid, 10123); assert.equal(s.state, 'Established')
  const v6 = parseSocketTable(table.replace('0201A8C0:C350', '00000000000000000000000001000000:C350').replace('08080808:01BB', '0000000000000000FFFF000008080808:01BB').replace('10123', '1010123'), 'TCP', 6)[0]
  assert.equal(v6.localAddress, '::1'); assert.equal(v6.remoteAddress, '::ffff:808:808'); assert.equal(v6.userId, 10)
})
test('unreadable and incomplete tables are not treated as an empty successful reading', () => {
  assert.throws(() => parseSocketTable('Permission denied', 'TCP', 4), /unavailable/)
  assert.throws(() => parseSocketTable(header + '\n0: truncated', 'TCP', 4), /Incomplete/)
  assert.deepEqual(parseSocketTable(header, 'TCP', 4), [])
  assert.equal(parseSocketTable(table.replace(' 01 ', ' 07 '), 'UDP', 4)[0].state, 'Unconnected')
})
test('shared UIDs preserve all package candidates and Android profile', () => {
  const uids = parsePackageUids('package:com.one uid:10123\npackage:com.two uid:10123\npackage:com.work uid:1010123\nError: restricted profile')
  assert.deepEqual(uids.get(10123), ['com.one', 'com.two']); assert.deepEqual(uids.get(1010123), ['com.work']); assert.equal(uids.size, 2)
})
test('Android --user all comma-separated UIDs identify packages in every profile', () => {
  const uids = parsePackageUids('package:com.xiaomi.xmsf uid:10202,1110202\r\npackage:com.miui.powerkeeper uid:1000,1101000\r\npackage:com.android.keychain uid:1000,1101000\r\npackage:com.xiaomi.xmsf uid:10202\r\npackage:com.invalid uid:10145,broken\r\npackage:com.invalid uid:9999999999999999999')
  assert.deepEqual(uids.get(10202), ['com.xiaomi.xmsf'])
  assert.deepEqual(uids.get(1110202), ['com.xiaomi.xmsf'])
  assert.deepEqual(uids.get(1000), ['com.miui.powerkeeper', 'com.android.keychain'])
  assert.deepEqual(uids.get(1101000), ['com.miui.powerkeeper', 'com.android.keychain'])
  assert.equal(uids.size, 4)
})
test('collector attributes a second-profile socket from a multi-profile package row', async () => {
  const service = new PhoneNetworkService(() => 'adb.exe', state, geo, async (_exe, args) => {
    const command = args.at(-1)
    if (command.includes('packages')) return ok('package:com.xiaomi.xmsf uid:10202,1110202')
    return ok(command.endsWith('/tcp') ? table.replace('10123', '1110202') : header)
  })
  const result = await service.connections(target, 'second-profile')
  assert.equal(result.sockets[0].userId, 11)
  assert.deepEqual(result.sockets[0].packages, ['com.xiaomi.xmsf'])
  assert.deepEqual(result.issues, [])
})
test('trace accepts only literal addresses and rejects shell syntax and ambiguous zones', () => {
  for (const address of ['8.8.8.8; reboot', 'example.org', '-h', 'fe80::1%wlan0', '0.0.0.0', '::', '127.0.0.1\nreboot']) assert.throws(() => validateTraceAddress(address))
  validateTraceAddress('8.8.8.8'); validateTraceAddress('2001:4860:4860::8888')
  assert.throws(() => validateNetworkTarget({ ...target, transportId: '7;id' }))
})
test('local, mapped and special-use addresses are never given public geolocation', () => {
  for (const address of ['192.168.1.1', '127.0.0.1', '10.0.0.1', '100.64.0.1', '169.254.1.1', '::1', '::ffff:192.168.1.1', 'fe80::1', 'fc00::1', '224.0.0.1', '2001:db8::1']) assert.notEqual(ipScope(address), 'Public / other', address)
  assert.equal(ipScope('8.8.8.8'), 'Public / other')
  assert.equal(ipScope('2001:4860:4860::8888'), 'Public / other')
})
test('collector pins every command to the phone, caches UID mapping and reports partial denial', async () => {
  const calls = [], service = new PhoneNetworkService(() => 'adb.exe', state, geo, async (exe, args) => {
    calls.push([exe, args]); const command = args.at(-1)
    if (command.includes('packages')) return ok('package:com.one uid:10123\npackage:com.two uid:10123')
    if (command.endsWith('/tcp')) return ok(table)
    if (command.endsWith('/tcp6')) return { code: 1, stdout: '', stderr: 'Permission denied' }
    return ok(header)
  })
  const result = await service.connections(target, 'first')
  assert.equal(result.sockets.length, 1); assert.deepEqual(result.sockets[0].packages, ['com.one', 'com.two'])
  assert.match(result.issues[0], /Permission denied/)
  await service.connections(target, 'second')
  assert.equal(calls.filter(c => c[1].at(-1).includes('packages')).length, 1)
  assert.ok(calls.every(([exe, args]) => exe === 'adb.exe' && args[0] === '-t' && args[1] === '7' && args[2] === 'shell'))
})
test('all denied tables remain unavailable and do not issue package reads', async () => {
  let calls = 0
  const service = new PhoneNetworkService(() => 'adb.exe', state, geo, async () => { calls++; return { code: 1, stdout: '', stderr: 'Permission denied' } })
  const result = await service.connections(target, 'denied')
  assert.equal(result.sockets.length, 0); assert.equal(result.issues.length, 4); assert.equal(calls, 4)
})
test('transport changes discard reading and stop remaining commands', async () => {
  const connection = state(); let calls = 0
  const service = new PhoneNetworkService(() => 'adb.exe', () => connection, geo, async () => { calls++; connection.devices[0].transportId = '8'; return ok(table) })
  await assert.rejects(service.connections(target, 'changed'), /connection changed/); assert.equal(calls, 1)
})
test('cancellation waits for the pinned operation and overlapping reads are rejected', async () => {
  const service = new PhoneNetworkService(() => 'adb.exe', state, geo, async (_exe, _args, _timeout, _input, _env, options) => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })))
  const pending = service.connections(target, 'cancel-me'); const rejected = assert.rejects(pending, /cancelled/)
  await assert.rejects(service.connections(target, 'overlap'), /still running/)
  await service.cancel('unrelated'); assert.equal(service.busy, true)
  await service.cancel('cancel-me'); await rejected; assert.equal(service.busy, false)
})
test('phone trace uses bounded numeric probes and never invokes PC traceroute', async () => {
  const calls = [], service = new PhoneNetworkService(() => 'adb.exe', state, geo, async (exe, args, timeout) => {
    calls.push({ exe, args, timeout }); return ok('traceroute to 8.8.8.8\n 1 192.168.1.1 1.2 ms\n 2 *\n 3 8.8.8.8 12.5 ms')
  })
  const result = await service.trace(target, 'trace', '8.8.8.8')
  assert.equal(result.status, 'complete'); assert.equal(result.hops[1].address, null)
  assert.equal(calls.length, 1); assert.equal(calls[0].exe, 'adb.exe')
  assert.deepEqual(calls[0].args, ['-t', '7', 'shell', 'traceroute -n -m 16 -q 1 -w 1 8.8.8.8'])
  assert.equal(calls[0].timeout, 25000)
})
test('missing phone traceroute tries the Android toybox applet, never a PC utility', async () => {
  let calls = 0
  const service = new PhoneNetworkService(() => 'adb.exe', state, geo, async () => { calls++; return { code: 127, stdout: '', stderr: '/system/bin/sh: traceroute: not found' } })
  const result = await service.trace(target, 'missing', '8.8.8.8')
  assert.equal(result.status, 'unavailable'); assert.match(result.output, /not found/); assert.equal(calls, 2)
})
test('toybox without a traceroute symlink is supported; denied raw socket access is explained', async () => {
  const calls = [], service = new PhoneNetworkService(() => 'adb.exe', state, geo, async (exe, args) => {
    calls.push({ exe, args }); return calls.length === 1 ? { code: 127, stdout: '', stderr: 'traceroute: inaccessible or not found' } : { code: 1, stdout: '', stderr: 'traceroute: socket 3 1: Operation not permitted' }
  })
  const result = await service.trace(target, 'toybox', '192.168.1.1')
  assert.equal(result.status, 'unavailable'); assert.match(result.message, /Android blocked the diagnostic command/)
  assert.ok(calls.every(c => c.exe === 'adb.exe' && c.args.slice(0, 3).join(' ') === '-t 7 shell'))
  assert.match(calls[1].args.at(-1), /^toybox traceroute -n /)
})
test('timeout retains partial phone hops; IPv6 addresses are parsed', async () => {
  const service = new PhoneNetworkService(() => 'adb.exe', state, geo, async (_exe, args) => { assert.match(args.at(-1), /^traceroute -6 /); throw Object.assign(new Error('Command timed out'), { commandResult: { stdout: '1 2001:db8::1 2 ms\n2 *' } }) })
  const result = await service.trace(target, 'timeout', '2001:4860:4860::8888')
  assert.equal(result.status, 'partial'); assert.equal(result.hops[0].address, '2001:db8::1'); assert.match(result.output, /timed out/)
  assert.equal(parseTrace('16 *\n17 8.8.8.8 3 ms').length, 1)
})
test('invalid MMDB cannot replace the saved configuration, and missing setup is optional', async () => {
  await mkdir('desktop-test-results', { recursive: true })
  const root = await mkdtemp(path.resolve('desktop-test-results/geoip-')), folder = path.join(root, 'db')
  await mkdir(folder); await writeFile(path.join(folder, 'bad.mmdb'), 'not a database')
  const service = new GeoIpService(root); await service.initialize()
  assert.equal(service.record.status, 'Not installed')
  await assert.rejects(service.locate(folder)); await assert.rejects(readFile(path.join(root, 'geoip.json')))
  assert.deepEqual(service.lookup('10.0.0.1'), { scope: 'Private network' })
})
