import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { Storage } from '../dist-electron/storage.js'
import { ComponentsService, platformPackage, compareVersions } from '../dist-electron/components.js'
import { ConnectionService, endpoint, parseDevices, parseMdns, mergeWirelessTransports } from '../dist-electron/connections.js'
import { download, officialResponse } from '../dist-electron/downloads.js'
import { run, checked } from '../dist-electron/process.js'
import { parseGoogleDrivers } from '../dist-electron/driver.js'
import { installationTargets, componentCatalog } from '../dist-electron/catalog.js'

await mkdir('desktop-test-results', { recursive: true })
const root = await mkdtemp(path.resolve('desktop-test-results/backend-'))
const ok = stdout => ({ stdout, stderr: '', code: 0 })
const xml = `<sdk:sdk-repository xmlns:sdk="test"><remotePackage path="platform-tools"><revision><major>37</major><minor>0</minor><micro>1</micro></revision><archives><archive><host-os>linux</host-os><complete><url>linux.zip</url></complete></archive><archive><host-os>windows</host-os><complete><size>42</size><checksum type="sha1">${'a'.repeat(40)}</checksum><url>platform-tools_r37.0.1-win.zip</url></complete></archive></archives></remotePackage></sdk:sdk-repository>`

test('official metadata selects Windows archive and validates checksum metadata', () => {
  const result = platformPackage(xml)
  assert.equal(result.version, '37.0.1'); assert.equal(result.size, 42); assert.match(result.url, /win\.zip$/)
  assert.throws(() => platformPackage(xml.replace('a'.repeat(40), 'bad')), /checksum/)
  assert.equal(compareVersions('37.0.1', '36.0.2'), 1)
})

test('metadata failures identify their component and source while independent checks continue', async t => {
  const events = []
  const service = new ComponentsService({}, event => events.push(event))
  t.mock.method(globalThis, 'fetch', async url => String(url).includes('dl.google.com') ? new Response(xml) : new Response('', { status: 403 }))
  await service.refreshPackages()
  const warnings = events.filter(e => e.type === 'activity')
  assert.equal(warnings.length, 1)
  assert.equal(warnings[0].source, 'components')
  assert.match(warnings[0].text, /^scrcpy:.*HTTP 403/)
  assert.match(warnings[0].text, /Source: https:\/\/api.github.com\/repos\/Genymobile\/scrcpy\/releases\/latest/)
  assert.equal(service.packages.get('adb').version, '37.0.1')
  events.length = 0
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 403 }))
  await service.refreshPackages()
  assert.equal(events.length, 2)
  assert.match(events[0].text, /^Platform Tools \(ADB \/ Fastboot\):.*HTTP 403/)
  assert.match(events[0].text, /Source: https:\/\/dl.google.com\/android\/repository\/repository2-3.xml/)
  assert.match(events[1].text, /^scrcpy:/)
})
test('ADB device parser separates unauthorized, offline, network and emulator transports', () => {
  const result = parseDevices('List of devices attached\nUSB1 unauthorized usb:1-2\nUSB2 offline\n192.168.1.5:39001 device product:x model:Pixel_8 transport_id:2\nemulator-5554 device model:sdk_gphone\n* daemon started successfully *')
  assert.equal(result.length, 4); assert.equal(result[0].status, 'unauthorized'); assert.equal(result[1].status, 'offline'); assert.equal(result[2].name, 'Pixel 8'); assert.equal(result[2].method, 'Wi-Fi'); assert.equal(result[3].method, 'Emulator')
})
test('endpoint validation rejects shell fragments, invalid IPs and invalid ports', () => {
  assert.equal(endpoint('192.168.1.2', '39001'), '192.168.1.2:39001')
  assert.equal(endpoint('::1', '12345'), '[::1]:12345')
  for (const [host, port] of [['1.2.3.999', '123'], ['x;calc', '5555'], ['1.2.3.4', '0'], ['1.2.3.4', '65536'], ['1.2.3.4', '-s']]) assert.throws(() => endpoint(host, port))
})

