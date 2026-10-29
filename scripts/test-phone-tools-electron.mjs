import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { sampleText, target, contacts, sms } from './fixtures/phone-tools.mjs'

await mkdir('desktop-test-results', { recursive: true })
const root = await mkdtemp(path.resolve('desktop-test-results/phone-tools-ipc-'))
const digest = JSON.parse(await readFile('android-helper/dist/helper-manifest.json', 'utf8')).sha256
const harness = path.join(root, 'main.mjs')
await writeFile(harness, `
import { Backend } from ${JSON.stringify(pathToFileURL(path.resolve('dist-electron/backend.js')).href)};
import { response, sampleText } from ${JSON.stringify(pathToFileURL(path.resolve('scripts/fixtures/phone-tools.mjs')).href)};
import { clipboard, dialog } from 'electron';
import path from 'node:path';
globalThis.phoneTest = { commands: [], hold: false, pcText: sampleText, clipboardWrites: [], saves: [] };
clipboard.readText = async () => globalThis.phoneTest.pcText;
clipboard.writeText = async text => { globalThis.phoneTest.clipboardWrites.push(text); };
dialog.showSaveDialog = async (_window, options) => {
  const filePath = path.join(${JSON.stringify(root)}, options.defaultPath);
  globalThis.phoneTest.saves.push(filePath); return { canceled: false, filePath };
};
Backend.prototype.initialize = async function () {
  const test = globalThis.phoneTest; test.backend = this;
  this.storage.data.stopAdbOnExit = false;
  this.components.adbPath = () => 'adb.exe';
  this.components.records.forEach(c => c.status = 'Detected');
  this.databases.records.forEach(c => c.status = 'Not installed');
  this.connection.state = { ...this.connection.state, adbAvailable: true, activeDeviceId: 'phone', devices: [{ id: 'phone', serial: 'TEST', transportId: '7', hardwareId: 'PHONE', name: 'Test phone', android: '16', status: 'connected', method: 'USB', endpoint: 'TEST', known: false, canDetach: false, lastSeen: '' }] };
  this.lifecycle.execute = async (file, args, timeout, input, env, options) => {
    test.commands.push({ args, input });
    if (args[0] !== '-t' || args[1] !== '7') throw new Error('Unexpected target');
    let stdout;
    if (args.includes('ro.build.version.sdk')) stdout = '36';
    else if (args.includes('get-current-user')) stdout = '0';
    else if (args.at(-1).includes('if [ -f')) stdout = ${JSON.stringify(digest)};
    else if (args.at(-1).includes('app_process')) {
      if (test.hold) return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
      const operation = args.at(-1).split('PhoneTools ')[1].split(' ')[0];
      stdout = response(operation); options.onStdout?.(stdout);
    } else throw new Error('Unexpected ADB command');
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
  const page = await desktop.firstWindow(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForFunction(() => !!window.desktop)
  const request = r => page.evaluate(value => window.desktop.request(value), r)
  for (const invalid of [
    { type: 'phoneTools.clipboard.write', target, text: 'x\0y' },
    { type: 'phoneTools.read', kind: 'sms', target, range: { from: 10, to: 1 } },
    { type: 'phoneTools.read', kind: 'contacts', target: { ...target, serial: 'OTHER' }, range: {} },
  ]) assert.equal((await request(invalid)).ok, false)
  assert.equal(await desktop.evaluate(() => globalThis.phoneTest.commands.length), 0)
  await page.getByRole('navigation').getByRole('button', { name: 'Connection', exact: true }).click()
  await page.getByRole('tab', { name: 'Actions', exact: true }).click()
  await page.getByRole('button', { name: 'Clipboard', exact: true }).click()
  await page.getByRole('button', { name: 'Paste from PC', exact: true }).click()
  await expect(page.getByLabel('Clipboard text')).toHaveValue(sampleText)
  await page.getByRole('button', { name: 'Send to Android', exact: true }).click()
  await expect(page.locator('.phone-tools-status')).toContainText('Text copied to the Android clipboard.')
  const sent = await desktop.evaluate(() => globalThis.phoneTest.commands.at(-1))
  assert.equal(JSON.parse(sent.input).text, sampleText); assert.ok(!sent.args.join(' ').includes('Привет'))
  await page.getByRole('button', { name: 'Get from Android', exact: true }).click()
  await expect(page.locator('.phone-tools-status')).toContainText('Android clipboard text received.')
  await page.getByRole('button', { name: 'Copy to PC', exact: true }).click()
  assert.equal(await desktop.evaluate(() => globalThis.phoneTest.clipboardWrites.at(-1)), sampleText)
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  for (const [action, formats, ids] of [['Export contacts', ['vcf', 'csv'], ['1']], ['Export call log', ['csv', 'json'], ['11']], ['Export SMS', ['json', 'html'], ['21']]]) {
    await page.getByRole('button', { name: action, exact: true }).click()
    await page.getByRole('button', { name: 'Load data', exact: true }).click()
    await expect(page.getByRole('table')).toBeVisible()
    await page.getByLabel('Select record ' + ids[0]).check()
    for (const format of formats) {
      await page.getByLabel('Phone export format').selectOption(format)
      await page.getByRole('button', { name: 'Export selected (1)…', exact: true }).click()
      await expect(page.locator('.phone-tools-status')).toContainText('1 records saved:')
      const saved = await desktop.evaluate(() => globalThis.phoneTest.saves.at(-1)), content = await readFile(saved, 'utf8')
      assert.equal(path.extname(saved), '.' + format)
      if (format === 'vcf') assert.equal(content, contacts[0].vcard)
      if (format === 'json') { const data = JSON.parse(content); assert.equal(data.recordCount, 1); assert.deepEqual(data.records.map(row => row.id), ids) }
      if (format === 'html') { assert.ok(content.includes('&lt;script&gt;')); assert.ok(!content.includes('<script>')); assert.ok(content.includes(sms[0].body.split('\n')[0])) }
      if (format === 'csv') assert.ok(content.startsWith('\ufeff'))
    }
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  }
  await desktop.evaluate(() => { globalThis.phoneTest.hold = true })
  assert.equal((await request({ type: 'phoneTools.read', kind: 'contacts', target, range: {} })).ok, true)
  await expect.poll(() => desktop.evaluate(() => globalThis.phoneTest.commands.at(-1)?.args.at(-1))).toContain('app_process')
  for (const r of [{ type: 'components.detect' }, { type: 'apps.refresh', id: 'phone' }, { type: 'monitor.read', id: 'phone', tab: 'battery' }]) {
    const reply = await request(r); assert.equal(reply.ok, false); assert.match(reply.error, /clipboard or phone data/)
  }
  await page.getByRole('button', { name: 'Cancel phone operation', exact: true }).click()
  await expect.poll(async () => (await request({ type: 'snapshot' })).snapshot.phoneTools.job.status).toBe('cancelled')
  await page.getByRole('button', { name: 'Export contacts', exact: true }).click()
  await page.screenshot({ path: path.join(root, 'phone-tools.png') })
  assert.deepEqual(errors, [])
  await writeFile(path.join(root, 'result.json'), JSON.stringify({ success: true, hardware: false, systemClipboard: false, exportedFiles: await desktop.evaluate(() => globalThis.phoneTest.saves) }, null, 2))
  console.log('PASS: native Electron clipboard IPC, input/target validation, all six export formats, actual local files, conflict guards and cancellation. ADB and OS clipboard mocked.')
  console.log(root)
} catch (error) {
  if (desktop) {
    const page = await desktop.firstWindow()
    console.error('Dialog:', await page.locator('.phone-tools-dialog').innerText().catch(() => 'Unavailable'))
    await page.screenshot({ path: path.join(root, 'failure.png') }).catch(() => {})
  }
  throw error
} finally {
  if (desktop) await desktop.evaluate(() => globalThis.phoneTest?.backend.phoneTools.shutdown()).catch(() => {})
  await desktop?.close()
}
