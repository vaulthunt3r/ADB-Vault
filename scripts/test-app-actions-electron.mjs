import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

// Real preload/IPC and Backend; isolated preferences, fake ADB and main-owned confirmation responses.
await mkdir('desktop-test-results', { recursive: true })
const root = await mkdtemp(path.resolve('desktop-test-results/app-actions-'))
const harness = path.join(root, 'main.mjs')
const helperManifest = JSON.parse(await readFile('android-helper/dist/helper-manifest.json', 'utf8'))
await writeFile(harness, `
import { dialog } from 'electron';
import { writeFile, rm } from 'node:fs/promises';
globalThis.testFiles = { writeFile, rm };
import { Backend } from ${JSON.stringify(pathToFileURL(path.resolve('dist-electron/backend.js')).href)};
globalThis.actionTest = { commands: [], confirmations: [], confirm: false, autoConfirm: true, refreshed: [] };
dialog.showMessageBox = async () => { throw new Error('Unexpected native message box'); };
dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
Backend.prototype.initialize = async function () {
  globalThis.testBackend = this;
  const ask = this.confirmations.ask.bind(this.confirmations);
  this.confirmations.ask = content => {
    const result = ask(content);
    globalThis.actionTest.confirmations.push(this.confirmations.state.prompt);
    if (globalThis.actionTest.autoConfirm) queueMicrotask(() => this.confirmations.answer(this.confirmations.state.prompt.id, globalThis.actionTest.confirm));
    return result;
  };
  this.storage.data.stopAdbOnExit = false;
  this.components.adbPath = () => 'adb.exe';
  this.connection.state = { ...this.connection.state, activeDeviceId: 'test', devices: [{ id: 'test', serial: 'test-serial', transportId: '7', name: 'Test phone', status: 'connected', method: 'USB' }] };
  this.apps.state = { ...this.apps.state, deviceId: 'test', userId: 10, status: 'ready', profiles: [{ id: 10, name: 'Work' }], apps: [{ packageName: 'org.example.notes', userId: 10, uid: 1010001, versionCode: 1, label: 'Notes', enabled: true, system: true, actionContext: { fingerprint: 'test-build', sdk: 36, callerUid: 2000, cachePermission: 'denied' } }] };
  this.apps.refreshAfterAction = async (id, userId) => { globalThis.actionTest.refreshed.push({ id, userId }); };
  this.lifecycle.execute = async (file, args) => {
    globalThis.actionTest.commands.push(args);
    const command = args.at(-1);
    if (command.includes('sha256sum')) return { code: 0, stdout: ${JSON.stringify(helperManifest.sha256)} + ' file', stderr: '' };
    if (command.includes("PackageActions 'inspect'")) return { code: 0, stderr: '', stdout: JSON.stringify({ protocol: 1, action: 'inspect', packageName: 'org.example.notes', userId: 10, context: { fingerprint: 'test-build', sdk: 36, callerUid: 2000, cachePermission: 'denied' }, state: { installed: true, enabled: !globalThis.actionTest.disabled, uid: 1010001, versionCode: 1 }, outcome: 'confirmed' }) };
    if (command.includes("'disable-user'") && globalThis.actionTest.unsupportedShell) return { code: 1, stdout: '', stderr: 'Unknown command: disable-user' };
    if (command.includes("PackageActions 'disable'")) {
      globalThis.actionTest.disabled = true;
      return { code: 0, stderr: '', stdout: JSON.stringify({ protocol: 1, action: 'disable', packageName: 'org.example.notes', userId: 10, context: { fingerprint: 'test-build', sdk: 36, callerUid: 2000, cachePermission: 'denied' }, outcome: 'confirmed' }) };
    }
    if (command.includes("'disable-user'")) globalThis.actionTest.disabled = true;
    if (command === 'id -u') return { code: 0, stdout: '2000', stderr: '' };
    if (command.startsWith('if command -v su')) return { code: 0, stdout: globalThis.actionTest.rootOutcome === 'missing' ? 'ADB_VAULT_SU_MISSING' : 'ADB_VAULT_SU_FOUND', stderr: '' };
    if (command === 'su -c id') return globalThis.actionTest.rootOutcome === 'denied' ? { code: 1, stdout: '', stderr: 'Permission denied' } : { code: 0, stdout: 'uid=0(root)', stderr: '' };

    const stdout = command.includes("'path'") ? 'package:/data/app/notes/base.apk' : command.includes("'disable-user'") ? 'Package org.example.notes new state: disabled-user' : '';
    return { code: 0, stdout, stderr: '' };
  };
};
await import(${JSON.stringify(pathToFileURL(path.resolve('dist-electron/main.js')).href)});
`)
const env = { ...process.env, ADB_VAULT_SMOKE_TEST: '1' }
delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL
let desktop
try {
  desktop = await electron.launch({ args: [harness, `--user-data-dir=${path.join(root, 'profile')}`], env })
  const page = await desktop.firstWindow()
  await page.waitForFunction(() => !!window.desktop)
  const request = action => page.evaluate(action => window.desktop.request({ type: 'apps.action', id: 'test', userId: 10, packageName: 'org.example.notes', action }), action)
  await desktop.evaluate(() => { globalThis.actionTest.autoConfirm = false })
  const pendingCancel = request('uninstall')
  const confirmationDialog = page.getByRole('dialog', { name: 'Uninstall application', exact: true })
  await expect(confirmationDialog).toBeVisible()
  await expect(confirmationDialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
  await expect(confirmationDialog).toContainText('Work · ID 10')
  assert.equal((await desktop.evaluate(() => globalThis.actionTest.commands)).length, 0)
  await page.screenshot({ path: path.join(root, 'uninstall-confirmation.png') })
  const cancelledId = await desktop.evaluate(() => globalThis.testBackend.confirmations.state.prompt.id)
  await page.keyboard.press('Escape')
  assert.equal((await pendingCancel).snapshot.appAction.status, 'cancelled')
  await expect(confirmationDialog).not.toBeVisible()
  assert.equal((await page.evaluate(id => window.desktop.request({ type: 'confirmation.answer', id, accepted: true }), cancelledId)).ok, false)
  const pendingAccept = request('disable')
  await page.getByRole('dialog', { name: 'Disable application', exact: true }).getByRole('button', { name: 'Disable application', exact: true }).click()
  assert.equal((await pendingAccept).snapshot.appAction.status, 'success')
  await desktop.evaluate(() => { Object.assign(globalThis.actionTest, { autoConfirm: true, commands: [], confirmations: [], refreshed: [], disabled: false }) })
  let reply = await request('uninstall')
  assert.equal(reply.snapshot.appAction.status, 'cancelled')
  let evidence = await desktop.evaluate(() => globalThis.actionTest)
  assert.equal(evidence.commands.length, 0)
  assert.match(JSON.stringify(evidence.confirmations[0]), /Work · ID 10/)
  assert.match(JSON.stringify(evidence.confirmations[0]), /System applications/)
  reply = await page.evaluate(() => window.desktop.request({ type: 'apps.action', id: 'test', userId: 10, packageName: 'org.example.notes', action: 'uninstall', options: { keepData: true } }))
  assert.equal(reply.snapshot.appAction.status, 'cancelled')
  evidence = await desktop.evaluate(() => globalThis.actionTest)
  assert.match(JSON.stringify(evidence.confirmations.at(-1)), /retain app data and cache/)
  assert.doesNotMatch(JSON.stringify(evidence.confirmations.at(-1)), /Android API|ADB command/)
  assert.equal(evidence.commands.length, 0)
  for (const action of ['clear-cache', 'clear-data', 'clear-obb', 'clear-media']) {
    reply = await request(action)
    assert.equal(reply.snapshot.appAction.status, 'cancelled')
    evidence = await desktop.evaluate(() => globalThis.actionTest)
    assert.equal(evidence.commands.length, 0)
    assert.match(JSON.stringify(evidence.confirmations.at(-1)), /org.example.notes/)
    assert.match(JSON.stringify(evidence.confirmations.at(-1)), /Work/)
  }
  await desktop.evaluate(() => { globalThis.actionTest.confirm = true })
  reply = await request('disable')
  assert.equal(reply.snapshot.appAction.status, 'success')
  evidence = await desktop.evaluate(() => globalThis.actionTest)
  assert.ok(evidence.commands.some(args => args.at(-1) === "'pm' 'disable-user' '--user' '10' 'org.example.notes'"))
  assert.ok(evidence.commands.at(-1).at(-1).includes("PackageActions 'inspect'"))
  assert.equal(reply.snapshot.apps.apps[0].actionEvidence[0].outcome, 'confirmed')
  assert.deepEqual(evidence.refreshed, [{ id: 'test', userId: 10 }])
  await desktop.evaluate(() => { globalThis.actionTest.disabled = false; globalThis.actionTest.unsupportedShell = true })
  reply = await request('disable')
  assert.equal(reply.snapshot.appAction.status, 'success')
  assert.equal(reply.snapshot.appAction.uncertain, false)
  assert.match(reply.snapshot.appAction.message, /Android API/)
  evidence = await desktop.evaluate(() => globalThis.actionTest)
  assert.equal(evidence.commands.filter(args => args.at(-1).includes("PackageActions 'disable'")).length, 1)
  assert.equal(reply.snapshot.apps.apps[0].actionEvidence.find(e => e.method === 'api').outcome, 'confirmed')
  assert.equal(reply.snapshot.apps.apps[0].actionEvidence.find(e => e.method === 'shell').outcome, 'failed')
  await desktop.evaluate(() => { globalThis.actionTest.unsupportedShell = false })
  assert.equal((await request('export')).snapshot.appAction.status, 'cancelled')
  assert.equal((await request('arbitrary-command')).ok, false)
  assert.equal((await page.evaluate(() => window.desktop.request({ type: 'apps.action', id: 'test', userId: 0, packageName: 'org.example.notes', action: 'disable' }))).ok, false)
  assert.equal((await page.evaluate(() => window.desktop.request({ type: 'apps.openExport' }))).ok, false)
  const selection = { id: 'test', userId: 10, packages: ['org.example.notes'], name: 'system', format: 'auto' }
  reply = await page.evaluate(selection => window.desktop.request({ type: 'apps.backup', selection: { ...selection, name: undefined } }), selection)
  assert.equal(reply.ok, true)
  assert.equal(reply.snapshot.backup.status, 'cancelled')
  assert.equal((await page.evaluate(selection => window.desktop.request({ type: 'apps.savePreset', selection: { ...selection, name: undefined } }), selection)).ok, false)
  await desktop.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }) }, root)
  reply = await page.evaluate(() => window.desktop.request({ type: 'settings.exportMode', mode: 'fixed' }))
  assert.equal(reply.ok, true)
  assert.equal(reply.snapshot.exportDestination.mode, 'fixed')
  assert.equal(reply.snapshot.exportDestination.folder, root)
  await desktop.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => { throw new Error('Fixed export must not open a folder picker') } })
  reply = await page.evaluate(selection => window.desktop.request({ type: 'apps.savePreset', selection }), selection)
  assert.equal(reply.ok, true)
  assert.equal(reply.snapshot.backup.status, 'complete')
  const presetPath = reply.snapshot.backup.presetPath
  assert.ok(presetPath.startsWith(root))
  assert.equal(path.basename(presetPath), 'system.json')
  assert.equal(path.dirname(path.dirname(path.dirname(presetPath))), root)
  assert.equal((await page.evaluate(() => window.desktop.request({ type: 'settings.exportMode', mode: 'invalid' }))).ok, false)
  await desktop.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }) })
  reply = await page.evaluate(() => window.desktop.request({ type: 'settings.exportFolder' }))
  assert.equal(reply.snapshot.exportDestination.folder, root)
  reply = await page.evaluate(() => window.desktop.request({ type: 'settings.exportMode', mode: 'ask' }))
  assert.equal(reply.snapshot.exportDestination.mode, 'ask')
  reply = await page.evaluate(selection => window.desktop.request({ type: 'apps.savePreset', selection }), selection)
  assert.equal(reply.snapshot.backup.status, 'cancelled')
  await desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, presetPath)
  reply = await page.evaluate(() => window.desktop.request({ type: 'apps.loadPreset', id: 'test', userId: 10 }))
  assert.equal(reply.ok, true)
  assert.deepEqual(reply.snapshot.presetPreview.matched, ['org.example.notes'])
  assert.equal(reply.snapshot.presetPreview.preset.profile.id, 10)
  assert.equal((await page.evaluate(selection => window.desktop.request({ type: 'apps.savePreset', selection: { ...selection, name: '../escape' } }), selection)).ok, false)
  await desktop.evaluate(async (_electron, root) => {
    const { writeFile } = globalThis.testFiles
    const backend = globalThis.testBackend
    const file = root + '/badge.apk'
    await writeFile(file, 'isolated catalogue fixture')
    Object.assign(backend.apps.state.apps[0], { versionName: '1.0', versionCode: 1 })
    await backend.backupCatalogue.load()
    await backend.backupCatalogue.record([{ identity: 'test-serial', userId: 10, packageName: 'org.example.notes', versionName: '1.0', versionCode: 1, createdAt: new Date().toISOString(), file, format: 'apk' }])
  }, root)
  reply = await page.evaluate(() => window.desktop.request({ type: 'apps.refreshBackups' }))
  assert.equal(reply.ok, true)
  assert.equal(reply.snapshot.apps.apps[0].backupCheck.present, true)
  assert.ok(reply.snapshot.apps.apps[0].backupCheck.items.some(i => i.value.includes('Matches installed version')))
  await desktop.evaluate(async (_electron, root) => { const { rm } = globalThis.testFiles; await rm(root + '/badge.apk') }, root)
  reply = await page.evaluate(() => window.desktop.request({ type: 'apps.refreshBackups' }))
  assert.equal(reply.snapshot.apps.apps[0].backupCheck.present, false)
  reply = await page.evaluate(() => window.desktop.request({ type: 'connection.root', id: 'test' }))
  assert.equal(reply.snapshot.connection.devices[0].root.status, 'detected')
  reply = await page.evaluate(() => window.desktop.request({ type: 'connection.root', id: 'test', requestAccess: true }))
  assert.equal(reply.snapshot.connection.devices[0].root.status, 'available')
  await desktop.evaluate(() => { globalThis.actionTest.rootOutcome = 'denied' })
  reply = await page.evaluate(() => window.desktop.request({ type: 'connection.root', id: 'test', requestAccess: true }))
  assert.equal(reply.snapshot.connection.devices[0].root.status, 'denied')
  await desktop.evaluate(() => { globalThis.actionTest.rootOutcome = 'missing'; globalThis.testBackend.apps.state.options.root = true })
  reply = await page.evaluate(selection => window.desktop.request({ type: 'apps.backup', selection: { ...selection, contents: { apk: false, data: true, cache: false, obb: false, media: false }, stopApps: true } }), selection)
  assert.equal(reply.ok, false)
  assert.match(reply.error, /Root was not detected/)
  evidence = await desktop.evaluate(() => globalThis.actionTest)
  assert.equal(evidence.commands.some(a => a.at(-1).includes('force-stop') || a.at(-1).startsWith('tar ')), false)
  assert.equal((await page.evaluate(() => window.desktop.request({ type: 'connection.root', id: 'test', requestAccess: 'yes' }))).ok, false)
  console.log('PASS: root detection/access states cross IPC; missing device root blocks private backup before stopping apps or transferring files.')
  console.log('PASS: Backup availability and deleted-file rechecks cross real desktop IPC without ADB.')
  console.log('PASS: real Electron IPC validates action/profile, owns confirmation, cancels without ADB, targets confirmed profile and refreshes; no real device was used.')
  console.log('PASS: backup cancellation, preset save/import and path validation cross real desktop IPC; only the isolated test folder was used.')
  await desktop.evaluate(() => {
    globalThis.actionTest.confirm = false
    globalThis.testBackend.apps.state.apps = [{ packageName: 'org.example.notes', userId: 10, uid: 1010001, label: 'Notes', enabled: true, system: true, versionCode: 1 }, { packageName: 'org.example.other', userId: 10, uid: 1010002, label: 'Other', enabled: false, system: false, versionCode: 1 }]
  })
  const beforeBatch = (await desktop.evaluate(() => globalThis.actionTest.commands)).length
  const plan = { id: 'test', userId: 10, action: 'disable', packages: ['org.example.notes', 'org.example.other'] }
  reply = await page.evaluate(plan => window.desktop.request({ type: 'apps.batchAction', plan }), plan)
  assert.equal(reply.snapshot.appAction.status, 'cancelled')
  evidence = await desktop.evaluate(() => globalThis.actionTest)
  assert.equal(evidence.commands.length, beforeBatch)
  assert.match(JSON.stringify(evidence.confirmations.at(-1)), /"total":2,"affected":1,"skipped":1/)
  assert.match(JSON.stringify(evidence.confirmations.at(-1)), /Work · ID 10/)
  assert.match(JSON.stringify(evidence.confirmations.at(-1)), /Other.*Skipped/)
  for (const part of ['obb', 'media']) {
    reply = await page.evaluate(plan => window.desktop.request({ type: 'apps.batchAction', plan }), { ...plan, action: `clear-${part}` })
    assert.equal(reply.ok, true); assert.equal(reply.snapshot.appAction.status, 'cancelled')
    evidence = await desktop.evaluate(() => globalThis.actionTest)
    assert.equal(evidence.commands.length, beforeBatch)
    const confirmation = evidence.confirmations.at(-1)
    assert.match(JSON.stringify(confirmation), /"total":2,"affected":2/)
    assert.ok(JSON.stringify(confirmation).includes(`Android/${part}`))
    assert.match(JSON.stringify(confirmation), /permanently deleted/)
    assert.match(JSON.stringify(confirmation), /Work · ID 10/)
    assert.match(JSON.stringify(confirmation), /remain stopped/)
  }
  const beforeCombined = (await desktop.evaluate(() => globalThis.actionTest.confirmations)).length
  reply = await page.evaluate(plan => window.desktop.request({ type: 'apps.batchAction', plan }), { ...plan, action: 'clear-storage', cleanup: ['data', 'cache', 'obb', 'media'] })
  assert.equal(reply.ok, true); assert.equal(reply.snapshot.appAction.status, 'cancelled')
  evidence = await desktop.evaluate(() => globalThis.actionTest)
  assert.equal(evidence.confirmations.length, beforeCombined + 1)
  assert.equal(evidence.commands.length, beforeBatch)
  assert.match(JSON.stringify(evidence.confirmations.at(-1)), /App data \(includes cache\), OBB, Media/)
  assert.match(JSON.stringify(evidence.confirmations.at(-1)), /Notes.*App data, OBB, Media/)
  await desktop.evaluate(() => { globalThis.actionTest.confirm = true })
  reply = await page.evaluate(plan => window.desktop.request({ type: 'apps.batchAction', plan }), plan)
  assert.equal(reply.snapshot.appAction.status, 'success')
  assert.deepEqual(reply.snapshot.appAction.batch.items.map(i => i.status), ['success', 'skipped'])
  assert.equal((await page.evaluate(plan => window.desktop.request({ type: 'apps.batchAction', plan: { ...plan, action: 'launch' } }), plan)).ok, false)
  console.log('PASS: batch action plan crosses real IPC, shows skipped items and profile, cancels without commands and runs only eligible apps.')
  await desktop.evaluate(() => {
    globalThis.actionTest.autoConfirm = false
    globalThis.actionTest.installs = []
    globalThis.testBackend.components.install = async id => { globalThis.actionTest.installs.push(id) }
  })
  const installComponent = () => page.evaluate(() => window.desktop.request({ type: 'components.action', id: 'adb', action: 'install' }))
  const cancelledInstall = installComponent()
  const componentDialog = page.getByRole('dialog', { name: 'Install components', exact: true })
  await expect(componentDialog.getByRole('button', { name: /View license terms/ })).toBeVisible()
  await componentDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal((await cancelledInstall).ok, true)
  assert.deepEqual(await desktop.evaluate(() => globalThis.actionTest.installs), [])
  const acceptedInstall = installComponent()
  await componentDialog.getByRole('button', { name: 'Accept and install', exact: true }).click()
  assert.equal((await acceptedInstall).ok, true)
  assert.deepEqual(await desktop.evaluate(() => globalThis.actionTest.installs), ['adb'])
  console.log('PASS: component confirmation shows license terms and reaches the fake installer only after acceptance.')
  await desktop.evaluate(() => {
    globalThis.testBackend.files.io.stat = async () => ({ name: 'test-audio.mp3', kind: 'file' })
  })
  const opening = page.evaluate(() => window.desktop.request({ type: 'files.open', location: { kind: 'local', path: 'C:\\Tests\\test-audio.mp3' }, withApp: true }))
  const openDialog = page.getByRole('dialog', { name: 'Open file', exact: true })
  await expect(openDialog).toContainText('test-audio.mp3')
  await expect(openDialog.getByRole('button', { name: 'Choose application…', exact: true })).toBeVisible()
  await openDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal((await opening).ok, true)
  console.log('PASS: external file opening uses the same confirmation and can be cancelled before choosing an application.')
  const beforeReload = (await desktop.evaluate(() => globalThis.actionTest.commands)).length
  // Reload destroys the renderer's in-flight IPC promise; the main operation must still cancel.
  const interrupted = request('uninstall').catch(() => null)
  await expect(page.getByRole('dialog', { name: 'Uninstall application', exact: true })).toBeVisible()
  await page.reload()
  await interrupted
  await page.waitForFunction(() => !!window.desktop)
  assert.equal(await desktop.evaluate(() => globalThis.testBackend.confirmations.state.prompt), null)
  assert.equal(await desktop.evaluate(() => globalThis.testBackend.appActions.state.status), 'cancelled')
  assert.equal((await desktop.evaluate(() => globalThis.actionTest.commands)).length, beforeReload)
  console.log('PASS: reloading the renderer cancels its pending confirmation without executing any command.')
} finally { if (desktop) await desktop.close() }
