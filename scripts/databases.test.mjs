import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp, cp } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { DatabaseService, loadDatabase, bundledDatabaseDirectory } from '../dist-electron/databases.js'
import { databaseFiles, parseDatabase, SignatureMatcher } from '../dist-electron/signature-database.js'
import { parseScan, analyzeInventory, analyzeApks } from '../dist-electron/apk-analysis.js'
import { analyzeAddresses } from '../dist-electron/apk-addresses.js'
import { collectTrackerBadges } from '../dist-electron/app-badges.js'
const db = await loadDatabase(bundledDatabaseDirectory)
const files = Object.fromEntries(await Promise.all(Object.keys(databaseFiles).map(async name => [name, await readFile(path.join(bundledDatabaseDirectory, name), 'utf8')])) )
test('Official snapshot validates every database, Android escapes and ETIP markers', () => {
  assert.deepEqual([db.trackers.length, db.libraries.length, db.native.length, db.bloatware.length, db.suggestions.length], [989, 3829, 211, 4801, 46])
  assert.ok(db.trackers.some(t => t.name === '²ACRA'))
  const native = db.native.find(n => n.signature.includes('libjiagu'))
  assert.ok(new RegExp(native.signature).test('libjiagu_a64.so'))
  assert.ok(!new RegExp(native.signature).test('libjiaguXa64xso'))
  assert.throws(() => parseDatabase({ ...files, 'trackers.xml': '<!DOCTYPE x><resources/>' }, db.revision))
  assert.throws(() => parseDatabase({ ...files, 'trackers.xml': files['trackers.xml'].replace('<item>com.threesixtydialog.sdk.</item>', '') }, db.revision))
})
test('Literal matcher supports overlaps, substring matches, punctuation and deduplicates occurrences', () => {
  const matcher = new SignatureMatcher(['ab', 'bc', 'abc', '.sdk.', 'lib+'].map(signature => ({ signature, name: signature })))
  assert.deepEqual(matcher.search('abcabc').sort(), [0, 1, 2])
  assert.deepEqual(matcher.search('prefix.sdk.Class'), [3]); assert.deepEqual(matcher.search('lib+'), [4])
})
test('Manifest matches deduplicate class names across component types; bloatware uses exact package IDs', () => {
  const data = { packageName: 'com.android.browser', badges: {}, components: [{ name: 'org.acra.sender.SenderService', type: 'Service', enabled: false }, { name: 'org.acra.sender.SenderService', type: 'Activity', enabled: true }] }
  collectTrackerBadges(data, db)
  assert.equal(data.badgeChecks.trackers.items.length, 1); assert.equal(data.badges.trackersBlocked, false)
  assert.equal(data.badgeChecks.bloatware.present, true); assert.ok(data.badgeChecks.bloatware.items.some(i => i.name.startsWith('Alternative:')))
  data.packageName += '.extra'; collectTrackerBadges(data, db); assert.equal(data.badgeChecks.bloatware.present, false)
  collectTrackerBadges(data); assert.equal(data.badgeChecks.trackers.present, null)
})
const inventory = () => ({ type: 'scan', protocolVersion: 1, packageName: 'org.example.app', userId: 10, uid: 1010001, classes: ['org.acra.A', 'org.acra.A', 'com.example.Other'], native: [{ apk: '/base.apk', path: 'lib/arm64-v8a/libjiagu_a64.so' }, { apk: '/split.apk', path: 'lib/armeabi-v7a/libjiagu_a64.so' }, { apk: '/base.apk', path: 'lib/arm64-v8a/libunknown.so' }], artifacts: [{ path: '/base.apk', dexFiles: 1, classes: 2, complete: true, errors: [] }, { path: '/split.apk', dexFiles: 0, classes: 0, complete: false, errors: ['classes.dex: denied'] }] })
test('DEX and native analysis keeps partial coverage, class deduplication, ABI evidence and unknown files', () => {
  const value = parseScan(JSON.stringify(inventory()), 'org.example.app', 10), result = analyzeInventory(value, db)
  assert.equal(result.status, 'partial'); assert.equal(result.classes, 2)
  assert.equal(result.trackers.find(t => t.name === '²ACRA').count, 1)
  assert.ok(result.native.some(n => n.items.length === 2)); assert.deepEqual(result.unidentifiedNative, ['libunknown.so'])
  assert.throws(() => parseScan(JSON.stringify(inventory()), 'org.example.app', 0))
  const invalid = inventory(); invalid.artifacts[1].complete = true
  assert.throws(() => parseScan(JSON.stringify(invalid), 'org.example.app', 10))
})
test('Signature analysis works in its worker and supports cancellation', async () => {
  const result = await analyzeApks(JSON.stringify(inventory()), 'org.example.app', 10, db, new AbortController().signal)
  assert.equal(result.status, 'partial')
  const controller = new AbortController(); controller.abort()
  await assert.rejects(analyzeApks('{}', 'org.example.app', 10, db, controller.signal), /cancelled/)
})
test('Native detection also covers .so files in assets with explicit ELF evidence', () => {
  const value = inventory(); value.native = [{ apk: '/base.apk', path: 'assets/engine/libjiagu_a64.so', elf: 'ELF64 · AArch64' }]
  const result = analyzeInventory(parseScan(JSON.stringify(value), 'org.example.app', 10), db)
  assert.ok(result.native.some(n => n.items.some(item => item.includes('assets/engine/libjiagu_a64.so · ELF64 · AArch64'))))
})

