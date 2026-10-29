import test from 'node:test'
import assert from 'node:assert/strict'
import { bookmarkKey, savedFileLocation, resolveSavedFileLocation, resolveFileReadLocation } from '../dist-electron/file-places.js'
import { appendCategoryFolders, relativeCategoryFolders, categoryScope, categoryQuery } from '../dist-electron/file-categories.js'
import { validateFilePlan } from '../dist-electron/files.js'

const location = { kind: 'device', id: 'old-wifi', serial: 'old:5555', transportId: '2', path: '/sdcard/Documents', root: true }
const phone = { id: 'phone', serial: 'USB-SERIAL', aliases: ['old:5555'], hardwareId: 'actual-phone', transportId: '8', status: 'connected' }

test('phone bookmarks discard transient access and resolve only the same phone after reconnection', () => {
  const saved = savedFileLocation(location, [phone])
  assert.equal(saved.transportId, undefined); assert.equal(saved.root, false); assert.equal(saved.hardwareId, 'actual-phone')
  const resolved = resolveSavedFileLocation(saved, [phone])
  assert.equal(resolved.transportId, '8'); assert.equal(resolved.id, 'phone'); assert.equal(resolved.serial, 'USB-SERIAL'); assert.equal(resolved.root, false)
  assert.throws(() => resolveSavedFileLocation(saved, [{ ...phone, hardwareId: 'another-phone' }]), /not connected/)
  assert.throws(() => resolveSavedFileLocation(saved, [{ ...phone, status: 'offline' }]), /not connected/)
  assert.equal(resolveSavedFileLocation(location, [phone]).transportId, '8', 'old bookmarks use verified serial aliases')
})

test('bookmark identity ignores root, transient transports and equivalent Windows path spelling', () => {
  assert.equal(bookmarkKey(location), bookmarkKey({ ...location, root: false, transportId: '9', path: location.path + '/' }))
  assert.equal(bookmarkKey(savedFileLocation(location, [phone])), bookmarkKey(savedFileLocation({ ...phone, kind: 'device', path: location.path }, [phone])))
  assert.equal(bookmarkKey({ kind: 'local', path: 'C:\\Photos\\' }), bookmarkKey({ kind: 'local', path: 'c:\\photos' }))
  assert.notEqual(bookmarkKey(location), bookmarkKey({ ...location, id: 'other-phone' }))
})

test('new preview reads use the same verified phone after its Wi-Fi address or transport changes', () => {
  const original = { ...location, id: 'wifi:actual-phone', hardwareId: 'actual-phone' }
  const live = { ...phone, id: original.id, method: 'Wi-Fi', serial: '192.168.1.20:40000' }
  assert.deepEqual(resolveFileReadLocation(original, [live]), { ...original, serial: live.serial, transportId: live.transportId })
  assert.equal(resolveFileReadLocation({ ...original, hardwareId: undefined }, [live]).hardwareId, live.hardwareId, 'older Wi-Fi group IDs retain verified identity')
  assert.equal(original.transportId, '2', 'captured operation locations are never modified')
  const usb = { ...phone, method: 'USB', id: 'usb-phone' }
  assert.equal(resolveFileReadLocation(original, [live, usb]).id, live.id, 'prefer the already selected source when both transports are connected')
  const local = { kind: 'local', path: 'C:\\Music\\track.mp3' }
  assert.equal(resolveFileReadLocation(local, []), local)
})

test('preview resolution rejects another phone, offline, ambiguous identity and unverified reused network addresses', () => {
  const original = { ...location, hardwareId: 'actual-phone' }
  assert.throws(() => resolveFileReadLocation(original, [{ ...phone, id: location.id, serial: location.serial, transportId: location.transportId, hardwareId: 'another-phone' }]), /identity cannot be confirmed/)
  assert.throws(() => resolveFileReadLocation(original, [{ ...phone, status: 'offline' }]), /unavailable/)
  assert.throws(() => resolveFileReadLocation(original, [phone, { ...phone, id: 'second' }]), /identity cannot be confirmed/)
  assert.throws(() => resolveFileReadLocation(location, [{ ...phone, id: location.id, serial: location.serial, method: 'Wi-Fi' }]), /identity cannot be confirmed/)
  const usb = { ...phone, id: 'USB-SERIAL', method: 'USB' }, usbLocation = { ...location, id: usb.id, serial: usb.serial }
  assert.equal(resolveFileReadLocation(usbLocation, [usb]).transportId, '8')
  assert.throws(() => resolveFileReadLocation(usbLocation, [{ ...usb, serial: 'OTHER' }]), /unavailable/)
})

