import { _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
await mkdir('desktop-test-results', { recursive: true })
const root = await mkdtemp(path.resolve('desktop-test-results/web-services-'))
const output = path.join(root, 'export'); await mkdir(output)
const harness = path.join(root, 'main.mjs')
await writeFile(harness, `
import { shell } from 'electron';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Backend } from ${JSON.stringify(pathToFileURL(path.resolve('dist-electron/backend.js')).href)};
const apk = Buffer.concat([Buffer.from('504b0304', 'hex'), Buffer.from('test APK')]);
const hash = createHash('sha256').update(apk).digest('hex');
globalThis.webTest = { commands: [], urls: [], folders: [], cancel: false };
shell.openExternal = async url => { globalThis.webTest.urls.push(url); };
shell.openPath = async folder => { globalThis.webTest.folders.push(folder); return ''; };
Backend.prototype.initialize = async function () {
  this.storage.data.stopAdbOnExit = false;
  this.components.adbPath = () => 'adb.exe';
  this.connection.state = { ...this.connection.state, activeDeviceId: 'test', devices: [{ id: 'test', serial: 'test-serial', transportId: '7', name: 'Test phone', status: 'connected', method: 'USB' }] };
  this.apps.state = { ...this.apps.state, deviceId: 'test', userId: 0, status: 'ready', profiles: [{ id: 0, name: 'Owner' }], apps: [{ packageName: 'org.example.app', label: 'Example', userId: 0, sourceDir: '/data/app/example/base.apk' }] };
  this.exportDestination.resolve = async () => globalThis.webTest.cancel ? null : ${JSON.stringify(output)};
  this.lifecycle.execute = async (_file, args) => {
    globalThis.webTest.commands.push(args);
    if (args[2] === 'pull') { await writeFile(args[4], apk); return { code: 0, stdout: '1 file pulled', stderr: '' }; }
    const cmd = args.at(-1);
    if (cmd.includes("'path'")) return { code: 0, stdout: 'package:/data/app/example/base.apk\\npackage:/data/app/example/split_config.apk', stderr: '' };
    if (cmd.includes("'sha256sum'")) return { code: 0, stdout: hash + '  file.apk', stderr: '' };
    throw new Error('Unexpected ADB command');
  };
};
await import(${JSON.stringify(pathToFileURL(path.resolve('dist-electron/main.js')).href)});
`)
const env = { ...process.env, ADB_VAULT_SMOKE_TEST: '1' }; delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL
let desktop
try {
  desktop = await electron.launch({ args: [harness, `--user-data-dir=${path.join(root, 'profile')}`], env })
  const page = await desktop.firstWindow(); await page.waitForFunction(() => !!window.desktop)
  const request = value => page.evaluate(value => window.desktop.request(value), value)
  assert.equal((await request({ type: 'web.open', url: 'https://example.org/?q=app' })).ok, true)
  for (const url of ['file:///C:/bad', 'javascript:alert(1)', 'https://user:password@example.org/']) assert.equal((await request({ type: 'web.open', url })).ok, false)
  const prepare = { type: 'apps.prepareScan', id: 'test', userId: 0, packageName: 'org.example.app', url: 'https://www.virustotal.com/gui/home/upload' }
  const result = await request(prepare)
  assert.equal(result.ok, true); assert.equal(result.scanPreparation.files.length, 2)
  assert.equal(result.scanPreparation.files[0].file, 'org.example.app.apk')
  assert.ok(result.scanPreparation.files.every(f => /^[a-f0-9]{64}$/.test(f.sha256)))
  let evidence = await desktop.evaluate(() => globalThis.webTest)
  assert.deepEqual(evidence.urls, ['https://example.org/?q=app', prepare.url]); assert.equal(evidence.folders.length, 1)
  const count = evidence.commands.length
  await desktop.evaluate(() => { globalThis.webTest.cancel = true })
  const cancelled = await request(prepare); assert.equal(cancelled.ok, true); assert.equal(cancelled.scanPreparation, undefined)
  assert.equal(cancelled.snapshot.appAction.status, 'cancelled')
  evidence = await desktop.evaluate(() => globalThis.webTest)
  assert.equal(evidence.commands.length, count); assert.equal(evidence.urls.length, 2); assert.equal(evidence.folders.length, 1)
  console.log('Web service Electron IPC passed: validated external links, complete verified APK preparation, folder/site opening and cancellation. No real uploads or websites opened.')
} finally { await desktop?.close() }
