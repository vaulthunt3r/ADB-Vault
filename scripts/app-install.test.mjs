import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { AppRestoreService } from '../dist-electron/app-restore.js'
import { openRestoreZip } from '../dist-electron/restore-zip.js'
import { manifest, zip } from './restore-fixture.mjs'
import { FileIO } from '../dist-electron/files.js'
import { prepareFileInstallSource, validateFileInstallSelection } from '../dist-electron/file-install.js'

const apk = (pkg, split = '', version = 7) => zip([['AndroidManifest.xml', manifest(pkg, version, split)]])
test('case-distinct APK resources survive direct and APKS install verification byte-for-byte', async t => {
  const resources = [['res/A.xml', Buffer.from('upper')], ['res/a.xml', Buffer.from('lower')]]
  const single = await zip([['AndroidManifest.xml', manifest('org.example.single')], ...resources])
  const base = await zip([['AndroidManifest.xml', manifest('org.example.split')], ...resources])
  const split = await zip([['AndroidManifest.xml', manifest('org.example.split', 7, 'config.en')], ...resources])
  const seen = []
  const f = await fixture(t, { files: [['Single.apk', single], ['Split.apks', await zip([['base.apk', base], ['split.apk', split]])]], runner: async args => {
    for (const file of args.slice(6)) seen.push(await readFile(file))
    return { code: 0, stdout: 'Success', stderr: '' }
  } })
  await f.open(); assert.equal(f.service.state.status, 'choosing'); await f.install(); assert.equal(f.service.state.status, 'success')
  assert.deepEqual(seen, [single, base, split])
  const reader = await openRestoreZip(f.paths[0], undefined, 'apk')
  try { assert.equal((await reader.buffer('res/A.xml', 10)).toString(), 'upper'); assert.equal((await reader.buffer('res/a.xml', 10)).toString(), 'lower') } finally { reader.close() }
  await assert.rejects(openRestoreZip(f.paths[0]), /duplicate entry name/)
})
test('APK reader still rejects exact duplicate resources and duplicate manifests', async t => {
  for (const name of ['res/a.xml', 'AndroidManifest.xml']) {
    const entries = name === 'AndroidManifest.xml' ? [[name, manifest('org.example.bad')], [name, manifest('org.example.other')]] : [['AndroidManifest.xml', manifest('org.example.bad')], [name, Buffer.from('one')], [name, Buffer.from('two')]]
    const f = await fixture(t, { files: [['Bad.apk', await zip(entries)]] }); await f.open()
    assert.equal(f.service.state.status, 'error'); assert.match(f.service.state.message, /duplicate entry name/); assert.equal(f.calls.length, 0)
  }
})
async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'adb-vault-install-test-')), paths = [], calls = [], refreshed = []
  for (const [name, data] of options.files || [['Alpha.apk', await apk('org.example.alpha')], ['Beta.apks', await zip([['nested/main.apk', await apk('org.example.beta')], ['nested/config.apk', await apk('org.example.beta', 'config.en')]])]]) {
    const file = path.join(root, name); await writeFile(file, data); paths.push(file)
  }
  const connection = { activeDeviceId: 'phone', devices: [{ id: 'phone', name: 'Phone', serial: 'serial', transportId: '7', hardwareId: 'hardware', status: 'connected' }] }
  const apps = { deviceId: 'phone', userId: 11, status: 'ready', profiles: [{ id: 11, name: 'Work' }], apps: [], options: { root: false } }
  let confirmed = true, confirmations = 0
  const service = new AppRestoreService(() => 'adb', () => connection, () => apps, state => options.publish?.(state, service), {
    file: async () => null, installFiles: async () => options.cancelPicker ? null : paths,
    confirm: async s => { confirmations++; await options.confirm?.(s, service, connection); return confirmed },
  }, async (...args) => refreshed.push(args), async (_exe, args) => { calls.push(args); return options.runner ? options.runner(args, calls.length) : { code: 0, stdout: 'Success', stderr: '' } })
  t.after(async () => { await service.shutdown(); await rm(root, { recursive: true, force: true }) })
  return { service, calls, refreshed, paths, connection, confirmations: () => confirmations, cancel: () => { confirmed = false }, open: () => service.open('phone', 11, true), install: () => service.restoreBatch({ packages: service.state.applications.map(a => a.packageName), components: ['apk'] }) }
}
async function fileSelection(f) {
  const io = new FileIO(() => null, () => ({ devices: [] }))
  const source = { kind: 'local', path: path.dirname(f.paths[0]) }
  const items = await Promise.all(f.paths.map(async file => ({ path: file, fingerprint: (await io.stat({ ...source, path: file })).fingerprint })))
  return { io, selection: { source, items } }
}

