import test from 'node:test'
import assert from 'node:assert/strict'
import { FastbootService, parseFastbootDevices, fastbootVariable } from '../dist-electron/fastboot.js'
import { validateFastbootTarget } from '../dist-electron/fastboot-protocol.js'

const ok = (stdout = '', stderr = '') => ({ stdout, stderr, code: 0 })
function fixture() {
  const calls = [], events = []
  let devices = 'PHONE1 fastboot usb:1-2\nPHONE2 fastboot usb:1-3'
  let execute = async args => args[0] === 'devices' ? ok(devices) : args.includes('getvar') ? ok('', `(bootloader) ${args.at(-1)}: ${args.at(-1) === 'product' ? 'Test phone' : 'yes'}\nFinished. Total time: 0.001s`) : ok('', 'Rebooting OKAY\nFinished.')
  const service = new FastbootService(() => 'C:/tools/fastboot.exe', event => events.push(event), (file, args, timeout, input, env, options) => {
    calls.push({ file, args, timeout, options }); return execute(args, options)
  })
  return { service, calls, events, devices: value => { devices = value }, execute: value => { execute = value }, target: () => service.state.devices[0] }
}

test('parses only identifiable Fastboot devices and both getvar output streams', () => {
  assert.deepEqual(parseFastbootDevices('List of devices\nABC fastboot usb:1-2\nXYZ\tfastboot\n???? fastboot\nX device\n--bad fastboot'), [{ serial: 'ABC', usbPath: '1-2' }, { serial: 'XYZ', usbPath: '' }])
  for (const result of [ok('product: phone'), ok('', '(bootloader) product: phone\nFinished.')]) assert.equal(fastbootVariable(result, 'product'), 'phone')
  assert.throws(() => fastbootVariable(ok('', 'FAILED (remote: unknown variable)'), 'product'), /FAILED/)
  assert.throws(() => fastbootVariable(ok('some-other-product: phone'), 'product'), /Not reported/)
  assert.deepEqual(parseFastbootDevices('PHONE fastbootd \\?\\usb#device'), [{ serial: 'PHONE', usbPath: '\\?\\usb#device' }])
  for (const serial of ['--all', 'x;reboot', '', 'tcp:host', 'x\n']) assert.throws(() => validateFastbootTarget(serial, 'token'))
})

test('on-demand scan does not run ADB or getvar; duplicate serials are not selectable', async () => {
  const f = fixture()
  assert.equal(f.calls.length, 0)
  await f.service.scan()
  assert.equal(f.service.state.devices.length, 2)
  assert.deepEqual(f.calls.map(c => c.args), [['devices', '-l']])
  f.devices('PHONE1 fastboot usb:1-2\nPHONE1 fastboot usb:1-3')
  await f.service.scan()
  assert.equal(f.service.state.devices.length, 0)
  assert.match(f.service.state.message, /Duplicate/)
})

test('read information retains supported fields and labels unsupported ones', async () => {
  const f = fixture(); await f.service.scan()
  const d = f.target()
  f.execute(async args => args[0] === 'devices' ? ok('PHONE1 fastboot usb:1-2') : args.at(-1) === 'product' ? ok('', 'product: Test phone') : { stdout: '', stderr: 'FAILED (remote: unknown variable)', code: 1 })
  await f.service.inspect(d.serial, d.token)
  assert.equal(d.fields.product, 'Test phone'); assert.equal(d.issues.length, 7)
  assert.ok(d.inspectedAt); assert.equal(f.service.state.busy, false)
  assert.ok(f.calls.slice(2).every(c => c.args[0] === '-s' && c.args[1] === 'PHONE1' && c.args[2] === 'getvar'))
})

