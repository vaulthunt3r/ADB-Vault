import test from 'node:test'
import assert from 'node:assert/strict'
import { ConnectionService } from '../dist-electron/connections.js'

const ok = stdout => ({ stdout, stderr: '', code: 0 })
const storage = () => ({ data: { known: [] }, save: async () => {} })
const tick = () => new Promise(resolve => setImmediate(resolve))
const properties = model => `[ro.product.model]: [${model}]\n[ro.build.version.release]: [16]`

test('stable verified Wi-Fi aliases do not add property reads to subsequent polls', async () => {
  const calls = [], service = new ConnectionService(storage(), () => 'adb.exe', () => {}, async (_file, args) => {
    calls.push(args)
    if (args[0] === 'devices') return ok('192.168.1.2:4000 device model:Phone transport_id:2\nadb-phone._adb-tls-connect._tcp device model:Phone transport_id:3')
    return ok(args.includes('ro.serialno') ? 'PHONE1' : args.includes('ro.build.version.release') ? '16' : '')
  })
  await service.scan(); const first = calls.filter(a => a.includes('getprop')).length
  await service.scan(); await service.scan()
  assert.equal(calls.filter(a => a.includes('getprop')).length, first)
  assert.equal(service.state.devices.length, 1)
})

for (const failed of [false, true]) test(`firmware ${failed ? 'failure' : 'result'} from an old connected transport cannot populate its replacement`, async () => {
  let transport = '2', release
  const calls = [], service = new ConnectionService(storage(), () => 'adb.exe', () => {}, async (_file, args) => {
    calls.push(args)
    if (args[0] === 'devices') return ok(`USB1 device model:Phone transport_id:${transport}`)
    if (args.at(-1) === 'getprop') return new Promise(resolve => { release = () => resolve(failed ? { stdout: '', stderr: 'Old transport failed', code: 1 } : ok(properties('Old phone'))) })
    return ok(args.includes('ro.build.version.release') ? '16' : '')
  })
  await service.scan()
  const reading = service.inspect('USB1'); await tick()
  try {
    await service.scan()
    assert.equal(service.state.devices[0].info.status, 'loading', 'ordinary polls retain the in-flight read')
    transport = '3'; await service.scan()
    assert.equal(service.state.devices[0].info, undefined, 'new transport needs fresh firmware data')
    assert.deepEqual(calls.find(a => a.at(-1) === 'getprop').slice(0, 2), ['-t', '2'])
  } finally { release(); await reading }
  assert.equal(service.state.devices[0].info, undefined)
})

test('firmware reads requested during reconnection wait for the old read and inspect the new transport once', async () => {
  let transport = '2', release
  const reads = [], service = new ConnectionService(storage(), () => 'adb.exe', () => {}, async (_file, args) => {
    if (args[0] === 'devices') return ok(`USB1 device model:Phone transport_id:${transport}`)
    if (args.at(-1) === 'getprop') {
      reads.push(args)
      if (reads.length === 1) return new Promise(resolve => { release = () => resolve(ok(properties('Old phone'))) })
      return ok(properties('Current phone'))
    }
    return ok('16')
  })
  await service.scan()
  const old = service.inspect('USB1'); await tick()
  transport = '3'; await service.scan()
  const next = service.inspect('USB1'), duplicate = service.inspect('USB1')
  release(); await Promise.all([old, next, duplicate])
  assert.equal(reads.length, 2)
  assert.deepEqual(reads[1].slice(0, 2), ['-t', '3'])
  assert.equal(service.state.devices[0].info.fields.model, 'Current phone')
})

for (const action of ['cancel', 'stop']) test(`QR ${action} invalidates a pending creation and clears the published payload`, async () => {
  let release, hold = false
  const service = new ConnectionService(storage(), () => 'adb.exe', () => {}, async () => hold ? new Promise(resolve => { release = () => resolve(ok('')) }) : ok(''))
  await service.newQr()
  hold = true
  const creating = service.newQr()
  if (action === 'cancel') service.cancelQr(); else service.stop()
  release(); await creating
  assert.equal(service.state.qr, null)
  assert.equal(service.qrSecret, null)
})

test('a slower QR creation cannot replace a newer QR session', async () => {
  let release, calls = 0
  const service = new ConnectionService(storage(), () => 'adb.exe', () => {}, async () => ++calls === 1 ? new Promise(resolve => { release = () => resolve(ok('')) }) : ok(''))
  const old = service.newQr()
  await service.newQr()
  const payload = service.state.qr.payload
  release(); await old
  assert.equal(service.state.qr.payload, payload)
})

test('QR expiry during discovery never submits a pairing secret', async () => {
  let release, pairCalls = 0, discoveries = 0
  const service = new ConnectionService(storage(), () => 'adb.exe', () => {}, async (_file, args) => {
    if (args[0] === 'pair') { pairCalls++; return ok('Successfully paired') }
    if (args[0] === 'mdns' && args[1] === 'services' && ++discoveries === 1) return new Promise(resolve => { release = () => resolve(ok(`${service.qrSecret.service} _adb-tls-pairing._tcp 192.168.1.2:36000`)) })
    return ok('')
  })
  await service.newQr()
  const checking = service.checkQr()
  service.qrSecret.expires = Date.now() - 1
  release(); await checking
  assert.equal(pairCalls, 0)
  assert.equal(service.state.qr.status, 'expired')
  assert.equal(service.state.qr.payload, '')
})