test('Files selected APK/APKS bypass the picker and reuse the confirmed profile installation queue', async t => {
  const f = await fixture(t, { cancelPicker: true }), { io, selection } = await fileSelection(f)
  await f.service.open('phone', 11, true, (signal, progress) => prepareFileInstallSource(io, selection, 11, signal, progress))
  assert.equal(f.service.state.status, 'choosing'); assert.equal(f.calls.length, 0)
  assert.deepEqual(f.service.state.applications.map(a => a.label), ['Alpha.apk', 'Beta.apks'])
  await f.install(); assert.equal(f.service.state.status, 'success'); assert.equal(f.confirmations(), 1)
  assert.deepEqual(f.calls.map(c => c.slice(0, 6)), [['-t', '7', 'install', '--user', '11', '-r'], ['-t', '7', 'install-multiple', '--user', '11', '-r']])
})

test('Files rejects stale fingerprints and invalid selections before installing', async t => {
  const f = await fixture(t), { io, selection } = await fileSelection(f)
  assert.throws(() => validateFileInstallSelection({ ...selection, items: [] }), /1–500/)
  assert.throws(() => validateFileInstallSelection({ ...selection, items: [selection.items[0], selection.items[0]] }), /Duplicate/)
  assert.throws(() => validateFileInstallSelection({ ...selection, items: [{ ...selection.items[0], path: path.join(selection.source.path, 'Notes.txt') }] }), /only APK/)
  assert.throws(() => validateFileInstallSelection({ ...selection, items: [{ ...selection.items[0], path: path.join(selection.source.path, '..', 'outside.apk') }] }), /outside/)
  await writeFile(f.paths[0], 'changed')
  await f.service.open('phone', 11, true, (signal, progress) => prepareFileInstallSource(io, selection, 11, signal, progress))
  assert.equal(f.service.state.status, 'error'); assert.match(f.service.state.message, /changed since selection/); assert.equal(f.calls.length, 0)
})

for (const scenario of ['success', 'cancel', 'changed transport', 'incomplete transfer']) test(`Files phone preparation: ${scenario}; originals retained and temporary downloads removed`, async t => {
  const f = await fixture(t, { cancelPicker: true }), { io: localIO, selection: local } = await fileSelection(f)
  const source = { kind: 'device', path: '/sdcard/Download', id: 'source', serial: 'SOURCE', transportId: '18' }
  const items = local.items.map(i => ({ ...i, path: source.path + '/' + path.basename(i.path) }))
  const originals = await Promise.all(f.paths.map(p => readFile(p))), downloads = []
  let transport = '18'
  const io = {
    stat: async (location, signal) => {
      signal?.throwIfAborted()
      if (location.kind === 'local') return localIO.stat(location, signal)
      if (location.transportId !== transport) throw new Error('The phone connection changed.')
      const index = items.findIndex(i => i.path === location.path)
      const entry = await localIO.stat({ kind: 'local', path: f.paths[index] }, signal)
      return { ...entry, path: location.path }
    },
    transfer: async (from, to, signal, progress) => {
      downloads.push(to.path)
      const index = items.findIndex(i => i.path === from.path)
      if (scenario === 'cancel') { f.service.cancel(); signal.throwIfAborted() }
      await localIO.transfer({ kind: 'local', path: f.paths[index] }, to, signal, progress)
      progress(80) // Binary completion frame is removed by FileIO before the final size check.
      if (scenario === 'changed transport') transport = '19'
      if (scenario === 'incomplete transfer') await writeFile(to.path, 'short')
    },
  }
  await f.service.open('phone', 11, true, (signal, progress) => prepareFileInstallSource(io, { source, items }, 11, signal, progress))
  if (scenario === 'success') { assert.equal(f.service.state.status, 'choosing'); assert.equal(f.calls.length, 0); await f.install(); assert.equal(f.service.state.status, 'success') }
  else { assert.equal(f.service.state.status, scenario === 'cancel' ? 'cancelled' : 'error'); assert.equal(f.calls.length, 0) }
  assert.ok(downloads.length)
  for (const file of downloads) await assert.rejects(readFile(file), /ENOENT/)
  assert.deepEqual(await Promise.all(f.paths.map(p => readFile(p))), originals)
})