test('wireless polling keeps verified identity within a transport and rechecks replacement transports', async () => {
  const storage = new Storage(path.join(root, 'wifi-sleep-identity')); await storage.load()
  let transport = '6', identity = 'PHONE1', identityCalls = 0, visible = true, slow = false
  const service = new ConnectionService(storage, () => 'adb.exe', () => {}, async (_file, args) => {
    if (args[0] === 'devices') return ok(visible ? `192.168.1.134:42513 device model:Phone transport_id:${transport}` : '')
    if (args.includes('ro.serialno')) { identityCalls++; if (slow) throw new Error('Command timed out.'); return ok(identity) }
    if (args.includes('ro.build.version.release')) return ok('16')
    return ok('')
  })
  await service.scan()
  assert.equal(service.state.activeDeviceId, 'wifi:PHONE1')
  slow = true
  await service.scan()
  assert.equal(service.state.activeDeviceId, 'wifi:PHONE1', 'Slow metadata must not change the active device ID')
  assert.equal(identityCalls, 1, 'A verified live transport needs no repeated shell identity query')
  transport = '7'
  await service.scan()
  assert.equal(identityCalls, 2)
  assert.ok(service.state.devices.filter(d => d.status === 'connected').every(d => !d.hardwareId), 'Replacement transport must not inherit unverified identity')
  slow = false; identity = 'PHONE2'
  await service.scan()
  assert.equal(service.state.activeDeviceId, 'wifi:PHONE2')
  visible = false; await service.scan()
  visible = true; identity = 'PHONE3'
  await service.scan()
  assert.equal(service.state.activeDeviceId, 'wifi:PHONE3', 'An absent transport invalidates its cached identity')
})
test('mDNS parses only valid pairing and connection addresses', () => {
  const services = parseMdns('List of discovered mdns services\nstudio-test _adb-tls-pairing._tcp 192.168.1.2:35000\nadb-guid-123 _adb-tls-connect._tcp. [::1]:37000\nbad _adb-tls-connect._tcp x;calc:99')
  assert.equal(services.length, 2); assert.equal(services[0].name, 'studio-test'); assert.equal(services[1].address, '[::1]:37000')
})
test('manual component location validates executables before saving; existing paths survive failures', async () => {
  const storage = new Storage(path.join(root, 'locate')); await storage.load()
  const folder = path.join(root, 'tools'); await mkdir(folder); await writeFile(path.join(folder, 'adb.exe'), 'test placeholder'); await writeFile(path.join(folder, 'fastboot.exe'), 'test placeholder')
  let valid = true
  const runner = async (file, args) => file.endsWith('adb.exe') ? ok(valid ? 'Android Debug Bridge version 1.0.41\nVersion 37.0.1-123' : 'unrelated tool') : file.endsWith('fastboot.exe') ? ok('fastboot version 37.0.1-123') : ok(args.includes('-EncodedCommand') ? '[]' : '')
  const service = new ComponentsService(storage, () => {}, runner)
  await service.locate('adb', folder)
  assert.equal(storage.data.paths.adb, folder); assert.equal(storage.data.paths.fastboot, folder)
  assert.equal(service.records.find(c => c.id === 'adb').version, '37.0.1')
  valid = false; await assert.rejects(service.locate('adb', folder), /identify itself/)
  assert.equal(storage.data.paths.adb, folder)
})
test('scans persist actual connections and clear the active device on cable loss', async () => {
  const storage = new Storage(path.join(root, 'scan')); await storage.load()
  let device = 'USB1 unauthorized'
  const runner = async (_file, args) => ok(args[0] === 'host-features' ? 'libusb' : args[0] === 'devices' ? device : '15')
  const service = new ConnectionService(storage, () => 'adb.exe', () => {}, runner)
  await service.scan(); assert.equal(storage.data.known.length, 0); assert.equal(service.state.activeDeviceId, null)
  device = 'USB1 device model:Pixel_8'; await service.scan(); assert.equal(service.state.activeDeviceId, 'USB1'); assert.equal(storage.data.known.length, 1)
  device = ''; await service.scan(); assert.equal(service.state.activeDeviceId, null); assert.equal(service.state.devices[0].status, 'disconnected')
  const restored = new Storage(storage.root); await restored.load(); assert.equal(restored.data.known[0].status, 'disconnected')
})
test('Google driver files are a prepared package, not a required Windows installation', async () => {
  const storage = new Storage(path.join(root, 'driver')); await storage.load()
  const folder = path.join(root, 'google-driver'); await mkdir(folder)
  await writeFile(path.join(folder, 'android_winusb.inf'), '[Version]\nProvider=Google\nDriverVer=08/28/2014,11.0.0000.00000\n[WinUSB]\n')
  let inventory = ''
  const service = new ComponentsService(storage, () => {}, async () => ok(inventory))
  await service.detectOne('driver')
  assert.equal(service.records.find(c => c.id === 'driver').status, 'Not installed')
  storage.data.paths.driver = folder
  await service.detectOne('driver')
  const prepared = service.records.find(c => c.id === 'driver')
  assert.equal(prepared.status, 'Package ready'); assert.equal(prepared.version, '11.0.0000.00000')
  assert.match(prepared.message, /Choose Install driver/)
  inventory = 'Published Name: oem10.inf\nOriginal Name: android_winusb.inf\nProvider Name: Google, Inc.\nDriver Version: 01/01/2020 12.0.0.0'
  await service.detectOne('driver')
  assert.equal(service.records.find(c => c.id === 'driver').status, 'Installed')
  assert.equal(service.records.find(c => c.id === 'driver').version, '12.0.0.0')
})
test('Google driver inventory recognizes localized Windows output and ignores other packages', () => {
  const result = parseGoogleDrivers('Опубликованное имя: oem25.inf\nИсходное имя: android_winusb.inf\nПоставщик: Google, Inc.\nВерсия: 08/28/2014 11.0.0000.00000\n\nPublished Name: oem26.inf\nOriginal Name: other.inf\nProvider Name: Google\nDriver Version: 1.2.3.4')
  assert.deepEqual(result, [{ publishedName: 'oem25.inf', version: '11.0.0000.00000' }])
})
test('bulk installation includes a prepared driver and deduplicates Platform Tools', () => {
  const records = componentCatalog.map(c => ({ ...c, status: c.id === 'driver' ? 'Package ready' : c.id === 'adb' || c.id === 'fastboot' ? 'Not installed' : 'Installed' }))
  assert.deepEqual(installationTargets(records), ['adb', 'driver'])
})
test('prepared driver installs without downloading; UAC cancellation, failure and unverified success stay recoverable', async () => {
  const storage = new Storage(path.join(root, 'driver-install')); await storage.load()
  const folder = path.join(root, 'Driver folder with spaces'); await mkdir(folder)
  await writeFile(path.join(folder, 'android_winusb.inf'), 'Provider=Google\nDriverVer=08/28/2014,11.0.0000.00000\nWinUSB')
  storage.data.paths.driver = folder
  let exitCode = '1223', present = false, installs = 0
  const runner = async (_file, args, _timeout, _input, env) => {
    const script = Buffer.from(args.at(-1), 'base64').toString('utf16le')
    if (script.includes('Start-Process')) {
      installs++; assert.equal(env.ADB_VAULT_DRIVER_INF, path.join(folder, 'android_winusb.inf'))
      assert.match(script, /-Verb RunAs/); assert.match(script, /'\/install'/)
      assert.doesNotMatch(script, /\/force|\/reboot|\/delete-driver/)
      return ok(exitCode)
    }
    assert.match(script, /\/enum-drivers/)
    return ok(present ? 'Name: oem25.inf\nOriginal: android_winusb.inf\nProvider: Google\nVersion: 11.0.0.0' : '')
  }
  const service = new ComponentsService(storage, () => {}, runner)
  service.refreshPackages = async () => { throw new Error('Existing driver must not download again') }
  await assert.rejects(service.install('driver'), /cancelled/)
  assert.equal(service.records.find(c => c.id === 'driver').status, 'Install failed')
  assert.equal(storage.data.paths.driver, folder)
  exitCode = '5'; await assert.rejects(service.install('driver'), /code 5/)
  exitCode = '0'; await assert.rejects(service.install('driver'), /could not be verified/)
  exitCode = '259'; await assert.rejects(service.install('driver'), /could not be verified/)
  present = true; await service.install('driver')
  assert.equal(service.records.find(c => c.id === 'driver').status, 'Installed')
  assert.match(service.records.find(c => c.id === 'driver').message, /No device driver was changed/)
  exitCode = '3010'; await service.install('driver')
  const installed = service.records.find(c => c.id === 'driver')
  assert.equal(installed.status, 'Installed'); assert.match(installed.message, /restart manually/)
  assert.equal(installs, 6); assert.equal(service.busy, false)
  await service.detectOne('driver'); assert.equal(service.records.find(c => c.id === 'driver').status, 'Installed')
})
test('pairing sends secret via stdin and uses the advertised connection port, never 5555', async () => {
  const storage = new Storage(path.join(root, 'pair')); await storage.load(); const calls = []
  const runner = async (_file, args, _timeout, input) => { calls.push({ args, input }); return ok(args[0] === 'pair' ? 'Enter pairing code: Successfully paired to 192.168.1.2:35000 [guid=adb-guid]' : args[0] === 'mdns' ? 'adb-guid-1 _adb-tls-connect._tcp 192.168.1.2:39123' : args[0] === 'connect' ? 'connected to 192.168.1.2:39123' : '') }
  const service = new ConnectionService(storage, () => 'adb.exe', () => {}, runner)
  await service.pair('192.168.1.2', '35000', '123456')
  assert.deepEqual(calls.find(c => c.args[0] === 'pair'), { args: ['pair', '192.168.1.2:35000'], input: '123456\n' })
  assert.ok(calls.some(c => c.args[0] === 'connect' && c.args[1] === '192.168.1.2:39123'))
  assert.equal(service.state.activeDeviceId, null)
  assert.ok(!JSON.stringify(storage.data).includes('123456'))
})
test('overlapping scans await the same actual device result', async () => {
  const storage = new Storage(path.join(root, 'overlapping')); await storage.load()
  let release
  const gate = new Promise(resolve => { release = resolve })
  let scans = 0
  const service = new ConnectionService(storage, () => 'adb.exe', () => {}, async (_file, args) => {
    if (args[0] === 'devices') { scans++; await gate; return ok('USB1 device model:Pixel_8') }
    return ok(args[0] === 'host-features' ? '' : '15')
  })
  const first = service.scan(), second = service.scan()
  assert.equal(first, second)
  release(); await second
  assert.equal(scans, 1); assert.equal(service.state.devices[0].status, 'connected')
})
test('QR pairing only responds to its own service and expires secrets', async () => {
  const storage = new Storage(path.join(root, 'qr')); await storage.load(); let advertised = 'unrelated'; let paired = false
  const runner = async (_file, args) => { if (args[0] === 'pair') { paired = true; return ok('Successfully paired') }; return ok(args[0] === 'mdns' && args[1] === 'services' ? `${advertised} _adb-tls-pairing._tcp 192.168.1.2:36000` : '') }
  const service = new ConnectionService(storage, () => 'adb.exe', () => {}, runner)
  await service.newQr(); assert.match(service.state.qr.payload, /^WIFI:T:ADB;S:studio-/)
  await service.checkQr(); assert.equal(paired, false)
  advertised = service.state.qr.payload.match(/S:([^;]+)/)[1]; await service.checkQr(); assert.equal(paired, true); assert.equal(service.state.qr.status, 'paired'); assert.equal(service.state.qr.payload, '')
  await service.newQr(); service.qrSecret.expires = Date.now() - 1; await service.checkQr(); assert.equal(service.state.qr.status, 'expired'); assert.equal(service.state.qr.payload, '')
})
test('wireless reconnect verifies an existing transport without disruption; USB detach still needs support', async () => {
  const storage = new Storage(path.join(root, 'disconnect')); await storage.load(); const calls = []
  const runner = async (_file, args) => { calls.push(args); return ok(args[0] === 'devices' ? '192.168.1.2:39001 device\nUSB1 device' : args.includes('ro.serialno') ? 'PHONE1' : '') }
  const service = new ConnectionService(storage, () => 'adb.exe', () => {}, runner)
  service.state.devices = parseDevices('192.168.1.2:39001 device\nUSB1 device')
  await assert.rejects(service.disconnect('USB1'), /Unplug/)
  await service.reconnect('192.168.1.2:39001')
  assert.deepEqual(calls.filter(args => ['connect', 'disconnect'].includes(args[0])), [])
  assert.match(service.state.message, /verified/)
})
test('mDNS reconnect resolves the current port and never invents port 5555', async () => {
  const storage = new Storage(path.join(root, 'mdns-reconnect')); await storage.load()
  const serial = 'adb-phone._adb-tls-connect._tcp', calls = []
  let advertised = true, live = ''
  const service = new ConnectionService(storage, () => 'adb.exe', () => {}, async (_file, args) => {
    calls.push(args)
    if (args[0] === 'mdns') return ok(advertised ? 'adb-phone _adb-tls-connect._tcp 192.168.1.2:40123' : '')
    if (args[0] === 'devices') return ok(live)
    if (args[0] === 'connect') { live = `${args[1]} device`; return ok(`connected to ${args[1]}`) }
    return ok(args.includes('ro.serialno') ? 'PHONE1' : '')
  })
  service.state.devices = parseDevices(`${serial} offline`).map(d => ({ ...d, hardwareId: 'PHONE1' }))
  await service.reconnect(serial)
  assert.deepEqual(calls.filter(a => a[0] === 'connect'), [['connect', '192.168.1.2:40123']])
  calls.length = 0; advertised = false; service.state.devices = parseDevices(`${serial} offline`).map(d => ({ ...d, hardwareId: 'PHONE1' }))
  await assert.rejects(service.reconnect(serial), /not currently advertised/)
  assert.equal(calls.some(a => ['connect', 'disconnect'].includes(a[0])), false)
})