test('categories use the selected public volume, never the entire phone root', () => {
  const storages = [{ kind: 'internal', path: '/storage/emulated/10' }, { kind: 'sd', path: '/storage/1234-5678' }, { kind: 'usb', path: '/storage/ABCD-1234' }]
  for (const path of ['/storage/1234-5678/DCIM', '/storage/ABCD-1234/Downloads']) assert.equal(categoryScope({ ...location, path }, storages).path, path.slice(0, path.lastIndexOf('/')))
  assert.equal(categoryScope({ ...location, path: '/' }, storages).path, '/storage/emulated/10')
  assert.equal(categoryScope({ ...location, path: '/sdcard/DCIM' }, storages).path, '/storage/emulated/10')
  assert.equal(categoryScope({ ...location, path: '/storage/emulated/0/DCIM' }).path, '/storage/emulated/0')
  assert.equal(categoryScope({ ...location, path: '/storage/emulated/11/DCIM' }, storages).path, '/storage/emulated/11')
  assert.equal(categoryScope({ kind: 'local', path: '\\\\NAS\\Media' }).path, '\\\\NAS\\Media')
  assert.equal(categoryScope({ kind: 'local', path: '' }).path, '')
})

test('all categories match whole file extensions case-insensitively without scanning archive contents', () => {
  for (const [category, name] of Object.entries({ images: 'Photo.HEIC', videos: 'Clip.MP4', audio: 'Music.FLAC', documents: 'Report.PDF', archives: 'backup.TAR.GZ' })) {
    const query = categoryQuery(category), pattern = new RegExp(query.name, 'i')
    assert.ok(pattern.test(name)); assert.ok(!pattern.test(name + '.exe'))
    assert.equal(query.kind, 'file'); assert.equal(query.recursive, true); assert.equal(query.archives, false); assert.equal(query.text, '')
  }
})

test('canonical category results are valid nested file-operation sources', () => {
  const source = { ...location, path: '/storage/emulated/0' }
  const plan = { action: 'copy', source, destination: { kind: 'local', path: 'D:\\Backup' }, confirmed: true, conflict: 'ask', items: [{ path: source.path + '/DCIM/photo.jpg', fingerprint: 'known' }] }
  assert.doesNotThrow(() => validateFilePlan(plan))
  assert.throws(() => validateFilePlan({ ...plan, source: { ...source, path: '/sdcard' } }), /outside/)
})

test('folder shortcuts add relative rules, retain previous rules and deduplicate Windows paths', () => {
  const scope = { kind: 'local', path: 'D:\\Photos\\' }
  const previous = { include: ['Keep'], exclude: ['Private'] }
  const result = appendCategoryFolders(scope, previous, 'exclude', ['d:/photos/private', 'D:\\Photos\\Trip', 'D:\\Photos\\TRIP'])
  assert.deepEqual(result, { include: ['Keep'], exclude: ['Private', 'Trip'] })
  assert.deepEqual(previous, { include: ['Keep'], exclude: ['Private'] })
  assert.deepEqual(appendCategoryFolders(scope, result, 'include', ['D:\\Photos\\Trip']), { include: ['Keep', 'Trip'], exclude: ['Private', 'Trip'] }, 'existing exclusions remain explicit and take priority')
  assert.deepEqual(relativeCategoryFolders({ kind: 'local', path: '\\\\NAS\\Media' }, ['\\\\nas\\media\\Music\\Live']), ['Music/Live'])
  assert.deepEqual(relativeCategoryFolders({ kind: 'local', path: 'D:\\' }, ['D:\\Pictures']), ['Pictures'])
})

test('phone album rules retain case and canonical relative paths without admitting other volumes or parent entries', () => {
  const scope = { ...location, path: '/storage/emulated/0' }
  assert.deepEqual(relativeCategoryFolders(scope, ['/storage/emulated/0/DCIM/Camera', '/storage/emulated/0/Pictures']), ['DCIM/Camera', 'Pictures'])
  assert.deepEqual(relativeCategoryFolders({ ...scope, path: '/sdcard' }, ['/sdcard/DCIM']), ['DCIM'])
  assert.deepEqual(appendCategoryFolders(scope, undefined, 'include', ['/storage/emulated/0/Pictures', '/storage/emulated/0/pictures']), { include: ['Pictures', 'pictures'], exclude: [] })
  for (const path of ['/storage/emulated/0', '/storage/emulated/01/Pictures', '/storage/SD/Pictures', '/storage/emulated/0/../private', '/storage/emulated/0/ name ']) assert.throws(() => relativeCategoryFolders(scope, [path]))
  assert.throws(() => relativeCategoryFolders({ kind: 'local', path: 'D:\\Photos' }, ['D:\\Photos2\\Private']))
  assert.throws(() => relativeCategoryFolders(scope, []))
})
