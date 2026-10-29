import test from 'node:test'
import assert from 'node:assert/strict'
import { networkScanTargets, NetworkDiscovery, NETWORK_SHARES_DECLARATION, NETWORK_INTERFACES_SCRIPT } from '../dist-electron/file-network-discovery.js'
import { powershell } from '../dist-electron/process.js'

const windows = { skip: process.platform !== 'win32' }
const result = value => ({ code: 0, stdout: JSON.stringify(value), stderr: '' })

test('discovery confines scanning to nearby private IPv4 subnets and deduplicates adapters', () => {
  const scan = networkScanTargets([{ address: '192.168.12.5', prefixLength: 24 }, { address: '192.168.12.10', prefixLength: 24 }, { address: '10.1.2.3', prefixLength: 16, name: 'LAN' }, { address: '8.8.8.8', prefixLength: 24 }, { address: '127.0.0.1', prefixLength: 8 }, { address: '::1', prefixLength: 128 }, null])
  assert.deepEqual(scan.ranges, ['192.168.12.0/24', '10.1.2.0/24']); assert.equal(scan.addresses.length, 508)
  assert.ok(!scan.addresses.includes('192.168.12.0')); assert.ok(!scan.addresses.includes('192.168.12.255')); assert.equal(scan.warnings.length, 1)
  assert.deepEqual(networkScanTargets([{ address: '192.168.12.5', prefixLength: 30 }]).addresses, ['192.168.12.5', '192.168.12.6'])
  assert.equal(networkScanTargets(Array.from({ length: 8 }, (_, i) => ({ address: `10.1.${i}.1`, prefixLength: 24 }))).ranges.length, 4)
})

test('discovery lists usable share addresses and preserves per-server permission errors', windows, async () => {
  const calls = [], probed = []
  const service = new NetworkDiscovery(async (_exe, args, _timeout, _input, env) => {
    calls.push({ args, env })
    if (!env?.ADB_VAULT_SCAN_HOST) return result([{ address: '192.168.12.5', prefixLength: 30 }])
    return env.ADB_VAULT_SCAN_HOST.endsWith('.5') ? result({ code: 0, names: ['Public', 'Public', 'Фото', 'C$', 'IPC$', '../escape', 'nested/name'], message: '' }) : result({ code: 5, names: [], message: 'Access denied' })
  }, async address => { probed.push(address); return true }, async () => [])
  const scan = await service.scan('test')
  assert.equal(scan.checked, 2); assert.equal(scan.cancelled, false); assert.deepEqual(probed, ['192.168.12.5', '192.168.12.6'])
  assert.deepEqual(scan.hosts[0].shares, [{ name: 'Public', path: '\\\\192.168.12.5\\Public' }, { name: 'Фото', path: '\\\\192.168.12.5\\Фото' }])
  assert.match(scan.hosts[1].error, /denied/)
  const script = Buffer.from(calls[1].args.at(-1), 'base64').toString('utf16le')
  assert.ok(script.includes("Read('\\\\' + $env:ADB_VAULT_SCAN_HOST)")); assert.ok(!script.includes('192.168.12.5'))
})

test('scan cancellation is request-scoped, bounded, releases the service and retains discovered hosts', windows, async () => {
  let started
  const ready = new Promise(resolve => { started = resolve })
  const service = new NetworkDiscovery(async (_exe, _args, _timeout, _input, env, options) => {
    if (!env?.ADB_VAULT_SCAN_HOST) return result([{ address: '192.168.12.5', prefixLength: 32 }])
    started()
    return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }))
  }, async () => true, async () => [])
  const pending = service.scan('first'); await ready
  assert.throws(() => service.scan('second'), /current network search/)
  service.cancel('unrelated'); service.cancel('first')
  const scan = await pending
  assert.equal(scan.cancelled, true); assert.equal(scan.hosts.length, 1); assert.match(scan.hosts[0].error, /stopped/)
  const next = service.scan('again'); await service.shutdown(); assert.equal((await next).cancelled, true)
})

test('native share declarations compile on Windows without connecting to another computer', windows, async () => {
  const output = await powershell(NETWORK_SHARES_DECLARATION + "[VaultShareDiscovery].GetMethod('NetShareEnum').Name", undefined, 20000)
  assert.equal(output.trim(), 'NetShareEnum')
  const adapters = JSON.parse(await powershell(NETWORK_INTERFACES_SCRIPT, undefined, 15000))
  assert.ok(Array.isArray(adapters))
  for (const adapter of adapters) { assert.equal(typeof adapter.address, 'string'); assert.ok(Number.isInteger(adapter.prefixLength)) }
})


test('discovery preserves mapped Windows server names, drive letters and known folders when enumeration is denied', windows, async () => {
  const hosts = [], mappings = [{ path: '\\\\NAS\\Media', drive: 'K:', addresses: ['192.168.12.5'] }]
  const service = new NetworkDiscovery(async (_exe, _args, _timeout, _input, env) => {
    if (!env?.ADB_VAULT_SCAN_HOST) return result([{ address: '192.168.12.5', prefixLength: 32 }])
    hosts.push(env.ADB_VAULT_SCAN_HOST)
    return result({ code: 5, names: [], message: 'Denied' })
  }, async () => true, async () => mappings)
  const scan = await service.scan('mapped')
  assert.deepEqual(hosts, ['NAS'])
  assert.equal(scan.hosts.length, 1)
  assert.equal(scan.hosts[0].shares[0].path, '\\\\NAS\\Media'); assert.equal(scan.hosts[0].shares[0].drive, 'K:')
  assert.match(scan.hosts[0].error, /denied/)
})
