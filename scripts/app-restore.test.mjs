import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, rm, readdir } from 'node:fs/promises'
import path from 'node:path'
import { AppRestoreService, parseBackupReport, validateRestoreBatch } from '../dist-electron/app-restore.js'
import { canRetryRestore } from '../dist-electron/app-restore-protocol.js'
import { readApkIdentity } from '../dist-electron/apk-identity.js'
import { openRestoreZip } from '../dist-electron/restore-zip.js'
import { backupFixture, zip, sha, manifest, tar } from './restore-fixture.mjs'

async function fixture(t, options = {}) {
  const f = await backupFixture(options), calls = [], refreshed = [], events = []
  const connection = { activeDeviceId: 'phone', devices: [{ id: 'phone', name: 'Target phone', serial: 'serial', transportId: '7', hardwareId: 'hardware', status: 'connected' }] }
  const apps = { deviceId: 'phone', userId: 11, status: 'ready', profiles: [{ id: 11, name: 'Work' }], apps: [] }
  let confirm = true, selected = f.manifestPath
  const service = new AppRestoreService(() => 'adb.exe', () => connection, () => apps, s => { events.push(s); options.publish?.(s, service) }, {
    file: async () => selected, confirm: async s => { options.confirm?.(s); return confirm },
  }, async (...args) => { refreshed.push(args); if (options.refreshError) throw new Error('disconnected') }, async (_adb, args, _timeout, _input, _env, controls) => { calls.push(args); return options.runner ? options.runner(args, controls) : { code: 0, stdout: 'Performing Streamed Install\nSuccess', stderr: '' } })
  t.after(async () => { await service.shutdown(); await rm(f.root, { recursive: true, force: true }) })
  return { ...f, service, calls, refreshed, events, apps, connection, setConfirm: v => { confirm = v }, setFile: v => { selected = v }, open: () => service.open('phone', 11), prepare: () => service.prepare('org.example.notes') }
}
test('binary manifest reads UTF-8 and UTF-16 identity and rejects malformed sizes', () => {
  for (const utf8 of [true, false]) assert.deepEqual(readApkIdentity(manifest('org.example.test', 42, 'config.en', utf8)), { packageName: 'org.example.test', versionCode: 42, split: 'config.en' })
  const broken = manifest(); broken.writeUInt32LE(0xffffffff, 12); assert.throws(() => readApkIdentity(broken), /manifest/)
})
test('single APK is verified locally, installs only after confirmation and refreshes one package', async t => {
  const f = await fixture(t); await f.open(); await f.prepare()
  assert.equal(f.service.state.status, 'ready'); assert.equal(f.calls.length, 0); assert.equal(f.service.state.apkCount, 1)
  await f.service.install(f.service.state.token)
  assert.equal(f.service.state.status, 'success'); assert.deepEqual(f.calls[0].slice(0, 6), ['-t', '7', 'install', '--user', '11', '-r']); assert.equal(f.calls.length, 1)
  assert.deepEqual(f.refreshed, [['phone', 11, 'org.example.notes']]); await assert.rejects(readFile(f.calls[0][6]), /ENOENT/)
})
test('APKS installs the full base and split set, never base alone', async t => {
  const f = await fixture(t, { split: true }); await f.open(); await f.prepare()
  assert.equal(f.service.state.status, 'ready'); assert.equal(f.service.state.apkCount, 2)
  await f.service.install(f.service.state.token)
  assert.equal(f.service.state.status, 'success'); assert.deepEqual(f.calls[0].slice(0, 6), ['-t', '7', 'install-multiple', '--user', '11', '-r']); assert.equal(f.calls[0].length, 8)
})
test('ZIP backup and older v2 manifest are supported', async t => {
  const f = await fixture(t); f.report.format = 'adb-vault-apk-backup'; f.report.version = 2; delete f.report.items[0].artifacts
  const file = path.join(f.root, 'backup.zip'); await writeFile(file, await zip([['manifest.json', Buffer.from(JSON.stringify(f.report))], [f.name, f.artifact]])); f.setFile(file)
  await f.open(); await f.prepare(); assert.equal(f.service.state.status, 'ready')
})
test('native cancellation and stale token never install', async t => {
  const f = await fixture(t); await f.open(); await f.prepare(); f.setConfirm(false)
  assert.throws(() => f.service.install('bad-token'), /Verify/)
  await f.service.install(f.service.state.token); assert.equal(f.service.state.status, 'ready'); assert.equal(f.calls.length, 0)
  const cancelledOperation = f.service.state.operationId
  assert.ok(cancelledOperation)
  await f.service.install(f.service.state.token)
  assert.notEqual(f.service.state.operationId, cancelledOperation)
  assert.equal(f.calls.length, 0)
})
for (const change of ['tamper', 'missing', 'package', 'version', 'missing split', 'extra split']) test(`${change} fails verification before installation`, async t => {
  const f = await fixture(t, { split: change.includes('split'), actualPackage: change === 'package' ? 'org.evil.app' : undefined, actualVersion: change === 'version' ? 8 : undefined })
  if (change === 'tamper') await writeFile(path.join(f.root, f.name), 'corrupted')
  if (change === 'missing') await rm(path.join(f.root, f.name))
  if (change === 'missing split') { f.report.items[0].files.pop(); await f.save() }
  if (change === 'extra split') {
    const artifact = await zip([...f.files, ['extra.apk', f.files[0][1]]]); await writeFile(path.join(f.root, f.name), artifact); Object.assign(f.report.items[0].artifacts[0], sha(artifact)); await f.save()
  }
  await f.open(); await f.prepare(); assert.equal(f.service.state.status, 'error'); assert.equal(f.calls.length, 0)
})
test('partial backup verifies completed components; data-only copy cannot install', async t => {
  const f = await fixture(t); const tar = Buffer.from('opaque test data archive')
  f.report.items[0].status = 'error'; f.report.items[0].artifacts.push({ component: 'data', file: 'Notes.data.tar', ...sha(tar) }); await writeFile(path.join(f.root, 'Notes.data.tar'), tar); await f.save()
  await f.open(); await f.prepare(); assert.equal(f.service.state.status, 'ready'); assert.deepEqual(f.service.state.verifiedComponents, ['apk', 'data'])
  f.report.items[0].artifacts.shift(); delete f.report.items[0].artifact; await f.save(); await f.open(); await f.prepare()
  assert.equal(f.service.state.status, 'ready'); assert.equal(typeof f.service.state.token, 'string'); assert.throws(() => f.service.install('anything'), /Verify/)
})
test('device/profile/transport change during confirmation aborts installation', async t => {
  let f; f = await fixture(t, { confirm: () => { f.connection.devices[0].transportId = '8' } }); await f.open(); await f.prepare(); await f.service.install(f.service.state.token)
  assert.equal(f.service.state.status, 'error'); assert.equal(f.calls.length, 0)
})
test('changed stage fails final recheck', async t => {
  let f; f = await fixture(t); await f.open(); await f.prepare(); await writeFile(f.service.staged.files[0].path, 'tampered')
  await f.service.install(f.service.state.token); assert.equal(f.service.state.status, 'error'); assert.equal(f.calls.length, 0)
})
test('verification cancellation never installs and concurrent requests are blocked', async t => {
  const f = await fixture(t, { publish: (s, service) => { if (s.status === 'verifying') service.cancel() } }); await f.open()
  const operation = f.prepare(); assert.throws(() => f.prepare(), /Wait/); await operation
  assert.equal(f.service.state.status, 'cancelled'); assert.equal(f.calls.length, 0)
})
test('Android failure, even exit zero, never triggers uninstall or downgrade', async t => {
  const f = await fixture(t, { runner: async () => ({ code: 0, stdout: 'Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]', stderr: '' }) }); await f.open(); await f.prepare(); await f.service.install(f.service.state.token)
  assert.equal(f.service.state.status, 'error'); assert.equal(f.calls.length, 1); assert.ok(!f.calls[0].includes('-d'))
})
test('timeout reports uncertain outcome and successful install survives inventory refresh failure', async t => {
  const f = await fixture(t, { runner: async () => { throw new Error('timeout') } }); await f.open(); await f.prepare(); await f.service.install(f.service.state.token)
  assert.match(f.service.state.message, /may have completed/)
  const g = await fixture(t, { refreshError: true }); await g.open(); await g.prepare(); await g.service.install(g.service.state.token)
  assert.equal(g.service.state.status, 'success'); assert.match(g.service.state.message, /Refresh applications/)
})
test('report rejects traversal, duplicate components and preset JSON', async t => {
  const f = await fixture(t); f.report.items[0].artifacts[0].file = '../escape.apk'; assert.throws(() => parseBackupReport(JSON.stringify(f.report)), /filename/)
  f.report.items[0].artifacts[0].file = f.name; f.report.items[0].artifacts.push(f.report.items[0].artifacts[0]); assert.throws(() => parseBackupReport(JSON.stringify(f.report)), /Duplicate/)
  assert.throws(() => parseBackupReport('{"format":"adb-vault-app-preset","version":1}'), /Presets/)
})
test('ZIP rejects duplicate case names and symlinks; bounded reads reject oversized entries', async t => {
  const f = await fixture(t); const file = path.join(f.root, 'bad.zip')
  await writeFile(file, await zip([['base.apk', Buffer.from('a')], ['BASE.apk', Buffer.from('b')]])); await assert.rejects(openRestoreZip(file), /unsafe/)
  const b = await zip([['file.apk', Buffer.from('a')]]); const central = b.indexOf(Buffer.from('504b0102', 'hex')); b.writeUInt32LE((0xa1ff << 16) >>> 0, central + 38)
  await writeFile(file, b); await assert.rejects(openRestoreZip(file), /unsafe/)
  await writeFile(file, await zip([['file.apk', Buffer.alloc(50)]])); const archive = await openRestoreZip(file); try { await assert.rejects(archive.buffer('file.apk', 10), /oversized/) } finally { archive.close() }
})
test('file dialog cancellation and unopened restore do not produce invalid state', async t => {
  const f = await fixture(t); assert.throws(() => f.prepare(), /Open a backup/); f.setFile(null); await f.open(); assert.equal(f.service.state.status, 'cancelled'); assert.equal(f.calls.length, 0)
})

