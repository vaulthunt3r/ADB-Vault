import test from 'node:test'
import assert from 'node:assert/strict'
import { probeDeviceRoot } from '../dist-electron/device-root.js'
import { ConnectionService } from '../dist-electron/connections.js'
const ok = stdout => ({ stdout, stderr: '', code: 0 })
const storage = () => ({ data: { known: [] }, save: async () => {} })

test('passive detection separates root ADB, visible su and no detected root without requesting access', async () => {
  for (const [uid, found, expected] of [['0', true, 'available'], ['2000', true, 'detected'], ['2000', false, 'not-detected']]) {
    const calls = []
    const result = await probeDeviceRoot(async command => {
      calls.push(command)
      if (command === 'id -u') return ok(uid)
      assert.ok(command.startsWith('if command -v su'))
      return ok(found ? 'ADB_VAULT_SU_FOUND' : 'ADB_VAULT_SU_MISSING')
    })
    assert.equal(result.status, expected)
    assert.ok(!calls.includes('su -c id'))
  }
})
test('access probe distinguishes granted, denied, timeout and unsupported errors', async () => {
  for (const [reply, expected] of [[ok('uid=0(root)'), 'available'], [{ code: 1, stdout: '', stderr: 'Permission denied' }, 'denied'], [ok('uid=2000(shell)'), 'denied'], [{ code: 1, stdout: '', stderr: 'unsupported invocation' }, 'error'], [new Error('Command timed out'), 'error']]) {
    const result = await probeDeviceRoot(async command => {
      if (command === 'id -u') return ok('2000')
      if (command.startsWith('if command')) return ok('ADB_VAULT_SU_FOUND')
      assert.equal(command, 'su -c id')
      if (reply instanceof Error) throw reply
      return reply
    }, true)
    assert.equal(result.status, expected)
    assert.equal(result.method, 'su', 'Access failures must retain evidence of root on the phone')
  }
  assert.equal((await probeDeviceRoot(async () => { throw new Error('offline') })).status, 'error')
  assert.equal((await probeDeviceRoot(async () => ok('unexpected'))).status, 'error')
})
test('connection retains root evidence through polling, invalidates replacement transports and does not persist it', async () => {
  let transport = 1; const calls = [], saved = storage()
  const service = new ConnectionService(saved, () => 'adb.exe', () => {}, async (_file, args) => {
    calls.push(args)
    if (args[0] === 'devices') return ok(`USB1 device model:Phone transport_id:${transport}`)
    if (args.at(-1) === 'id -u') return ok('2000')
    if (args.at(-1).startsWith('if command')) return ok('ADB_VAULT_SU_FOUND')
    if (args.at(-1) === 'su -c id') return ok('uid=0(root)')
    return ok('13')
  })
  await service.scan(); await service.checkRoot('USB1', true)
  assert.equal(service.state.devices[0].root.status, 'available')
  assert.deepEqual(calls.find(c => c.at(-1) === 'su -c id').slice(0, 4), ['-t', '1', 'shell', '-T'])
  await service.scan(); assert.equal(service.state.devices[0].root.status, 'available')
  assert.equal(calls.filter(c => c.at(-1) === 'su -c id').length, 1)
  transport = 2; await service.scan(); assert.equal(service.state.devices[0].root, undefined)
  assert.equal(saved.data.known[0].root, undefined)
})
test('disconnection during root probe discards late result, coalesces requests and allows retry', async () => {
  let live = true, release; let requests = 0
  const service = new ConnectionService(storage(), () => 'adb.exe', () => {}, async (_file, args) => {
    if (args[0] === 'devices') return ok(live ? 'USB1 device transport_id:1' : '')
    if (args.at(-1) === 'id -u') { requests++; return new Promise(resolve => { release = () => resolve(ok('0')) }) }
    return ok('13')
  })
  await service.scan()
  const a = service.checkRoot('USB1'), b = service.checkRoot('USB1')
  live = false; await service.scan(); release(); await Promise.all([a, b])
  assert.equal(requests, 1); assert.equal(service.state.devices[0].root, undefined)
  await assert.rejects(service.checkRoot('USB1'), /Connect and authorize/)
})
