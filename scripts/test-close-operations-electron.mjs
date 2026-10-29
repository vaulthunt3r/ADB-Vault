import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

// Real main-window / app.quit hooks; isolated preferences and simulated work only.
// Never connects to a phone, starts an installer or stops an existing ADB server.
await mkdir('desktop-test-results', { recursive: true })
const root = await mkdtemp(path.resolve('desktop-test-results/close-operations-'))
const harness = path.join(root, 'main.mjs')
await writeFile(harness, `
import { dialog } from 'electron';
import { appendFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { Backend } from ${JSON.stringify(pathToFileURL(path.resolve('dist-electron/backend.js')).href)};
const log = text => appendFileSync(process.env.EXIT_TEST_LOG, text + '\\n');
const t = globalThis.closeTest = { prompts: [], shutdowns: 0, log, EventEmitter };
const initialize = Backend.prototype.initialize;
dialog.showMessageBox = async (...args) => {
  const options = args.at(-1);
  t.prompts.push(options);
  return new Promise(resolve => { t.answer = response => { t.answer = null; resolve({ response }); }; });
};
Backend.prototype.initialize = async function () {
  t.backend = this;
  this.storage.data.stopAdbOnExit = false;
  this.lifecycle.execute = async () => { throw new Error('Unexpected device command in close test'); };
  this.components.locate = async () => {
    await new Promise(resolve => { t.finishComponent = resolve; });
    await this.storage.save();
    log('component-finished');
  };
  const original = this.stopServices.bind(this);
  this.stopServices = async () => {
    t.shutdowns++; log('shutdown-start');
    await original(); log('shutdown-complete');
  };
  if (process.env.EXIT_TEST_CASE === 'startup') {
    this.geoip.initialize = this.databases.initialize = async () => {};
    this.components.detect = async () => { t.detectStarted = true; await new Promise(resolve => { t.finishDetection = resolve; }); log('detection-finished'); };
    this.connection.start = () => log('unexpected-poll-start');
    this.components.refreshPackages = async () => log('unexpected-metadata-start');
    return initialize.call(this);
  }
};
await import(${JSON.stringify(pathToFileURL(path.resolve('dist-electron/main.js')).href)});
`)

async function launch(name) {
  const log = path.join(root, name + '.txt'); await writeFile(log, '')
  const env = { ...process.env, ADB_VAULT_SMOKE_TEST: '1', EXIT_TEST_LOG: log, EXIT_TEST_CASE: name }
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL
  const desktop = await electron.launch({ args: [harness, '--user-data-dir=' + path.join(root, name)], env })
  const page = await desktop.firstWindow(); await page.waitForFunction(() => !!window.desktop)
  return { desktop, page, log }
}
const promptCount = desktop => desktop.evaluate(() => globalThis.closeTest.prompts.length)
const answer = (desktop, response) => desktop.evaluate((_, response) => globalThis.closeTest.answer(response), response)
const closeWindow = desktop => desktop.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close() })
const quit = desktop => desktop.evaluate(({ app }) => { app.quit() })

{
  const { desktop, page, log } = await launch('component-request')
  try {
    await desktop.evaluate(() => { const t = globalThis.closeTest; t.request = t.backend.request({ type: 'components.locate', id: 'adb', folder: 'C:\\isolated-test' }) })
    await closeWindow(desktop)
    await expect.poll(() => promptCount(desktop)).toBe(1)
    const prompt = await desktop.evaluate(() => globalThis.closeTest.prompts[0])
    assert.match(prompt.detail, /Components/); assert.equal(prompt.defaultId, 0); assert.equal(prompt.cancelId, 0)
    assert.deepEqual(prompt.buttons, ['Keep working', 'Close safely'])
    await closeWindow(desktop); await quit(desktop)
    assert.equal(await promptCount(desktop), 1)
    await answer(desktop, 0)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
    assert.equal(await desktop.evaluate(() => globalThis.closeTest.backend.closing), false)
    assert.equal(await desktop.evaluate(() => globalThis.closeTest.shutdowns), 0)
    await quit(desktop)
    await expect.poll(() => promptCount(desktop)).toBe(2)
    await answer(desktop, 1)
    await expect.poll(() => desktop.evaluate(() => globalThis.closeTest.shutdowns)).toBe(1)
    assert.equal(page.isClosed(), false)
    const late = await desktop.evaluate(() => globalThis.closeTest.backend.request({ type: 'files.chooseFolder' }))
    assert.equal(late.ok, false); assert.match(late.error, /closing/)
    await closeWindow(desktop); assert.equal(await promptCount(desktop), 2)
    const closed = desktop.waitForEvent('close', { timeout: 15000 })
    await desktop.evaluate(() => { globalThis.closeTest.finishComponent() })
    await closed
    assert.match(await readFile(log, 'utf8'), /shutdown-start\r?\ncomponent-finished\r?\nshutdown-complete/)
    console.log('PASS: pending component IPC is protected; Cancel preserves it; repeated quit coalesces; confirmed exit waits and fences new work.')
  } finally { if (!page.isClosed()) await desktop.evaluate(({ app }) => app.exit(1)).catch(() => {}) }
}