async function addData(f) {
  const root = 'data/user/0/org.example.notes'
  const data = tar([{name:root,type:'5'}, {name:root+'/files',type:'5'}, {name:root+'/files/test',data:Buffer.from('test data')}])
  f.report.items[0].artifacts.push({component:'data',file:'Notes.data.tar',...sha(data)})
  f.report.items[0].dataSources = [{component:'data',roots:['/'+root]}]
  await writeFile(path.join(f.root,'Notes.data.tar'),data); await f.save()
  f.apps.options = {root:true}; f.apps.apps = [{packageName:'org.example.notes',versionCode:7,userId:11,uid:1110123}]
}
test('data restoration cancellation happens after local archive validation but before any ADB call', async t => {
  let confirmation
  const f = await fixture(t, {confirm:s=>{confirmation=s}}); await addData(f); await f.open(); await f.prepare(); f.setConfirm(false)
  await f.service.restoreFiles(f.service.state.token, ['data'])
  assert.equal(f.service.state.status,'ready'); assert.equal(f.calls.length,0); assert.equal(confirmation.operation,'files'); assert.deepEqual(confirmation.selectedParts,['data'])
  assert.throws(()=>f.service.restoreFiles(f.service.state.token,['apk']),/Choose/)
})
test('data restoration blocks wrong installed version and disabled private root setting', async t => {
  const f = await fixture(t); await addData(f); await f.open(); await f.prepare(); f.apps.apps[0].versionCode = 8
  await f.service.restoreFiles(f.service.state.token,['data']); assert.match(f.service.state.message,/matching application version/); assert.equal(f.calls.length,0)
  f.apps.apps[0].versionCode=7; await f.prepare(); f.apps.options.root=false
  await f.service.restoreFiles(f.service.state.token,['data']); assert.match(f.service.state.message,/root on the phone/); assert.equal(f.calls.length,0)
})
test('root missing on phone blocks private restoration before any stop or file upload', async t => {
  const f = await fixture(t,{runner:async args=>({code:0,stdout:args.at(-1)==='id -u'?'2000':'ADB_VAULT_SU_MISSING',stderr:''})}); await addData(f); await f.open(); await f.prepare()
  await f.service.restoreFiles(f.service.state.token,['data']); assert.equal(f.service.state.status,'error'); assert.match(f.service.state.message,/Root was not detected/)
  assert.ok(f.calls.every(a=>a[2]==='shell' && !a.at(-1).includes('force-stop')))
})
test('data-only copies retain APK identity evidence independently of exported APK artifacts', async t => {
  const f = await fixture(t); await addData(f); f.report.items[0].dataApkSha256=f.report.items[0].files.map(f=>f.sha256); f.report.items[0].artifacts.shift(); delete f.report.items[0].files; delete f.report.items[0].artifact; await f.save()
  await f.open(); await f.prepare(); f.setConfirm(false); await f.service.restoreFiles(f.service.state.token,['data']); assert.equal(f.service.state.status,'ready'); assert.equal(f.calls.length,0)
})

