import { _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

await mkdir('desktop-test-results', { recursive: true })
const root = await mkdtemp(path.resolve('desktop-test-results/android-diagnostics-ipc-'))
const harness = path.join(root, 'main.mjs')
await writeFile(harness, `
import { Backend } from ${JSON.stringify(pathToFileURL(path.resolve('dist-electron/backend.js')).href)};
import { dialog, shell } from 'electron';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
globalThis.diagnosticTest = { commands: [], hold: false, revealed: null };
Backend.prototype.initialize = async function () {
  const state = globalThis.diagnosticTest; state.backend = this;
  this.storage.data.stopAdbOnExit = false;
  this.components.adbPath = () => 'adb.exe';
  this.components.records.forEach(c => c.status = 'Detected');
  this.connection.state = { ...this.connection.state, adbAvailable: true, activeDeviceId: 'test', devices: [{ id: 'test', serial: 'TEST', transportId: '7', hardwareId: 'PHONE', name: 'Test phone', android: '16', status: 'connected', method: 'USB', endpoint: 'TEST', known: false, canDetach: false, lastSeen: '' }] };
  // Every runner call is intercepted; unexpected commands fail instead of reaching ADB.
  this.lifecycle.execute = async (file, args, timeout, input, env, options) => {
    state.commands.push(args);
    if (args.includes('logcat')) return { code: 0, stdout: '10-13 09:00:00.001 123 123 E Test: test crash', stderr: '' };
    if (args.includes('batterystats')) return { code: 0, stdout: '9,0,i,uid,10123,com.example.test\\n9,10123,l,pwi,uid,2.5\\n9,10123,l,awl,1000,500\\n9,10123,l,wua,alarm,2', stderr: '' };
    if (args.includes('bugreport')) {
      if (state.hold) return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
      const zip = new yazl.ZipFile(); zip.addBuffer(Buffer.from('Android diagnostic report'), 'bugreport-test.txt');
      const done = pipeline(zip.outputStream, createWriteStream(args.at(-1))); zip.end(); await done;
      return { code: 0, stdout: '', stderr: '' };
    }
    throw new Error('Unexpected command: ' + args.join(' '));
  };
  dialog.showSaveDialog = async (_window, opts) => ({ canceled: false, filePath: ${JSON.stringify(root)} + '/saved.' + opts.filters[0].extensions[0] });
  shell.showItemInFolder = file => { state.revealed = file; };
};
await import(${JSON.stringify(pathToFileURL(path.resolve('dist-electron/main.js')).href)});
`)
const env = { ...process.env, ADB_VAULT_SMOKE_TEST: '1' }
delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL
let desktop
try {
  desktop = await electron.launch({ args: [harness, `--user-data-dir=${path.join(root, 'profile')}`], env })
  const page = await desktop.firstWindow(); await page.waitForFunction(() => !!window.desktop)
  const target = { id: 'test', serial: 'TEST', transportId: '7' }
  const request = r => page.evaluate(r => window.desktop.request(r), r)
  for (const input of [
    { type: 'androidDiagnostics.start', kind: 'shell', target },
    { type: 'androidDiagnostics.start', kind: 'logcat', target, buffer: 'crash; reboot' },
    { type: 'androidDiagnostics.start', kind: 'battery', target: { ...target, transportId: '7;reboot' } },
    { type: 'androidDiagnostics.start', kind: 'logcat', target: { ...target, serial: 'OTHER' } },
  ]) assert.equal((await request(input)).ok, false)
  assert.equal(await desktop.evaluate(() => globalThis.diagnosticTest.commands.length), 0)
  for (const kind of ['logcat', 'battery']) {
    assert.equal((await request({ type: 'androidDiagnostics.start', kind, target })).ok, true)
    await desktop.evaluate(() => globalThis.diagnosticTest.backend.androidDiagnostics.wait())
    const state = (await request({ type: 'snapshot' })).snapshot.androidDiagnostics
    assert.equal(state.job.status, 'success')
    if (kind === 'logcat') assert.equal(state.logcat.lines[0].message, 'test crash')
    else assert.equal(state.battery.rows[0].estimatedMah, 2.5)
  }
  const log = (await request({ type: 'snapshot' })).snapshot.androidDiagnostics.logcat
  assert.equal((await request({ type: 'androidDiagnostics.exportLog', capturedAt: log.capturedAt })).ok, true)
  assert.match(await readFile(path.join(root, 'saved.txt'), 'utf8'), /test crash/)
  await desktop.evaluate(() => { globalThis.diagnosticTest.hold = true })
  await request({ type: 'androidDiagnostics.start', kind: 'bugreport', target })
  await page.waitForFunction(async () => (await window.desktop.request({ type: 'snapshot' })).snapshot.androidDiagnostics.job.message.includes('generating'))
  for (const r of [{ type: 'components.detect' }, { type: 'monitor.read', id: 'test', tab: 'battery' }, { type: 'connection.screen', ...target, action: 'screenshot' }]) {
    const reply = await request(r); assert.equal(reply.ok, false); assert.match(reply.error, /diagnostic collection/)
  }
  const job = (await request({ type: 'snapshot' })).snapshot.androidDiagnostics.job
  assert.equal((await request({ type: 'androidDiagnostics.cancel', jobId: job.id })).ok, true)
  await desktop.evaluate(() => globalThis.diagnosticTest.backend.androidDiagnostics.wait())
  assert.equal((await request({ type: 'snapshot' })).snapshot.androidDiagnostics.job.status, 'cancelled')
  await desktop.evaluate(() => { globalThis.diagnosticTest.hold = false })
  await request({ type: 'androidDiagnostics.start', kind: 'bugreport', target })
  await desktop.evaluate(() => globalThis.diagnosticTest.backend.androidDiagnostics.wait())
  const report = (await request({ type: 'snapshot' })).snapshot.androidDiagnostics.job
  assert.equal(report.status, 'success'); assert.equal((await readFile(report.output)).readUInt32LE(0), 0x04034b50)
  assert.equal((await request({ type: 'androidDiagnostics.reveal', jobId: report.id })).ok, true)
  assert.equal(await desktop.evaluate(() => globalThis.diagnosticTest.revealed), report.output)
  const commands = await desktop.evaluate(() => globalThis.diagnosticTest.commands)
  assert.equal(commands.length, 4)
  assert.ok(commands.every(a => a[0] === '-t' && a[1] === '7'))
  console.log('Android diagnostics Electron IPC passed: validation, three collectors, cancellation, conflict guards, export and reveal. All ADB calls mocked.')
  await writeFile(path.join(root, 'result.json'), JSON.stringify({ success: true, commands, hardware: false }, null, 2))
} finally { await desktop?.close() }