test('reconnect error survives unrelated recovery but clears when the same phone returns; activity is retained', async () => {
  const storage = new Storage(path.join(root, 'connection-recovery')); await storage.load()
  const serial = 'adb-phone._adb-tls-connect._tcp', events = []
  let live = 'USB_OTHER device'
  const service = new ConnectionService(storage, () => 'adb.exe', event => events.push(event), async (_file, args) => {
    if (args[0] === 'devices') return ok(live)
    if (args[0] === 'mdns') return ok('adb-phone _adb-tls-connect._tcp 192.168.1.2:40123')
    if (args[0] === 'connect') return ok('cannot connect: refused')
    return ok(args.at(-1) === 'ro.serialno' ? 'PHONE1' : '')
  })
  service.state.devices = parseDevices(`${serial} offline`).map(d => ({ ...d, known: true, hardwareId: 'PHONE1' }))
  await assert.rejects(service.reconnect(serial), /refused/)
  await service.scan(); assert.match(service.state.error, /refused/)
  live = '192.168.1.2:40234 device'
  await service.scan()
  assert.equal(service.state.error, null)
  assert.equal(service.state.activeDeviceId, 'wifi:PHONE1')
  assert.ok(events.some(e => e.type === 'activity' && /refused/.test(e.text)))
})

