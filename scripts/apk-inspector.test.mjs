import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readdir, readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createApkFixtures } from './fixtures/apk-inspector.mjs'
import { ApkInspectorService } from '../dist-electron/apk-inspector.js'
import { compareApks, validateInspectorRequest } from '../dist-electron/apk-inspector-protocol.js'
import { verifyApk, parseApkSignature } from '../dist-electron/apk-inspector-tools.js'
import { inspectApkContents } from '../dist-electron/apk-inspector-worker.js'
import { inspectManifest } from '../dist-electron/apk-manifest.js'
import { inspectDex } from '../dist-electron/apk-dex.js'
let fixtures, a, b
before(async () => { fixtures = await createApkFixtures() })
const wait = async service => { const start = Date.now(); while (service.busy) { if (Date.now() - start > 110000) throw new Error('Inspector timed out in test.'); await new Promise(r => setTimeout(r, 20)) } }
test('signed APKs: offline inspection, definitions, addresses, signatures, version comparison, immutable sources', async () => {
  const original = createHash('sha256').update(await readFile(fixtures.before)).digest('hex')
  const service = new ApkInspectorService(path.join(fixtures.root, 'profile'), () => undefined, () => {})
  service.open('before', fixtures.before); service.open('after', fixtures.after)
  await wait(service)
  assert.equal(service.state.before.status, 'ready', service.state.before.message)
  assert.equal(service.state.after.status, 'ready', service.state.after.message)
  a = service.state.before.result; b = service.state.after.result
  assert.equal(a.label, 'Inspector Fixture 1'); assert.equal(b.label, 'Inspector Fixture 2')
  assert.equal(a.signature.status, 'verified', a.signature.diagnostics)
  assert.equal(a.signature.signers.length, 1); assert.equal(a.signature.signers[0].sha256, b.signature.signers[0].sha256)
  assert.ok(a.signature.schemes.some(s => s.startsWith('v2')))
  assert.equal(a.manifest.packageName, 'dev.adbvault.inspectorfixture')
  assert.equal(a.manifest.components[0].name, 'dev.adbvault.inspectorfixture.MainActivity')
  assert.equal(a.manifest.components[0].attributes['android:exported'], 'true')
  assert.equal(a.analysis.classes, 1); assert.equal(a.analysis.status, 'complete')
  assert.ok(a.analysis.trackers.length + a.analysis.libraries.length > 0)
  assert.ok(a.analysis.addresses.domains.some(d => d.value === 'old.example.org'))
  assert.ok(a.analysis.addresses.domains.some(d => d.value === 'fixture.example.com'))
  assert.deepEqual(a.abis, ['armeabi-v7a']); assert.deepEqual(b.abis, ['arm64-v8a'])
  assert.equal(a.sha256, original); assert.equal(createHash('sha256').update(await readFile(fixtures.before)).digest('hex'), original)
  const diff = compareApks(a, b)
  assert.ok(diff.some(c => c.group === 'Permissions' && c.name === 'android.permission.CAMERA' && c.status === 'added'))
  assert.ok(diff.some(c => c.group === 'Permissions' && c.name === 'android.permission.READ_CONTACTS' && c.status === 'removed'))
  assert.ok(diff.some(c => c.group === 'Components' && c.name.includes('MainActivity') && c.before.includes('true') && c.after.includes('false')))
  assert.ok(diff.some(c => c.group === 'Components' && c.name.includes('NewService') && c.status === 'added'))
  assert.ok(diff.some(c => c.group === 'Metadata' && c.name === 'targetSdk' && c.before === '33' && c.after === '35'))
  assert.ok(diff.some(c => c.group === 'Domains' && c.name === 'new.example.org' && c.status === 'added'))
  assert.equal(compareApks(a, structuredClone(a)).length, 0)
  const specialEntry = { ...b, entries: [...b.entries, { name: 'toString', bytes: 1, compressed: 1, crc32: 1 }] }
  assert.equal(compareApks(a, specialEntry).find(c => c.name === 'toString').status, 'added')
  assert.deepEqual(await readdir(path.join(fixtures.root, 'profile/apk-inspector')), [])
  service.swap(); assert.equal(service.state.before.result.sha256, b.sha256)
  service.clear('after'); assert.equal(service.state.after.status, 'empty')
  await service.shutdown(); assert.throws(() => service.open('before', fixtures.before), /closing/)
})
test('unsigned, tampered, rotated signing key, and unavailable verifier are distinct', async () => {
  const tools = path.resolve('inspector-tools'), signal = new AbortController().signal
  const unsigned = await verifyApk(fixtures.unsigned, tools, signal), tampered = await verifyApk(fixtures.tampered, tools, signal), rotated = await verifyApk(fixtures.rotated, tools, signal), missing = await verifyApk(fixtures.before, path.join(fixtures.root, 'absent-tools'), signal)
  assert.equal(unsigned.status, 'invalid'); assert.equal(tampered.status, 'invalid'); assert.equal(rotated.status, 'verified'); assert.equal(missing.status, 'unavailable')
  assert.notEqual(rotated.signers[0].sha256, a.signature.signers[0].sha256)
  assert.ok(compareApks(a, { ...b, signature: rotated }).some(c => c.group === 'Signature' && c.status === 'added'))
  const contents = await inspectApkContents(fixtures.tampered); assert.equal(contents.manifest.packageName, a.manifest.packageName)
  assert.equal(parseApkSignature(1, 'Signer #1 certificate SHA-256 digest: ' + 'a'.repeat(64), 'ERROR').status, 'invalid')
})
test('cancellation, conflicting slot operations and corrupt archives finish with cleanup', async () => {
  const service = new ApkInspectorService(path.join(fixtures.root, 'cancel-profile'), () => undefined, () => {})
  service.open('before', fixtures.before)
  assert.throws(() => service.open('before', fixtures.after), /Cancel/); assert.throws(() => service.swap(), /Wait/); assert.throws(() => service.clear('before'), /Cancel/)
  service.cancel('before'); await wait(service)
  assert.equal(service.state.before.status, 'error'); assert.match(service.state.before.message, /cancelled/)
  service.open('before', fixtures.malformed); await wait(service)
  assert.equal(service.state.before.status, 'error'); assert.equal(service.state.before.result, null)
  assert.deepEqual(await readdir(path.join(fixtures.root, 'cancel-profile/apk-inspector')), [])
  service.open('after', fixtures.before); await service.shutdown(); assert.equal(service.busy, false)
})
test('bounded parsers and request validation reject malformed input', async () => {
  assert.throws(() => inspectManifest(Buffer.alloc(32)), /manifest/)
  assert.throws(() => inspectDex(Buffer.alloc(112), () => {}), /DEX/)
  for (const r of [{ type: 'inspector.open', slot: 'evil' }, { type: 'inspector.open', slot: 'before', path: '\0.apk' }, { type: 'inspector.clear', slot: undefined }]) assert.throws(() => validateInspectorRequest(r))
  const service = new ApkInspectorService(fixtures.root, () => undefined, () => {})
  assert.throws(() => service.open('before', 'relative.apk'), /local/)
  assert.throws(() => service.open('before', path.join(fixtures.root, 'archive.apks')), /local/)
  assert.ok((await stat(fixtures.before)).size > 1000)
})