test('mixed standalone APK and nested APKS normalize without manifests and install full sets for the confirmed profile', async t => {
  const f = await fixture(t); await f.open()
  assert.equal(f.service.state.sourceKind, 'install'); assert.equal(f.service.state.status, 'choosing'); assert.equal(f.calls.length, 0)
  assert.deepEqual(f.service.state.applications.map(a => a.label), ['Alpha.apk', 'Beta.apks'])
  const source = f.service.state.source
  await f.install(); assert.equal(f.service.state.status, 'success'); assert.equal(f.confirmations(), 1)
  assert.deepEqual(f.calls.map(c => c.slice(0, 6)), [['-t', '7', 'install', '--user', '11', '-r'], ['-t', '7', 'install-multiple', '--user', '11', '-r']])
  assert.equal(f.calls[1].length, 8); assert.equal(f.refreshed.length, 2)
  await f.service.shutdown(); await assert.rejects(readFile(source), /ENOENT/)
  assert.ok((await readFile(f.paths[0])).length)
})
test('picker and confirmation cancellation issue no ADB calls', async t => {
  const picker = await fixture(t, { cancelPicker: true }); await picker.open(); assert.equal(picker.service.state.status, 'cancelled'); assert.equal(picker.calls.length, 0)
  const f = await fixture(t); await f.open(); f.cancel(); await f.install(); assert.equal(f.service.state.status, 'cancelled'); assert.equal(f.calls.length, 0)
})
test('staged selection is isolated from changes to original files', async t => {
  const f = await fixture(t); await f.open(); await writeFile(f.paths[0], 'changed original'); await f.install(); assert.equal(f.service.state.status, 'success')
})
test('changed private artifact fails verification before its installation and other apps continue', async t => {
  const f = await fixture(t); await f.open(); await writeFile(path.join(path.dirname(f.service.state.source), '0.apk'), 'tampered'); await f.install()
  assert.equal(f.service.state.status, 'partial'); assert.equal(f.calls.length, 1); assert.equal(f.calls[0][2], 'install-multiple')
})
test('known Android rejection continues queue, retry excludes successful application', async t => {
  const f = await fixture(t, { runner: (_args, n) => n === 1 ? { code: 1, stdout: 'Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]', stderr: '' } : { code: 0, stdout: 'Success', stderr: '' } })
  await f.open(); await f.install(); assert.equal(f.service.state.status, 'partial'); assert.equal(f.calls.length, 2)
  await f.service.retryBatch(); assert.equal(f.service.state.status, 'success'); assert.equal(f.calls.length, 3); assert.equal(f.calls[2][2], 'install')
})
test('stop finishes the current app and leaves remaining apps available for retry', async t => {
  const f = await fixture(t, { publish: (s, service) => { if (s.status === 'batch' && s.batch.items.some(i => i.status === 'running') && !s.batch.stopRequested) service.cancel() } })
  await f.open(); await f.install(); assert.equal(f.calls.length, 1); assert.deepEqual(f.service.state.batch.items.map(i => i.status), ['success', 'cancelled'])
})
test('transport error stops queue and uncertain current application is not retried', async t => {
  const f = await fixture(t, { runner: () => ({ code: 1, stdout: '', stderr: 'error: device offline' }) })
  await f.open(); await f.install(); assert.equal(f.calls.length, 1); assert.equal(f.service.state.batch.items[0].uncertain, true); assert.equal(f.service.state.batch.items[1].status, 'cancelled')
})
test('target transport change at confirmation prevents installation', async t => {
  const f = await fixture(t, { confirm: (_s, _svc, c) => { c.devices[0].transportId = '8' } }); await f.open(); await f.install(); assert.equal(f.calls.length, 0); assert.equal(f.service.state.status, 'error')
})
for (const kind of ['lone split', 'duplicate package', 'mixed versions', 'no base', 'duplicate split', 'bundletool', 'invalid manifest']) test(`${kind} rejected during local preview`, async t => {
  const base = await apk('org.example.alpha'), split = await apk('org.example.alpha', 'config.en')
  const files = kind === 'lone split' ? [['Split.apk', split]] : kind === 'duplicate package' ? [['One.apk', base], ['Two.apk', base]] : kind === 'invalid manifest' ? [['Bad.apk', await zip([['AndroidManifest.xml', Buffer.from('not axml')]])]] : [['Bad.apks', await zip(kind === 'bundletool' ? [['toc.pb', Buffer.from('metadata')], ['base.apk', base]] : kind === 'no base' ? [['config.apk', split]] : kind === 'duplicate split' ? [['base.apk', base], ['one.apk', split], ['two.apk', split]] : [['base.apk', base], ['config.apk', await apk('org.example.alpha', 'config.en', 8)]])]]
  const f = await fixture(t, { files }); await f.open(); assert.equal(f.service.state.status, 'error'); assert.equal(f.calls.length, 0); assert.equal(f.service.state.applications.length, 0)
})
