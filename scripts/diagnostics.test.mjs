import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDeviceInfo } from '../dist-electron/device-info.js'
import { AdbDiagnosticsService, parseServerStatus } from '../dist-electron/adb-diagnostics.js'
import { ConnectionService } from '../dist-electron/connections.js'
const ok = stdout => ({ stdout, stderr: '', code: 0 })
const properties = '[ro.product.manufacturer]: [Vendor]\n[ro.product.model]: [Phone]\n[ro.build.version.release]: [16]\n[ro.build.version.sdk]: [36]\n[ro.build.version.security_patch]: [2026-09-01]\n[ro.build.display.id]: [BUILD.1]\n[ro.product.cpu.abilist]: [arm64-v8a,armeabi-v7a]\n[private.secret]: [never exposed]'
test('device properties whitelist fields, preserve architectures and omit missing/unknown values', () => {
  const info = parseDeviceInfo(properties + '\n[ro.product.device]: [unknown]')
  assert.equal(info.model, 'Phone'); assert.equal(info.sdk, '36'); assert.equal(info.abis, 'arm64-v8a,armeabi-v7a')
  assert.equal(info.codename, undefined); assert.equal(info.fingerprint, undefined)
  assert.ok(!JSON.stringify(info).includes('never exposed'))
  assert.deepEqual(parseDeviceInfo('permission denied'), {})
})
test('device info reads are targeted, coalesced and retained by polling until reconnection', async () => {
  const calls = []; let live = 'USB1 device model:Phone'; let release
  const service = new ConnectionService({ data: { known: [] }, save: async () => {} }, () => 'adb.exe', () => {}, async (_file, args) => {
    calls.push(args)
    if (args[0] === 'devices') return ok(live)
    if (args.at(-1) === 'getprop') return new Promise(resolve => { release = () => resolve(ok(properties)) })
    return ok('16')
  })
  await service.scan()
  const first = service.inspect('USB1'), second = service.inspect('USB1')
  await new Promise(resolve => setImmediate(resolve)); release(); await Promise.all([first, second])
  assert.equal(service.state.devices[0].info.fields.securityPatch, '2026-09-01')
  assert.deepEqual(calls.filter(a => a.at(-1) === 'getprop'), [['-s', 'USB1', 'shell', 'getprop']])
  await service.scan(); assert.equal(service.state.devices[0].info.status, 'ready')
  live = ''; await service.scan(); await assert.rejects(service.inspect('USB1'), /Connect and authorize/)
  live = 'USB1 device model:Phone'; await service.scan(); assert.equal(service.state.devices[0].info, undefined)
})