const batchPlan = { packages: ['org.example.notes', 'org.example.second'], components: ['apk'] }
async function addSecond(f) {
  const apk = await zip([['AndroidManifest.xml', manifest('org.example.second', 9)]])
  await writeFile(path.join(f.root, 'Second.apk'), apk)
  f.report.items.push({ packageName: 'org.example.second', label: 'Second', status: 'success', sourceVersionCode: 9, sourceVersionName: '9', archiveFormat: 'apk', artifacts: [{ component: 'apk', file: 'Second.apk', ...sha(apk) }], files: [{ file: 'Second.apk', ...sha(apk) }] })
  await f.save()
}
test('batch restores full split and single APK sets sequentially with one confirmation and bounded staging', async t => {
  const confirmations = [], f = await fixture(t, { split: true, confirm: s => confirmations.push(s) })
  await addSecond(f); await f.open(); await f.service.restoreBatch(batchPlan)
  assert.equal(f.service.state.status, 'success', f.service.state.message)
  assert.deepEqual(f.service.state.batch.items.map(i => i.status), ['success', 'success'])
  assert.equal(confirmations.length, 1); assert.equal(confirmations[0].operation, 'batch')
  assert.deepEqual(f.calls.map(a => a[2]), ['install-multiple', 'install']); assert.equal(f.calls[0].length, 8)
  assert.equal(f.refreshed.length, 2)
  assert.equal(f.events.filter(e => e.status === 'success').length, 1)
  for (const call of f.calls) await assert.rejects(readFile(call[6]), /ENOENT/)
})
test('batch native cancellation and invalid requests never issue ADB commands', async t => {
  const f = await fixture(t); await addSecond(f); await f.open(); f.setConfirm(false); await f.service.restoreBatch(batchPlan)
  assert.equal(f.calls.length, 0); assert.equal(f.service.state.status, 'cancelled')
  for (const plan of [{ ...batchPlan, packages: [] }, { ...batchPlan, packages: ['x', 'x'] }, { ...batchPlan, components: ['invalid'] }]) assert.throws(() => validateRestoreBatch(plan))
})
test('batch corrupt copy fails locally while the next application still installs', async t => {
  const f = await fixture(t); await addSecond(f); await writeFile(path.join(f.root, f.name), 'corrupt'); await f.open(); await f.service.restoreBatch(batchPlan)
  assert.equal(f.service.state.status, 'partial'); assert.deepEqual(f.service.state.batch.items.map(i => i.status), ['error', 'success']); assert.equal(f.calls.length, 1)
})
test('retry runs only known failed operations, never already successful applications', async t => {
  let fail = true
  const f = await fixture(t, { runner: async () => { const bad = fail; fail = false; return { code: 0, stdout: bad ? 'Failure [INSTALL_FAILED_TEST]' : 'Success', stderr: '' } } })
  await addSecond(f); await f.open(); await f.service.restoreBatch(batchPlan)
  assert.deepEqual(f.service.state.batch.items.map(i => i.status), ['error', 'success'])
  await f.service.retryBatch(); assert.equal(f.service.state.status, 'success'); assert.equal(f.calls.length, 3)
  assert.deepEqual(f.service.state.batch.items.map(i => i.packageName), ['org.example.notes'])
})
test('stop waits for the current application and marks the rest not started', async t => {
  let f, aborted
  f = await fixture(t, { runner: async (_args, controls) => { f.service.cancel(); aborted = controls.signal.aborted; return { code: 0, stdout: 'Success', stderr: '' } } })
  await addSecond(f); await f.open(); await f.service.restoreBatch(batchPlan)
  assert.equal(aborted, false); assert.equal(f.calls.length, 1)
  assert.deepEqual(f.service.state.batch.items.map(i => i.status), ['success', 'cancelled'])
})
test('uncertain install stops the queue and is excluded from retry', async t => {
  const f = await fixture(t, { runner: async () => { throw new Error('timed out') } })
  await addSecond(f); await f.open(); await f.service.restoreBatch(batchPlan)
  assert.equal(f.calls.length, 1); assert.equal(f.service.state.batch.items[0].uncertain, true)
  assert.equal(canRetryRestore(f.service.state.batch.items[0]), false)
  assert.deepEqual(f.service.state.batch.items.map(i => i.status), ['error', 'cancelled'])
})
test('batch rechecks the pinned device after confirmation before any commands', async t => {
  let f; f = await fixture(t, { confirm: () => { f.connection.devices[0].transportId = 'changed' } })
  await addSecond(f); await f.open(); await f.service.restoreBatch(batchPlan)
  assert.equal(f.calls.length, 0); assert.match(f.service.state.message, /changed/)
})
test('batch detects changed report metadata after confirmation', async t => {
  const f = await fixture(t); await addSecond(f); await f.open()
  f.report.items[0].sourceVersionCode = 99; await f.save(); await f.service.restoreBatch(batchPlan)
  assert.equal(f.service.state.batch.items[0].status, 'error'); assert.match(f.service.state.batch.items[0].message, /metadata changed/)
  assert.equal(f.calls.length, 1)
})
test('batch file failure after installation retains APK success and retry does not reinstall it', async t => {
  const f = await fixture(t, { runner: async args => ({ code: 0, stdout: args[2] === 'install' ? 'Success' : args.at(-1) === 'id -u' ? '2000' : 'ADB_VAULT_SU_MISSING', stderr: '' }) })
  await addData(f); await addSecond(f); await f.open(); await f.service.restoreBatch({ ...batchPlan, components: ['apk', 'data'] })
  const item = f.service.state.batch.items[0]; assert.equal(item.status, 'partial'); assert.deepEqual(item.completed, ['apk']); assert.equal(canRetryRestore(item), true)
  assert.equal(f.service.state.batch.items[1].status, 'success')
  const installs = f.calls.filter(a => a[2] === 'install').length
  await f.service.retryBatch(); assert.equal(f.calls.filter(a => a[2] === 'install').length, installs)
  assert.deepEqual(f.service.state.batch.items[0].components, ['data'])
})
test('missing requested components are skipped without device commands', async t => {
  const f = await fixture(t); await addSecond(f); await f.open(); await f.service.restoreBatch({ ...batchPlan, components: ['media'] })
  assert.deepEqual(f.service.state.batch.items.map(i => i.status), ['skipped', 'skipped']); assert.equal(f.calls.length, 0)
})
