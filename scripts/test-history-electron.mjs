import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

// The real backend, local copy engine, history files and Electron process restart.
// All inputs, destinations and preferences live in a unique test directory. No ADB.
await mkdir('desktop-test-results', { recursive: true })
const root = await mkdtemp(path.resolve('desktop-test-results/history-electron-'))
const source = path.join(root, 'source'), target = path.join(root, 'destination'), profile = path.join(root, 'profile')
await mkdir(source); await mkdir(target)
for (const name of ['a.txt', 'b.txt', 'c.txt']) await writeFile(path.join(source, name), name + ' content')
const harness = path.join(root, 'main.mjs')
await writeFile(harness, `
import { Backend } from ${JSON.stringify(pathToFileURL(path.resolve('dist-electron/backend.js')).href)};
Backend.prototype.initialize = async function () {
  globalThis.historyTest = { backend: this };
  this.storage.data.stopAdbOnExit = false;
  this.lifecycle.execute = async () => { throw new Error('Unexpected ADB access during history test'); };
  const original = this.files.io.transfer.bind(this.files.io);
  this.files.io.transfer = async (from, to, signal, progress) => {
    if (from.path.endsWith('b.txt')) {
      globalThis.historyTest.waiting = true;
      await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Task stopped.')), { once: true }));
    }
    return original(from, to, signal, progress);
  };
};
await import(${JSON.stringify(pathToFileURL(path.resolve('dist-electron/main.js')).href)});
`)
async function launch() {
  const env = { ...process.env, ADB_VAULT_SMOKE_TEST: '1' }; delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL
  const desktop = await electron.launch({ args: [harness, '--user-data-dir=' + profile], env })
  const page = await desktop.firstWindow(); await page.waitForFunction(() => !!window.desktop)
  return { desktop, page }
}

let active
try {
  active = await launch()
  const oldId = await active.desktop.evaluate(async (_, { source, target }) => {
    const b = globalThis.historyTest.backend, items = []
    for (const name of ['a.txt', 'b.txt', 'c.txt']) {
      const file = source + '/' + name, entry = await b.files.io.stat({ kind: 'local', path: file })
      items.push({ path: file, fingerprint: entry.fingerprint })
    }
    const reply = await b.request({ type: 'files.enqueue', plan: { action: 'copy', source: { kind: 'local', path: source }, destination: { kind: 'local', path: target }, items, conflict: 'ask', confirmed: true } })
    if (!reply.ok) throw new Error(reply.error)
    return b.history.overview().current.id
  }, { source, target })
  await expect.poll(() => active.desktop.evaluate(() => !!globalThis.historyTest.waiting)).toBe(true)
  await active.desktop.evaluate(() => globalThis.historyTest.backend.history.flush())
  assert.equal(await readFile(path.join(target, 'a.txt'), 'utf8'), 'a.txt content')
  const killed = active.desktop.waitForEvent('close')
  await active.desktop.evaluate(({ app }) => { app.exit(9) }); await killed
  active = null

  const before = await readdir(target)
  active = await launch()
  const recovered = await active.desktop.evaluate(async (_, id) => {
    const b = globalThis.historyTest.backend
    const old = await b.request({ type: 'history.read', sessionId: id })
    return { current: b.snapshot(), old }
  }, oldId)
  assert.notEqual(recovered.current.history.current.id, oldId)
  assert.deepEqual(recovered.current.files.tasks, [])
  assert.ok(recovered.old.ok)
  assert.equal(recovered.old.historySession.session.status, 'interrupted')
  assert.ok(recovered.old.historySession.activity.some(a => a.source === 'files' && a.interrupted && a.text.includes('Copy')))
  const saved = recovered.old.historySession.tasks[0]
  assert.equal(saved.status, 'interrupted'); assert.equal(saved.items[0].status, 'success')
  assert.equal(saved.items[1].status, 'interrupted'); assert.equal(saved.items[1].uncertain, true)
  assert.equal(saved.items[2].status, 'pending')
  assert.deepEqual(await readdir(target), before, 'reading history must not resume transfers or remove partial files')
  assert.ok(recovered.current.history.sessions.find(s => s.id === oldId).unfinished > 0)
  const normalId = recovered.current.history.current.id
  const closed = active.desktop.waitForEvent('close')
  await active.desktop.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close() }); await closed
  active = null

  active = await launch()
  const third = await active.desktop.evaluate(() => globalThis.historyTest.backend.snapshot())
  assert.equal(third.history.sessions.find(s => s.id === normalId).status, 'closed')
  assert.equal(third.history.sessions.find(s => s.id === oldId).status, 'interrupted')
  assert.deepEqual(third.files.tasks, [])
  assert.ok(!third.history.activity.some(a => a.text.includes('Session closed normally')), 'previous session events must not enter current Activity')
  const ended = active.desktop.waitForEvent('close')
  await active.desktop.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close() }); await ended
  active = null
  console.log('PASS: actual copy interrupted after file 1 survives process exit; file 2 is uncertain, file 3 pending; two restarts preserve session separation and never resume the queue.')
} finally { if (active) await active.desktop.evaluate(({ app }) => app.exit(1)).catch(() => {}) }
