import test from 'node:test'
import assert from 'node:assert/strict'
import { ConnectionService } from '../dist-electron/connections.js'

function fixture(result = { stdout: '', stderr: '', code: 0 }) {
  const calls = [], events = []
  const service = new ConnectionService({ data: { known: [] } }, () => 'fake-adb.exe', e => events.push(e), async (_file, args) => {
    calls.push(args)
    return typeof result === 'function' ? result() : result
  })
  service.state.devices = [{ id: 'wifi:PHONE1', serial: '192.168.1.4:40000', transportId: '7', name: 'Phone one', status: 'connected', method: 'Wi-Fi' }, { id: 'USB2', serial: 'USB2', name: 'Phone two', status: 'connected', method: 'USB' }]
  return { service, calls, events, power: (mode, confirmed = true) => service.power('wifi:PHONE1', mode, confirmed, '192.168.1.4:40000', '7') }
}

test('power commands target the confirmed transport and only send one allowlisted command', async () => {
  for (const [mode, command] of [['restart', ['reboot']], ['recovery', ['reboot', 'recovery']], ['bootloader', ['reboot', 'bootloader']], ['fastboot', ['reboot', 'fastboot']], ['shutdown', ['shell', 'svc', 'power', 'shutdown']]]) {
    const { power, calls, events, service } = fixture()
    await power(mode)
    assert.deepEqual(calls, [['-t', '7', ...command]])
    assert.equal(service.state.busy, false)
    const log = events.find(e => e.type === 'activity')
    assert.equal(log.source, 'connection'); assert.equal(log.device, '192.168.1.4:40000')
    assert.match(log.text, /requested/); assert.equal(log.tone, 'info')
  }
  const { service, calls } = fixture()
  await service.power('USB2', 'restart', true, 'USB2')
  assert.deepEqual(calls, [['-s', 'USB2', 'reboot']])
})

test('missing confirmation, unsafe modes, changed transport and disconnected devices never send commands', async () => {
  const { service, calls, power } = fixture()
  await assert.rejects(power('shutdown', false), /Confirm/)
  await assert.rejects(power('reboot; wipe'), /Unsupported/)
  await assert.rejects(service.power('wifi:PHONE1', 'shutdown', true, '192.168.1.4:40000', '6'), /connection changed/)
  service.state.devices[0].status = 'offline'
  await assert.rejects(power('shutdown'), /Connect/)
  assert.equal(calls.length, 0)
})

test('permission failures including zero-exit svc errors remain failures and are never retried', async () => {
  for (const result of [{ stdout: '', stderr: 'SecurityException: Permission denied', code: 0 }, { stdout: 'usage: svc power', stderr: '', code: 0 }, { stdout: '', stderr: 'device offline', code: 1 }]) {
    const { power, calls, service, events } = fixture(result)
    await assert.rejects(power('shutdown'), /could not confirm/)
    assert.equal(calls.length, 1)
    assert.equal(service.state.busy, false); assert.equal(service.powerBusy, false)
    assert.equal(events.find(e => e.type === 'activity').tone, 'warning')
  }
})

test('duplicate power operations are blocked and timeout releases the lock without resending', async () => {
  let reject
  const { service, calls, power } = fixture(() => new Promise((_, fail) => { reject = fail }))
  const pending = power('shutdown')
  assert.equal(service.powerBusy, true); assert.equal(service.state.busy, true)
  await assert.rejects(power('restart'), /current connection/)
  reject(new Error('Command timed out.'))
  await assert.rejects(pending, /Check the phone before trying again/)
  assert.equal(calls.length, 1); assert.equal(service.powerBusy, false)
})