{
  const { desktop, page, log } = await launch('background-work')
  try {
    await desktop.evaluate(({ BrowserWindow }) => {
      const t = globalThis.closeTest, b = t.backend
      b.files.state.tasks = [{ status: 'paused' }, { status: 'conflict' }, { status: 'queued' }]
      b.apps.state.backgroundUserId = 10
      b.backups.state = { status: 'running' }
      b.restores.state = { status: 'confirming' }
      b.androidDiagnostics.state.job = { status: 'running', kind: 'bugreport' }
      b.connection.state.qr = { status: 'waiting', expiresAt: Date.now() + 60000 }
      BrowserWindow.getAllWindows()[0].webContents.emit('media-started-playing')
    })
    await quit(desktop)
    await expect.poll(() => promptCount(desktop)).toBe(1)
    const detail = await desktop.evaluate(() => globalThis.closeTest.prompts[0].detail)
    for (const text of ['paused file tasks', 'Reading applications', 'Exporting applications', 'restoring applications', 'bug report', 'QR pairing', 'Audio or video']) assert.ok(detail.includes(text), text)
    await answer(desktop, 0)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
    assert.equal(await desktop.evaluate(() => globalThis.closeTest.backend.backups.state.status), 'running')
    await closeWindow(desktop); await expect.poll(() => promptCount(desktop)).toBe(2)
    const closed = desktop.waitForEvent('close', { timeout: 15000 })
    await answer(desktop, 1); await closed
    assert.match(await readFile(log, 'utf8'), /shutdown-complete/)
    console.log('PASS: app.quit and window close protect detached Apps, Files, diagnostics, pairing and media work together.')
  } finally { if (!page.isClosed()) await desktop.evaluate(({ app }) => app.exit(1)).catch(() => {}) }
}

{
  const { desktop, page, log } = await launch('activity-export')
  try {
    await desktop.evaluate(({ BrowserWindow }) => {
      const t = globalThis.closeTest, contents = BrowserWindow.getAllWindows()[0].webContents
      const item = new t.EventEmitter()
      item.cancel = () => { t.log('export-cancelled'); item.emit('done') }
      contents.session.emit('will-download', { preventDefault() {} }, item, contents)
    })
    await closeWindow(desktop); await expect.poll(() => promptCount(desktop)).toBe(1)
    assert.match(await desktop.evaluate(() => globalThis.closeTest.prompts[0].detail), /Activity · Saving exported history/)
    const closed = desktop.waitForEvent('close', { timeout: 15000 })
    await answer(desktop, 1); await closed
    assert.match(await readFile(log, 'utf8'), /export-cancelled/)
    console.log('PASS: renderer history export is protected and cancelled only after confirmation.')
  } finally { if (!page.isClosed()) await desktop.evaluate(({ app }) => app.exit(1)).catch(() => {}) }
}

{
  const { desktop, page, log } = await launch('startup')
  try {
    await expect.poll(() => desktop.evaluate(() => globalThis.closeTest.detectStarted)).toBe(true)
    await closeWindow(desktop); await expect.poll(() => promptCount(desktop)).toBe(1)
    assert.match(await desktop.evaluate(() => globalThis.closeTest.prompts[0].detail), /Components/)
    await answer(desktop, 1)
    assert.equal(page.isClosed(), false)
    const closed = desktop.waitForEvent('close', { timeout: 15000 })
    await desktop.evaluate(() => { globalThis.closeTest.finishDetection() }); await closed
    const events = await readFile(log, 'utf8')
    assert.match(events, /detection-finished/); assert.match(events, /shutdown-complete/)
    assert.doesNotMatch(events, /unexpected-/)
    console.log('PASS: close during startup waits for detection and prevents late polling or metadata requests.')
  } finally { if (!page.isClosed()) await desktop.evaluate(({ app }) => app.exit(1)).catch(() => {}) }
}

{
  const { desktop, page, log } = await launch('idle')
  try {
    const closed = desktop.waitForEvent('close', { timeout: 15000 })
    await closeWindow(desktop); await closed
    assert.match(await readFile(log, 'utf8'), /shutdown-start\r?\nshutdown-complete/)
    console.log('PASS: idle application closes without a redundant warning.')
  } finally { if (!page.isClosed()) await desktop.evaluate(({ app }) => app.exit(1)).catch(() => {}) }
}
