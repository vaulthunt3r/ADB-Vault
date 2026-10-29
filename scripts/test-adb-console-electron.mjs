import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

await mkdir('desktop-test-results', { recursive: true })
const root = await mkdtemp(path.resolve('desktop-test-results/adb-console-ipc-'))
const harness = path.join(root, 'main.mjs')
await writeFile(harness, `
import { Backend } from ${JSON.stringify(pathToFileURL(path.resolve('dist-electron/backend.js')).href)};
globalThis.consoleTest = { commands: [], hold: false };
Backend.prototype.initialize = async function () {
  const test = globalThis.consoleTest; test.backend = this;
  this.storage.data.stopAdbOnExit = false;
  this.components.adbPath = () => 'adb.exe';
  this.components.records.forEach(c => c.status = 'Detected');
  this.databases.records.forEach(c => c.status = 'Not installed');
  this.connection.state = { ...this.connection.state, adbAvailable: true, activeDeviceId: 'phone', devices: [{ id: 'phone', serial: 'TEST', transportId: '7', hardwareId: 'PHONE', name: 'Test phone', android: '16', status: 'connected', method: 'USB', endpoint: 'TEST', known: false, canDetach: false, lastSeen: '' }] };
  this.lifecycle.execute = async (file, args, timeout, input, env, options) => {
    test.commands.push(args);
    if (args[0] !== '-t' || args[1] !== '7') throw new Error('Unexpected target');
    options.onStdout?.('Test phone model\\n');
    options.onStderr?.('stderr diagnostic\\n');
    if (test.hold) return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
    return { code: 0, stdout: 'Test phone model\\n', stderr: 'stderr diagnostic\\n' };
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
  const target = { id: 'phone', serial: 'TEST', transportId: '7' }
  const command = { type: 'console.run', mode: 'adb', command: 'shell getprop ro.product.model', timeout: 30000, target }
  const request = value => page.evaluate(r => window.desktop.request(r), value)
  for (const patch of [{ mode: 'cmd' }, { command: '' }, { timeout: -1 }, { target: { ...target, serial: 'OTHER' } }, { command: '-s OTHER shell id' }]) {
    assert.equal((await request({ ...command, ...patch })).ok, false)
  }
  assert.equal(await desktop.evaluate(() => globalThis.consoleTest.commands.length), 0)
  await page.getByRole('navigation').getByRole('button', { name: 'Console', exact: true }).click()
  await page.getByRole('button', { name: 'Device model', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Run command', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Run command', exact: true }).click()
  await expect(page.locator('.console-result')).toHaveText('Exit 0')
  await expect(page.getByLabel('Command output', { exact: true })).toContainText('Test phone model')
  await expect(page.locator('.console-stderr')).toHaveText('stderr diagnostic\n')
  assert.deepEqual(await desktop.evaluate(() => globalThis.consoleTest.commands[0]), ['-t', '7', 'shell', '-T', 'getprop ro.product.model'])
  await desktop.evaluate(() => { globalThis.consoleTest.hold = true })
  await page.getByLabel('Console mode').selectOption('shell')
  await page.getByLabel('Console command', { exact: true }).fill('logcat')
  await page.getByRole('button', { name: 'Run command', exact: true }).click()
  await expect(page.locator('.console-result')).toHaveText('Running')
  for (const r of [{ type: 'components.detect' }, { type: 'apps.refresh', id: 'phone' }, { type: 'monitor.read', id: 'phone', tab: 'battery' }]) {
    const reply = await request(r)
    assert.equal(reply.ok, false); assert.match(reply.error, /console command/)
  }
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(page.locator('.console-result')).toHaveText('Stopped')
  assert.equal((await request({ type: 'snapshot' })).snapshot.adbConsole.run.status, 'cancelled')
  await page.screenshot({ path: path.join(root, 'console.png') })
  await page.getByRole('button', { name: 'Clear session', exact: true }).click()
  assert.equal((await request({ type: 'snapshot' })).snapshot.adbConsole.run, null)
  assert.deepEqual(errors, [])
  await writeFile(path.join(root, 'result.json'), JSON.stringify({ success: true, commands: await desktop.evaluate(() => globalThis.consoleTest.commands), hardware: false }, null, 2))
  console.log('PASS: Electron console IPC, input validation, streaming stdout/stderr, device binding, conflict guards, stop, clear and UI. ADB mocked.')
} catch (error) {
  if (desktop) {
    const page = await desktop.firstWindow()
    console.error('Console test state:', await page.locator('.adb-console-section').innerText().catch(() => 'Unavailable'))
    const snapshot = await page.evaluate(async () => (await window.desktop.request({ type: 'snapshot' })).snapshot).catch(() => null)
    console.error('Console test snapshot:', JSON.stringify(snapshot && { components: snapshot.components.map(c => [c.id, c.status]), connection: snapshot.connection, apps: snapshot.apps, console: snapshot.adbConsole }))
    await page.screenshot({ path: path.join(root, 'failure.png') }).catch(() => {})
  }
  throw error
} finally {
  if (desktop) await desktop.evaluate(() => globalThis.consoleTest?.backend.adbConsole.shutdown()).catch(() => {})
  await desktop?.close()
}