test('each reboot mode targets exactly the confirmed serial and never reports completion of boot', async () => {
  for (const mode of ['android', 'recovery', 'bootloader', 'fastboot']) {
    const f = fixture(); await f.service.scan(); const d = f.target()
    await f.service.reboot(d.serial, d.token, mode, true)
    assert.deepEqual(f.calls.at(-1).args, ['-s', 'PHONE1', 'reboot', ...(mode === 'android' ? [] : [mode])])
    assert.equal(f.service.state.devices.some(d => d.serial === 'PHONE1'), false)
    assert.equal(f.service.state.devices.some(d => d.serial === 'PHONE2'), true)
    assert.match(f.service.state.message, /requested/)
    assert.equal(f.events.at(-2).source, 'connection')
  }
})

test('missing confirmation and disallowed commands never reach the runner', async () => {
  const f = fixture(); await f.service.scan(); const d = f.target(); f.calls.length = 0
  await assert.rejects(f.service.reboot(d.serial, d.token, 'android', false), /Confirm/)
  for (const mode of ['flash', 'flashing unlock', 'erase', 'set_active', 'boot', 'reboot;wipe']) await assert.rejects(f.service.reboot(d.serial, d.token, mode, true), /Unsupported/)
  assert.equal(f.calls.length, 0)
})

test('stale selection, missing device and changed USB path cannot send a reboot', async () => {
  for (const change of ['token', 'gone', 'path', 'duplicate']) {
    const f = fixture(); await f.service.scan(); const d = f.target()
    if (change === 'token') await f.service.scan()
    if (change === 'gone') f.devices('PHONE2 fastboot usb:1-3')
    if (change === 'path') f.devices('PHONE1 fastboot usb:9-9')
    if (change === 'duplicate') f.devices('PHONE1 fastboot usb:1-2\nPHONE1 fastboot usb:1-4')
    await assert.rejects(f.service.reboot(d.serial, d.token, 'android', true), /changed|disappeared/)
    assert.equal(f.calls.some(c => c.args.includes('reboot')), false)
  }
})

test('command failure or timeout clears stale target, releases busy and never retries', async () => {
  for (const fail of [() => { throw new Error('Command timed out.') }, () => ({ stdout: '', stderr: 'FAILED (remote: unsupported)', code: 0 })]) {
    const f = fixture(); await f.service.scan(); const d = f.target()
    f.execute(async args => args[0] === 'devices' ? ok('PHONE1 fastboot usb:1-2') : fail())
    await assert.rejects(f.service.reboot(d.serial, d.token, 'android', true), /Check the phone.*no retry/)
    assert.equal(f.calls.filter(c => c.args.includes('reboot')).length, 1)
    assert.equal(f.service.state.busy, false)
    assert.equal(f.service.state.devices.some(d => d.serial === 'PHONE1'), false)
  }
})

test('scan failures clear old evidence and concurrent operations are rejected', async () => {
  const f = fixture(); await f.service.scan()
  let reject
  f.execute(() => new Promise((_, fail) => { reject = fail }))
  const pending = f.service.scan()
  await assert.rejects(f.service.scan(), /current Fastboot/)
  reject(new Error('USB failed')); await assert.rejects(pending, /USB failed/)
  assert.equal(f.service.state.devices.length, 0); assert.equal(f.service.state.checkedAt, null)
  assert.equal(f.service.state.busy, false)
})

test('shutdown aborts the bounded client and prevents later commands', async () => {
  const f = fixture()
  f.execute((_, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('Cancelled')))))
  const work = f.service.scan(); const rejected = assert.rejects(work, /Cancelled/)
  await f.service.shutdown(); await rejected
  await assert.rejects(f.service.scan(), /closing/)
  assert.equal(f.calls.length, 1)
})

test('USB read failures stop metadata collection and discard the stale target', async () => {
  const f = fixture(); await f.service.scan(); const d = f.target()
  f.execute(async args => args[0] === 'devices' ? ok('PHONE1 fastboot usb:1-2') : { stdout: '', stderr: 'FAILED (Status read failed (No such device))', code: 1 })
  await assert.rejects(f.service.inspect(d.serial, d.token), /communication was interrupted/)
  assert.equal(f.calls.filter(c => c.args.includes('getvar')).length, 1)
  assert.equal(f.service.state.devices.some(d => d.serial === 'PHONE1'), false)
})
