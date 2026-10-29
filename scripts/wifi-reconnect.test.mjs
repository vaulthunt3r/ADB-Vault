import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ConnectionService } from '../dist-electron/connections.js'
import { Storage } from '../dist-electron/storage.js'

const directory = await mkdtemp(path.join(tmpdir(), 'adb-vault-wifi-reconnect-'))
const oldAddress = '192.168.1.2:11111'
const newAddress = '192.168.1.2:22222'
const serial = 'adb-PHONE1-old._adb-tls-connect._tcp'
const ok = stdout => ({ stdout, stderr: '', code: 0 })
async function fixture(name) {
  const storage = new Storage(path.join(directory, name)); await storage.load()
  storage.data.known = [{ id: 'wifi:PHONE1', hardwareId: 'PHONE1', serial, endpoint: serial, name: 'Phone', android: '16', method: 'Wi-Fi', status: 'disconnected', known: true, canDetach: true, lastSeen: '', lastWirelessAddress: { address: oldAddress, hardwareId: 'PHONE1', verifiedAt: '2026-10-01T10:00:00.000Z' } }]
  const f = { storage, live: '', mdns: '', discoveryError: false, devicesError: false, actual: 'PHONE1', connectError: '', cleanupError: false, afterIdentity: null, calls: [], events: [] }
  f.runner = async (_, args) => {
    f.calls.push(args)
    if (args[0] === 'host-features') return ok('')
    if (args[0] === 'mdns') { if (f.discoveryError) throw new Error('Command timed out'); return ok(f.mdns) }
    if (args[0] === 'devices') { if (f.devicesError) throw new Error('devices timeout'); return ok(f.live) }
    if (args[0] === 'connect') {
      if (f.connectError) throw new Error(f.connectError)
      f.live += `\n${args[1]} device model:Phone transport_id:5`
      return ok(`connected to ${args[1]}`)
    }
    if (args[0] === 'disconnect') {
      if (f.cleanupError) throw new Error('disconnect timeout')
      f.live = f.live.split('\n').filter(line => !line.startsWith(args[1] + ' ')).join('\n')
      return ok(`disconnected ${args[1]}`)
    }
    if (args.includes('ro.serialno')) {
      if (f.afterIdentity) await f.afterIdentity()
      if (f.actual instanceof Error) throw f.actual
      return ok(f.actual)
    }
    if (args.includes('ro.build.version.release')) return ok('16')
    throw new Error('Unexpected command ' + args.join(' '))
  }
  f.service = new ConnectionService(storage, () => 'adb', event => f.events.push(event), f.runner)
  return f
}
const connections = f => f.calls.filter(args => args[0] === 'connect').map(args => args[1])

for (const unavailable of [false, true]) test(`saved address recovers when discovery ${unavailable ? 'times out' : 'is empty'}, after verification`, async () => {
  const f = await fixture('fallback-' + unavailable)
  f.discoveryError = unavailable
  await f.service.reconnect('wifi:PHONE1')
  assert.deepEqual(connections(f), [oldAddress])
  assert.ok(f.calls.some(args => args.join(' ') === '-t 5 shell getprop ro.serialno'))
  assert.match(f.service.state.message, /last confirmed address/)
  assert.equal(f.service.state.activeDeviceId, 'wifi:PHONE1')
  const reloaded = new Storage(f.storage.root); await reloaded.load()
  assert.equal(reloaded.data.known[0].lastWirelessAddress.address, oldAddress)
})

test('fresh discovery wins over saved endpoint and is remembered across restarts', async () => {
  const f = await fixture('fresh-address')
  f.mdns = `adb-PHONE1-new _adb-tls-connect._tcp ${newAddress}`
  await f.service.reconnect('wifi:PHONE1')
  assert.deepEqual(connections(f), [newAddress])
  const reloaded = new Storage(f.storage.root); await reloaded.load()
  assert.equal(reloaded.data.known[0].lastWirelessAddress.address, newAddress)
  f.live = ''; f.mdns = ''; f.calls.length = 0
  f.service = new ConnectionService(reloaded, () => 'adb', () => {}, f.runner)
  await f.service.reconnect('wifi:PHONE1')
  assert.deepEqual(connections(f), [newAddress])
})

test('verified mDNS-only scan saves the resolved address without repeated discovery polling', async () => {
  const f = await fixture('mdns-scan')
  delete f.service.state.devices[0].lastWirelessAddress
  f.live = `${serial} device transport_id:3`
  f.mdns = `adb-PHONE1-old _adb-tls-connect._tcp ${newAddress}`
  await f.service.scan()
  assert.equal(f.service.state.devices[0].lastWirelessAddress.address, newAddress)
  await f.service.scan()
  assert.equal(f.calls.filter(args => args[0] === 'mdns').length, 1)
  const reloaded = new Storage(f.storage.root); await reloaded.load()
  assert.equal(reloaded.data.known[0].lastWirelessAddress.address, newAddress)
})