test('APK addresses normalize and deduplicate hosts/URLs with evidence across splits, without accepting namespaces or file names', () => {
  const source = { apk: '/base.apk', entry: 'classes.dex' }, split = { apk: '/split.apk', entry: 'assets/config.json' }
  const candidates = [
    ['https://API.example.com/v1?q=1', source], ['https://api.example.com/v1?q=1', split],
    ['api.example.com', source], ['*.cdn.example.org.', split], ['https://пример.рф/путь', source],
    ['https://127.0.0.1:8000/local', source], ['http://[::1]/', split], ['http://localhost:1234/a', source],
    ['https://archive.zip/', split], ['archive.zip', source], ['android.permission.CAMERA', source], ['com.google.android', source],
    ['org.example.app', source], ['resources.arsc', source], ['javascript:alert(1)', source], ['https://bad.invalidtld/', source],
    ['https://example.com/path).', source], ['https://example.com/a(b)', source], ['https://example.com/%3Cscript%3E', source],
  ].map(([value, file]) => ({ value, sources: [file] }))
  const result = analyzeAddresses({ candidates, files: 4, issues: [] }, false)
  assert.equal(result.status, 'complete')
  assert.deepEqual(result.domains.map(d => d.value), ['api.example.com', 'archive.zip', 'cdn.example.org', 'example.com', 'xn--e1afmkfd.xn--p1ai'])
  assert.equal(result.urls.find(u => u.value === 'https://api.example.com/v1?q=1').sources.length, 2)
  assert.equal(result.domains.find(u => u.value === 'api.example.com').sources.length, 2)
  assert.ok(result.urls.some(u => u.value === 'https://example.com/path'))
  assert.ok(result.urls.some(u => u.value === 'https://example.com/a(b)'))
  assert.ok(result.urls.some(u => u.value === 'http://[::1]/'))
  assert.ok(result.urls.some(u => u.value.includes('xn--e1afmkfd')))
})