test('extended firmware properties preserve reported values and distinguish missing boot state', () => {
  const info = parseDeviceInfo([
    '[ro.soc.manufacturer]: [Chip vendor]', '[ro.soc.model]: [Chip 123]', '[ro.product.board]: [board1]', '[ro.hardware]: [hardware1]',
    '[ro.bootloader]: [boot-v1]', '[gsm.version.baseband]: [radio-1,radio-2]', '[ro.build.date.utc]: [1700000000]', '[ro.build.date]: [vendor date]',
    '[ro.build.type]: [user]', '[ro.build.tags]: [release-keys]', '[ro.boot.verifiedbootstate]: [orange]', '[ro.boot.flash.locked]: [0]', '[ro.boot.slot_suffix]: [_b]',
    '[ro.serialno]: [not-for-this-panel]',
  ].join('\n'))
  assert.deepEqual(info, { socModel: 'Chip 123', socManufacturer: 'Chip vendor', board: 'board1', hardware: 'hardware1', bootloader: 'boot-v1', baseband: 'radio-1,radio-2', buildDate: '2023-11-14T22:13:20.000Z', buildType: 'user', buildTags: 'release-keys', verifiedBoot: 'orange', bootloaderState: 'unlocked', slot: 'B' })
  assert.equal(parseDeviceInfo('[ro.boot.verifiedbootstate]: [orange]').bootloaderState, undefined)
  assert.equal(parseDeviceInfo('[ro.boot.flash.locked]: [1]').bootloaderState, 'locked')
  assert.equal(parseDeviceInfo('[ro.boot.flash.locked]: [invalid]\n[ro.boot.vbmeta.device_state]: [unlocked]').bootloaderState, 'unlocked')
  assert.equal(parseDeviceInfo('[ro.build.date.utc]: [bad]\n[ro.build.date]: [Vendor date]').buildDate, 'Vendor date')
  assert.equal(parseDeviceInfo('[ro.soc.model]: [unknown]').socModel, undefined)
})
test('device disconnect discards in-flight property results and read failures allow manual retry', async () => {
  let live = 'USB1 device model:Phone', resolveRead, fail = false
  const service = new ConnectionService({ data: { known: [] }, save: async () => {} }, () => 'adb.exe', () => {}, async (_file, args) => {
    if (args[0] === 'devices') return ok(live)
    if (args.at(-1) === 'getprop') { if (fail) throw new Error('Permission denied'); return new Promise(resolve => { resolveRead = resolve }) }
    return ok('16')
  })
  await service.scan(); const pending = service.inspect('USB1'); await new Promise(resolve => setImmediate(resolve))
  live = ''; await service.scan(); resolveRead(ok(properties)); await pending
  assert.equal(service.state.devices[0].info, undefined)
  live = 'USB1 device'; await service.scan(); fail = true; await service.inspect('USB1')
  assert.equal(service.state.devices[0].info.status, 'error'); assert.match(service.state.devices[0].info.error, /Permission denied/)
  fail = false; const retry = service.inspect('USB1'); await new Promise(resolve => setImmediate(resolve)); resolveRead(ok(properties)); await retry
  assert.equal(service.state.devices[0].info.status, 'ready')
})
test('ADB diagnostics retain partial results, parse escaped paths and exclude key material', async () => {
  const server = 'version: "37.0.1"\nusb_backend: LIBADBUSB\nmdns_enabled: false\nexecutable_absolute_path: "C:\\\\Tools\\\\adb.exe"\nkeystore_path: "secret"'
  assert.equal(parseServerStatus(server).executable_absolute_path, 'C:\\Tools\\adb.exe')
  assert.equal(parseServerStatus(server).keystore_path, undefined)
  const service = new AdbDiagnosticsService(() => 'adb.exe', () => {}, async (_file, args) => {
    if (args[0] === 'version') return ok('Android Debug Bridge version 1.0.41\nVersion 37.0.1-123')
    if (args[0] === 'server-status') return { stdout: '', stderr: 'unknown command', code: 1 }
    if (args.join(' ') === 'mdns services') return ok('List of discovered mdns services\nphone _adb-tls-connect._tcp 192.168.1.2:35001')
    return ok('available')
  })
  await service.refresh()
  assert.equal(service.state.fields.clientVersion, '37.0.1-123')
  assert.equal(service.state.fields.version, undefined)
  assert.equal(service.state.issues[0].check, 'server-status')
  assert.equal(service.state.services[0].address, '192.168.1.2:35001')
  assert.equal(service.state.servicesAvailable, true)
  const missing = new AdbDiagnosticsService(() => null, () => {}, async () => { throw new Error('must not run') })
  await missing.refresh(); assert.equal(missing.state.servicesAvailable, false); assert.equal(missing.state.issues[0].check, 'ADB')
  let discovery = 'List of discovered mdns services'
  const empty = new AdbDiagnosticsService(() => 'adb.exe', () => {}, async (_file, args) => ok(args.join(' ') === 'mdns services' ? discovery : 'unsupported response'))
  await empty.refresh(); assert.equal(empty.state.servicesAvailable, true); assert.equal(empty.state.services.length, 0)
  discovery = 'unrecognized response'; await empty.refresh(); assert.equal(empty.state.servicesAvailable, false)
})
