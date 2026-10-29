import { _electron as electron } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { backupFixture, tar, sha, zip, manifest } from './restore-fixture.mjs'

await mkdir('desktop-test-results', { recursive: true })
const fixture = await backupFixture({ split: true, parent: path.resolve('desktop-test-results') })
const singleInstaller = path.join(fixture.root, 'Other.apk')
await writeFile(singleInstaller, await zip([['AndroidManifest.xml', manifest('org.example.other')]]))
const dataRoot = 'data/user/0/org.example.notes', data = tar([{ name: dataRoot, type: '5' }, { name: dataRoot + '/test', data: Buffer.from('test data') }])
await writeFile(path.join(fixture.root, 'data.tar'), data)
fixture.report.items[0].artifacts.push({ component: 'data', file: 'data.tar', ...sha(data) })
fixture.report.items[0].dataSources = [{ component: 'data', roots: ['/' + dataRoot] }]
await fixture.save()
const harness = path.join(fixture.root, 'main.mjs')
await writeFile(harness, `
import { dialog } from 'electron';
import { Backend } from ${JSON.stringify(pathToFileURL(path.resolve('dist-electron/backend.js')).href)};
globalThis.restoreTest = { commands: [], dialogs: [], pickers: [], confirmed: false, refreshed: [] };
dialog.showOpenDialog = async (owner, options) => { globalThis.restoreTest.pickers.push({owner: !!owner?.webContents, ...options}); return {canceled:false,filePaths:options.properties.includes('multiSelections') ? ${JSON.stringify([path.join(fixture.root, fixture.name), singleInstaller])} : [${JSON.stringify(fixture.manifestPath)}]}; };
dialog.showMessageBox = async (owner, options) => { globalThis.restoreTest.dialogs.push({owner: !!owner?.webContents,...options}); return {response:globalThis.restoreTest.confirmed?1:0}; };
Backend.prototype.initialize = async function() {
  globalThis.testBackend = this; this.storage.data.stopAdbOnExit = false;
  this.components.adbPath = () => 'adb.exe';
  this.connection.state = {...this.connection.state,activeDeviceId:'test',devices:[{id:'test',serial:'serial',transportId:'7',hardwareId:'hardware',name:'Target phone',status:'connected',method:'USB'}]};
  this.apps.state = {...this.apps.state,deviceId:'test',userId:11,status:'ready',profiles:[{id:11,name:'Work'}],apps:[]};
  this.apps.refreshAfterAction = async (...args) => {globalThis.restoreTest.refreshed.push(args)};
  this.lifecycle.execute = async (_file,args) => {globalThis.restoreTest.commands.push(args); if(globalThis.restoreTest.hold) await new Promise(r => {globalThis.restoreTest.release = r}); return {code:0,stdout:'Success',stderr:''}};
};
await import(${JSON.stringify(pathToFileURL(path.resolve('dist-electron/main.js')).href)});
`)
const env = { ...process.env, ADB_VAULT_SMOKE_TEST: '1' }; delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL
let desktop
try {
  desktop = await electron.launch({ args: [harness, `--user-data-dir=${path.join(fixture.root, 'profile')}`], env })
  const page = await desktop.firstWindow(); await page.waitForFunction(() => !!window.desktop)
  const request = r => page.evaluate(r => window.desktop.request(r), r)
  assert.equal((await request({ type: 'apps.restoreOpen', id: 'test', userId: -1 })).ok, false)
  assert.equal((await request({ type: 'apps.restoreInstall', token: 'unverified' })).ok, false)
  assert.equal((await request({ type: 'apps.restoreOpen', id: 'test', userId: 11 })).snapshot.restore.status, 'choosing')
  let reply = await request({ type: 'apps.restorePrepare', packageName: 'org.example.notes' })
  assert.equal(reply.snapshot.restore.status, 'ready'); assert.equal(reply.snapshot.restore.apkCount, 2)
  const token = reply.snapshot.restore.token
  reply = await request({ type: 'apps.restoreInstall', token })
  assert.equal(reply.snapshot.restore.status, 'ready')
  let evidence = await desktop.evaluate(() => globalThis.restoreTest)
  assert.equal(evidence.commands.length, 0); assert.equal(evidence.pickers[0].owner, true)
  assert.equal(evidence.dialogs[0].owner, true); assert.equal(evidence.dialogs[0].defaultId, 0); assert.equal(evidence.dialogs[0].cancelId, 0)
  for (const text of ['org.example.notes', 'Target phone', 'Work · ID 11', '1.7 (7)', 'other profiles']) assert.ok(evidence.dialogs[0].detail.includes(text))
  await desktop.evaluate(() => { globalThis.restoreTest.confirmed = true; globalThis.restoreTest.hold = true })
  const installing = request({ type: 'apps.restoreInstall', token })
  await page.waitForFunction(async () => (await window.desktop.request({ type: 'snapshot' })).snapshot.restore?.status === 'installing')
  for (const r of [{ type: 'apps.selectProfile', id: 'test', userId: 0 }, { type: 'connection.disconnect', id: 'test' }, { type: 'apps.action', id: 'test', userId: 11, packageName: 'org.example.notes', action: 'uninstall' }]) {
    const blocked = await request(r); assert.equal(blocked.ok, false); assert.match(blocked.error, /installation/)
  }
  await desktop.evaluate(() => { globalThis.restoreTest.release() }); reply = await installing
  assert.equal(reply.snapshot.restore.status, 'success')
  evidence = await desktop.evaluate(() => globalThis.restoreTest)
  assert.equal(evidence.commands.length, 1); assert.deepEqual(evidence.commands[0].slice(0, 6), ['-t', '7', 'install-multiple', '--user', '11', '-r']); assert.equal(evidence.commands[0].length, 8)
  assert.deepEqual(evidence.refreshed, [['test', 11, 'org.example.notes']])
  await desktop.evaluate(() => {
    globalThis.restoreTest.confirmed = false; globalThis.restoreTest.hold = false
    globalThis.testBackend.apps.state.options.root = true
    globalThis.testBackend.apps.state.apps = [{ packageName: 'org.example.notes', versionCode: 7, userId: 11, uid: 1110123 }]
  })
  await request({ type: 'apps.restoreOpen', id: 'test', userId: 11 })
  reply = await request({ type: 'apps.restorePrepare', packageName: 'org.example.notes' })
  assert.equal((await request({ type: 'apps.restoreFiles', token: reply.snapshot.restore.token, components: ['invalid'] })).ok, false)
  reply = await request({ type: 'apps.restoreFiles', token: reply.snapshot.restore.token, components: ['data'] })
  assert.equal(reply.snapshot.restore.status, 'ready'); assert.match(reply.snapshot.restore.message, /cancelled/)
  evidence = await desktop.evaluate(() => globalThis.restoreTest)
  assert.equal(evidence.commands.length, 1)
  const confirmation = evidence.dialogs.at(-1)
  assert.equal(confirmation.owner, true); assert.equal(confirmation.defaultId, 0); assert.equal(confirmation.cancelId, 0)
  assert.match(confirmation.detail, /App data|data/); assert.match(confirmation.detail, /Work · ID 11/)
  assert.equal((await request({ type: 'apps.restoreBatch', plan: { packages: [], components: ['apk'] } })).ok, false)
  reply = await request({ type: 'apps.restoreBatch', plan: { packages: ['org.example.notes'], components: ['apk', 'data'] } })
  assert.equal(reply.snapshot.restore.status, 'cancelled')
  evidence = await desktop.evaluate(() => globalThis.restoreTest)
  assert.equal(evidence.commands.length, 1)
  const batchConfirmation = evidence.dialogs.at(-1)
  assert.equal(batchConfirmation.owner, true); assert.equal(batchConfirmation.defaultId, 0); assert.equal(batchConfirmation.cancelId, 0)
  assert.match(batchConfirmation.detail, /org.example.notes/); assert.match(batchConfirmation.detail, /APK\/APKS, App data/)
  assert.equal((await request({ type: 'apps.installOpen', id: 'test', userId: -1 })).ok, false)
  reply = await request({ type: 'apps.installOpen', id: 'test', userId: 11 })
  assert.equal(reply.snapshot.restore.sourceKind, 'install'); assert.equal(reply.snapshot.restore.applications.length, 2)
  const plan = { packages: ['org.example.notes', 'org.example.other'], components: ['apk'] }
  reply = await request({ type: 'apps.restoreBatch', plan }); assert.equal(reply.snapshot.restore.status, 'cancelled')
  evidence = await desktop.evaluate(() => globalThis.restoreTest)
  assert.equal(evidence.commands.length, 1); assert.ok(evidence.pickers.at(-1).properties.includes('multiSelections'))
  const installConfirmation = evidence.dialogs.at(-1)
  assert.equal(installConfirmation.owner, true); assert.equal(installConfirmation.title, 'Install applications'); assert.equal(installConfirmation.defaultId, 0)
  assert.match(installConfirmation.detail, /Target phone/); assert.match(installConfirmation.detail, /Work · ID 11/); assert.match(installConfirmation.detail, /org.example.other/)
  await desktop.evaluate(() => { globalThis.restoreTest.confirmed = true })
  reply = await request({ type: 'apps.restoreBatch', plan }); assert.equal(reply.snapshot.restore.status, 'success')
  evidence = await desktop.evaluate(() => globalThis.restoreTest)
  assert.deepEqual(evidence.commands.slice(-2).map(c => c.slice(0, 6)), [['-t', '7', 'install-multiple', '--user', '11', '-r'], ['-t', '7', 'install', '--user', '11', '-r']])
  await writeFile(path.join(fixture.root, 'verification.json'), JSON.stringify({ nativeConfirmation: true, cancelMadeNoAdbCalls: true, fullSplitSet: true, profile: 11, busyGuards: true, onePackageRefresh: true }, null, 2))
  console.log('Restore and standalone multi-install Electron IPC verification passed, including owned multi-picker and native cancel. Fake ADB only.')
} finally { await desktop?.close() }