test('manual connect error clears when its endpoint connects automatically', async () => {
  const storage = new Storage(path.join(root, 'manual-recovery')); await storage.load()
  let live = ''
  const service = new ConnectionService(storage, () => 'adb.exe', () => {}, async (_file, args) => ok(args[0] === 'connect' ? 'connection refused' : args[0] === 'devices' ? live : ''))
  await assert.rejects(service.connect('192.168.1.2', '40123'), /refused/)
  await service.scan(); assert.match(service.state.error, /refused/)
  live = '192.168.1.2:40123 device'
  await service.scan(); assert.equal(service.state.error, null)
})

test('Wi-Fi aliases merge by verified hardware identity, never by model or across USB', () => {
  const devices = parseDevices('192.168.1.2:39001 device model:Same_model\nadb-phone._adb-tls-connect._tcp device model:Same_model\nUSB1 device model:Same_model\n192.168.1.3:39001 device model:Same_model')
  devices[0].hardwareId = devices[1].hardwareId = devices[2].hardwareId = 'PHONE1'
  devices[3].hardwareId = 'PHONE2'
  const result = mergeWirelessTransports(devices)
  assert.equal(result.length, 3)
  assert.deepEqual(result[0].aliases, ['192.168.1.2:39001', 'adb-phone._adb-tls-connect._tcp'])
  assert.equal(result[0].id, 'wifi:PHONE1'); assert.equal(result[1].method, 'USB')
  assert.equal(mergeWirelessTransports(devices.map(d => ({ ...d, hardwareId: undefined }))).length, 4)
})
test('scans migrate duplicate Wi-Fi history, keep active selection, and disconnect both verified aliases', async () => {
  const storage = new Storage(path.join(root, 'wifi-aliases')); await storage.load()
  const ip = '192.168.1.2:39001', mdns = 'adb-phone._adb-tls-connect._tcp'
  let transports = [ip, mdns], calls = []
  storage.data.known = parseDevices(`${ip} device model:Phone\n${mdns} device model:Phone`).map(d => ({ ...d, known: true }))
  const service = new ConnectionService(storage, () => 'adb.exe', () => {}, async (_file, args) => {
    calls.push(args)
    if (args[0] === 'devices') return ok(transports.map(serial => `${serial} device model:Phone`).join('\n'))
    if (args[0] === '-s') return ok(args.at(-1) === 'ro.serialno' ? 'PHONE1' : '16')
    if (args[0] === 'disconnect') transports = transports.filter(serial => serial !== args[1])
    return ok('')
  })
  service.state.activeDeviceId = mdns
  await service.scan()
  assert.equal(service.state.devices.length, 1); assert.equal(service.state.activeDeviceId, 'wifi:PHONE1')
  assert.equal(storage.data.known.length, 1)
  await service.scan(); assert.equal(service.state.devices.length, 1)
  await service.disconnect('wifi:PHONE1')
  assert.deepEqual(calls.filter(a => a[0] === 'disconnect'), [['disconnect', ip], ['disconnect', mdns]])
  assert.equal(service.state.devices[0].status, 'disconnected'); assert.equal(service.state.activeDeviceId, null)
  const restored = new Storage(storage.root); await restored.load()
  assert.equal(restored.data.known.length, 1); assert.equal(restored.data.known[0].hardwareId, 'PHONE1')
})
test('pairing and manual connect reuse an automatically connected mDNS transport', async () => {
  const storage = new Storage(path.join(root, 'wifi-auto')); await storage.load(); const calls = []
  const service = new ConnectionService(storage, () => 'adb.exe', () => {}, async (_file, args) => {
    calls.push(args)
    if (args[0] === 'pair') return ok('Successfully paired [guid=adb-phone]')
    if (args[0] === 'mdns') return ok('adb-phone-1 _adb-tls-connect._tcp 192.168.1.2:39123')
    if (args[0] === 'devices') return ok('adb-phone-1._adb-tls-connect._tcp device model:Phone')
    if (args[0] === '-s') return ok(args.at(-1) === 'ro.serialno' ? 'PHONE1' : '16')
    return ok('')
  })
  await service.pair('192.168.1.2', '35000', '123456')
  await service.connect('192.168.1.2', '39123')
  assert.equal(calls.filter(a => a[0] === 'connect').length, 0)
  assert.equal(service.state.devices.length, 1); assert.equal(service.state.devices[0].status, 'connected')
})
test('failed connection output never becomes successful even with exit code zero', async () => {
  const storage = new Storage(path.join(root, 'failed')); await storage.load()
  const service = new ConnectionService(storage, () => 'adb.exe', () => {}, async () => ok('failed to connect: refused'))
  await assert.rejects(service.connect('192.168.1.2', '39001'), /refused/)
  assert.equal(service.state.activeDeviceId, null); assert.equal(service.state.busy, false)
})
test('forget removes only inactive history, persists it, and does not run ADB or unpair the phone', async () => {
  const storage = new Storage(path.join(root, 'forget')); await storage.load()
  storage.data.known = parseDevices('USB1 device model:Phone\nUSB2 device model:Other').map(d => ({ ...d, known: true, status: 'disconnected' }))
  await storage.save()
  let calls = 0
  const service = new ConnectionService(storage, () => null, () => {}, async () => { calls++; return ok('') })
  service.state.devices[1].status = 'connected'
  await assert.rejects(service.forget('USB2'), /Disconnect/)
  await service.forget('USB1')
  assert.deepEqual(service.state.devices.map(d => d.id), ['USB2'])
  const restored = new Storage(storage.root); await restored.load()
  assert.deepEqual(restored.data.known.map(d => d.id), ['USB2']); assert.equal(calls, 0)
  service.state.devices[0].status = 'offline'
  await service.forget('USB2')
  assert.equal(service.state.devices[0].known, false); assert.equal(storage.data.known.length, 0)
  assert.equal(service.state.busy, false)
})
test('forget waits for an in-flight scan and refuses a device that just reconnected', async () => {
  const storage = new Storage(path.join(root, 'forget-scan')); await storage.load()
  storage.data.known = parseDevices('USB1 device model:Phone').map(d => ({ ...d, known: true }))
  let release
  const gate = new Promise(resolve => { release = resolve })
  const service = new ConnectionService(storage, () => 'adb.exe', () => {}, async (_file, args) => {
    if (args[0] === 'devices') { await gate; return ok('USB1 device model:Phone') }
    return ok('')
  })
  const scan = service.scan(), removal = service.forget('USB1')
  const rejected = assert.rejects(removal, /Disconnect/)
  release(); await scan; await rejected
  assert.equal(service.state.devices[0].known, true); assert.equal(storage.data.known.length, 1)
})
test('downloads enforce publisher hash and size; invalid payloads are not retained', async () => {
  const original = globalThis.fetch; const bytes = Buffer.from('verified payload')
  globalThis.fetch = async () => new Response(bytes, { headers: { 'Content-Length': String(bytes.length) } })
  try {
    const target = path.join(root, 'good.zip'), digest = createHash('sha256').update(bytes).digest('hex')
    await download('https://dl.google.com/package.zip', target, { digest, size: bytes.length }, () => {}); assert.equal(await readFile(target, 'utf8'), bytes.toString())
    const failed = path.join(root, 'bad.zip'); await assert.rejects(download('https://dl.google.com/package.zip', failed, { digest: '0'.repeat(64) }, () => {}), /checksum/); await assert.rejects(stat(failed))
    await assert.rejects(officialResponse('http://dl.google.com/package.zip', AbortSignal.timeout(1000)), /Unsupported/)
    await assert.rejects(officialResponse('https://untrusted.example/package.zip', AbortSignal.timeout(1000)), /Unsupported/)
  } finally { globalThis.fetch = original }
})
test('real process runner uses bounded output, reports failures and times out', async () => {
  assert.equal(checked(await run(process.execPath, ['-e', 'process.stdout.write("OK")'])), 'OK')
  assert.throws(() => checked({ code: 1, stdout: '', stderr: 'failed' }), /failed/)
  await assert.rejects(run(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], 100), /timed out/)
})