test('address protocol validates provenance and bounds; partial coverage and older helpers remain explicit', () => {
  const value = inventory(); value.artifacts[1].complete = true; value.artifacts[1].errors = []
  value.addresses = { files: 2, issues: [], candidates: [{ value: 'https://api.example.com/', sources: [{ apk: '/split.apk', entry: 'resources.arsc' }] }] }
  const result = analyzeInventory(parseScan(JSON.stringify(value), value.packageName, value.userId), db)
  assert.equal(result.addresses.status, 'complete'); assert.equal(result.status, 'complete')
  for (const mutate of [
    v => { v.addresses.candidates[0].sources[0].apk = '/not-inspected.apk' },
    v => { v.addresses.candidates[0].sources = [] },
    v => { v.addresses.candidates[0].value = 'https://a.com/\n' },
    v => { v.addresses.candidates = Array(2001).fill(v.addresses.candidates[0]) },
    v => { v.addresses.files = -1 },
  ]) {
    const invalid = structuredClone(value); mutate(invalid)
    assert.throws(() => parseScan(JSON.stringify(invalid), value.packageName, value.userId), /address scan/)
  }
  value.addresses.issues = ['Resource scan byte limit reached.']; value.addresses.candidates = []
  const limited = analyzeInventory(parseScan(JSON.stringify(value), value.packageName, value.userId), db)
  assert.equal(limited.status, 'partial'); assert.equal(limited.addresses.status, 'partial'); assert.equal(limited.addresses.urls.length, 0)
  const incomplete = analyzeAddresses({ files: 0, candidates: [], issues: [] }, true)
  assert.equal(incomplete.status, 'partial'); assert.match(incomplete.issues[0], /missing/)
  assert.equal(analyzeInventory(parseScan(JSON.stringify(inventory()), 'org.example.app', 10), db).addresses, undefined)
})
test('APK size protocol preserves exact per-file totals and rejects inconsistent or unsafe sums', async () => {
  const value = inventory()
  for (const a of value.artifacts) { a.complete = true; a.errors = []; a.size = { bytes: 100, categories: { code: 20, native: 30, resources: 25, assets: 10, other: 15 } } }
  const result = await analyzeApks(JSON.stringify(value), value.packageName, value.userId, db, new AbortController().signal)
  assert.equal(result.status, 'complete'); assert.deepEqual(result.artifacts.map(a => a.size), value.artifacts.map(a => a.size))
  for (const mutate of [
    v => { v.artifacts[0].size.bytes = -1 }, v => { v.artifacts[0].size.bytes = null },
    v => { v.artifacts[0].size.categories.code = 21 }, v => { v.artifacts[0].size.categories.code = 19.5 },
    v => { v.artifacts[0].size.categories.extra = 0 }, v => { delete v.artifacts[0].size.categories.assets },
    v => { v.artifacts[0].size.categories = null }, v => { v.artifacts[0].size.error = 'Error with supposedly complete categories' },
    v => { v.artifacts[1].path = v.artifacts[0].path },
    v => { for (const a of v.artifacts) a.size = { bytes: Number.MAX_SAFE_INTEGER, categories: { code: 0, native: 0, resources: 0, assets: 0, other: Number.MAX_SAFE_INTEGER } } },
  ]) {
    const invalid = structuredClone(value); mutate(invalid)
    assert.throws(() => parseScan(JSON.stringify(invalid), value.packageName, value.userId), /APK|Duplicate/)
  }
  value.artifacts[1].size = { bytes: 100, categories: null, error: 'Entry limit reached' }
  const partial = analyzeInventory(parseScan(JSON.stringify(value), value.packageName, value.userId), db)
  assert.equal(partial.status, 'partial'); assert.equal(partial.artifacts[1].size.categories, null)
  value.artifacts[1].size.bytes = null
  assert.equal(parseScan(JSON.stringify(value), value.packageName, value.userId).artifacts[1].size.bytes, null)
  assert.equal(analyzeInventory(parseScan(JSON.stringify(inventory()), value.packageName, value.userId), db).artifacts[0].size, undefined)
})

test('Database updates validate atomically, preserve last good snapshot, persist and restore bundled data', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'adb-database-test-'))
  const revision = 'a'.repeat(40); let fail = false
  const fetcher = async url => {
    if (url.includes('/commits/')) return JSON.stringify({ sha: revision })
    const file = url.split('/').at(-1)
    if (fail && file === 'libs.xml') return '<broken>'
    return file === 'trackers.xml' ? files[file].replace('com.threesixtydialog.sdk.', 'com.threesixtydialog.test.') : files[file]
  }
  const service = new DatabaseService(root, () => {}, fetcher); await service.initialize()
  const old = service.data
  fail = true; await assert.rejects(service.action('db-trackers', 'install')); assert.equal(service.data, old); assert.equal(service.records[0].status, 'Installed')
  fail = false; await service.action('db-trackers', 'detect'); assert.equal(service.records[0].status, 'Update available'); assert.equal(service.data, old)
  await service.action('db-libraries', 'install'); assert.equal(service.data.revision, revision)
  const reload = new DatabaseService(root, () => {}, fetcher); await reload.initialize(); assert.equal(reload.data.revision, revision)
  await reload.action('db-bloatware', 'repair'); assert.equal(reload.data.revision, db.revision)
  const restored = new DatabaseService(root, () => {}, fetcher); await restored.initialize(); assert.equal(restored.data.revision, db.revision); assert.doesNotMatch(restored.records[0].message, /could not/)
})
test('Unrelated upstream commits do not report data updates, corruption cannot pass integrity verification', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'adb-db-integrity-'))
  const service = new DatabaseService(root, () => {}, async url => url.includes('/commits/') ? JSON.stringify({ sha: 'b'.repeat(40) }) : files[url.split('/').at(-1)])
  await service.initialize(); await service.action('db-native', 'detect'); assert.equal(service.records[0].status, 'Installed'); assert.equal(service.data.revision, db.revision)
  const copy = path.join(root, 'copy'); await cp(bundledDatabaseDirectory, copy, { recursive: true }); await writeFile(path.join(copy, 'libs.xml'), '<changed/>')
  await assert.rejects(loadDatabase(copy), /integrity/)
})