test('no hardware identity, ambiguous discovery and malformed or foreign saved address never connect', async () => {
  for (const mode of ['no-identity', 'ambiguous', 'malformed', 'foreign']) {
    const f = await fixture(mode)
    const device = f.service.state.devices[0]
    if (mode === 'no-identity') delete device.hardwareId
    if (mode === 'ambiguous') f.mdns = `adb-PHONE1-first _adb-tls-connect._tcp ${newAddress}\nadb-PHONE1-second _adb-tls-connect._tcp ${oldAddress}`
    if (mode === 'malformed') device.lastWirelessAddress.address = '192.168.1.2:11111;calc'
    if (mode === 'foreign') device.lastWirelessAddress.hardwareId = 'OTHER'
    await assert.rejects(f.service.reconnect(device.id))
    assert.deepEqual(connections(f), [])
  }
})

test('a different phone on the saved IP is not selected and only the new connection is closed', async () => {
  const f = await fixture('wrong-phone')
  f.live = 'USB_OTHER device'
  f.actual = 'OTHER'
  // Simulate a timer tick during verification; it must not publish/select this connection.
  f.afterIdentity = () => f.service.scan()
  await assert.rejects(f.service.reconnect('wifi:PHONE1'), /different phone/)
  assert.deepEqual(f.calls.filter(args => args[0] === 'disconnect'), [['disconnect', oldAddress]])
  assert.equal(f.live.trim(), 'USB_OTHER device')
  assert.equal(f.service.state.activeDeviceId, null)
  assert.ok(!f.events.some(e => e.type === 'connection' && e.connection.activeDeviceId === 'wifi:OTHER'))
  assert.equal(f.storage.data.known[0].lastWirelessAddress.hardwareId, 'PHONE1')
})

test('verification timeout also rolls back only the newly created connection', async () => {
  const f = await fixture('identity-timeout'); f.actual = new Error('Command timed out')
  await assert.rejects(f.service.reconnect('wifi:PHONE1'), /Could not verify/)
  assert.deepEqual(f.calls.filter(args => args[0] === 'disconnect'), [['disconnect', oldAddress]])
})

test('failed rollback cannot automatically select the rejected phone on the next poll', async () => {
  const f = await fixture('rollback-timeout'); f.actual = 'OTHER'; f.cleanupError = true
  await assert.rejects(f.service.reconnect('wifi:PHONE1'), /will not be selected automatically/)
  await f.service.scan()
  assert.equal(f.service.state.activeDeviceId, null)
  assert.match(f.service.state.error, /different phone/)
})

test('an existing other phone at the endpoint is never disconnected', async () => {
  const f = await fixture('preexisting-other'); f.actual = 'OTHER'; f.live = `${oldAddress} device transport_id:9`
  await assert.rejects(f.service.reconnect('wifi:PHONE1'), /different phone/)
  assert.ok(!f.calls.some(args => ['connect', 'disconnect'].includes(args[0])))
})

test('transport replaced during verification cannot commit its address', async () => {
  const f = await fixture('replaced-transport')
  f.afterIdentity = () => { f.live = f.live.replace('transport_id:5', 'transport_id:6') }
  await assert.rejects(f.service.reconnect('wifi:PHONE1'), /changed during identity/)
  assert.equal(f.storage.data.known[0].lastWirelessAddress.verifiedAt, '2026-10-01T10:00:00.000Z')
})

test('fresh address failure gives network guidance without retrying an obsolete port', async () => {
  const f = await fixture('network-error')
  f.mdns = `adb-PHONE1-new _adb-tls-connect._tcp ${newAddress}`
  f.connectError = 'Command timed out'
  await assert.rejects(f.service.reconnect('wifi:PHONE1'), error => /192.168.1.2:22222/.test(error.message) && /VPN/.test(error.message) && /current connection port/.test(error.message))
  assert.deepEqual(connections(f), [newAddress])
  assert.ok(!f.calls.some(args => args[0] === 'disconnect'))
})

test('a failed initial list query does not disqualify an existing verified connection', async () => {
  const f = await fixture('list-error')
  f.live = `${oldAddress} device transport_id:8`
  await f.service.scan()
  assert.equal(f.service.state.activeDeviceId, 'wifi:PHONE1')
  f.devicesError = true
  await assert.rejects(f.service.reconnect('wifi:PHONE1'), /devices timeout/)
  f.devicesError = false
  await f.service.scan()
  assert.equal(f.service.state.activeDeviceId, 'wifi:PHONE1')
  assert.ok(!f.calls.some(args => ['connect', 'disconnect'].includes(args[0])))
})