test('experimental APK transfer preference is off by default, persists both choices, and rejects truthy non-booleans', async () => {
  const location = path.join(root, 'apk-zstd-preference')
  const storage = new Storage(location); await storage.load()
  assert.notEqual(storage.data.apkZstd, true)
  for (const enabled of [true, false]) {
    storage.data.apkZstd = enabled; await storage.save()
    const loaded = new Storage(location); await loaded.load()
    assert.equal(loaded.data.apkZstd, enabled)
  }
  for (const invalid of ['true', 1, {}]) {
    await writeFile(path.join(location, 'backend.json'), JSON.stringify({ apkZstd: invalid }))
    const loaded = new Storage(location); await loaded.load()
    assert.equal(loaded.data.apkZstd, false)
  }
})


test('failed commands show diagnostics rather than ADB stderr progress', () => {
  const progress = '[  0%] /data/app/base.apk\r\x1b[2K[ 25%] /data/app/base.apk'
  assert.throws(() => checked({ code: 1, stderr: progress, stdout: "adb.exe: no device with transport id '2'" }), error => {
    assert.equal(error.message, "adb.exe: no device with transport id '2'")
    return true
  })
  assert.throws(() => checked({ code: 1, stderr: progress, stdout: '' }), error => {
    assert.match(error.message, /code 1/)
    assert.match(error.message, /transfer ended before completion/)
    assert.doesNotMatch(error.message, /\[ 25%\]/)
    return true
  })
  assert.throws(() => checked({ code: 1, stderr: progress + '\radb: error: connection reset', stdout: '' }), /connection reset/)
  assert.throws(() => checked({ code: 1, stderr: 'diagnostic\n'.repeat(300) + 'fatal: last error', stdout: '' }), /fatal: last error/)
  assert.equal(checked({ code: 0, stderr: progress, stdout: '1 file pulled' }), '1 file pulled')
})
