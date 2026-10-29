// Isolated native MP3 playback/seek regression. No Backend, ADB or user profile.
// Usage: node scripts/check-file-audio-seek-desktop.mjs <generated-test.mp3>
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { _electron as electron, expect } from '@playwright/test'

assert.ok(process.argv[2], 'Supply an MP3 test fixture at least 8 minutes long.')
const input = path.resolve(process.argv[2]), root = path.resolve('desktop-test-results/file-audio-seek')
await fs.mkdir(root, { recursive: true })
await fs.writeFile(path.join(root, 'preload.cjs'), `const { contextBridge, ipcRenderer } = require('electron'); contextBridge.exposeInMainWorld('audioTest', { open: kind => ipcRenderer.invoke('open', kind), report: () => ipcRenderer.invoke('report') });`)
const csp = (await fs.readFile('index.html', 'utf8')).match(/<meta http-equiv="Content-Security-Policy"[^>]+>/)[0]
await fs.writeFile(path.join(root, 'index.html'), `<!doctype html><html><head>${csp}</head><body><audio controls autoplay preload="metadata"></audio></body></html>`)
await fs.writeFile(path.join(root, 'main.mjs'), `
import { app, BrowserWindow, protocol, ipcMain } from 'electron';
import * as fs from 'node:fs/promises';
import { FilePreviewService } from ${JSON.stringify(pathToFileURL(path.resolve('dist-electron/file-preview.js')).href)};
import { FileIO } from ${JSON.stringify(pathToFileURL(path.resolve('dist-electron/files.js')).href)};
const root = ${JSON.stringify(root)}, input = ${JSON.stringify(input)};
protocol.registerSchemesAsPrivileged([{ scheme: 'vault-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }]);
const localIO = new FileIO(() => null, () => ({ devices: [] }));
const entry = await localIO.stat({ kind: 'local', path: input });
let downloads = 0;
// Exercise the complete phone-copy preparation path with generated test media.
const phoneIO = { stat: async () => entry, device: () => ({}), command: async (_location, _command, signal, output, progress) => {
  signal.throwIfAborted(); await fs.copyFile(input, output); downloads++; progress(entry.size); signal.throwIfAborted();
} };
const previews = { local: new FilePreviewService(localIO), phone: new FilePreviewService(phoneIO) };
const requests = [], errors = [];
app.whenReady().then(async () => {
  protocol.handle('vault-media', async r => {
    try {
      let reply = await previews.local.respond(r);
      if (reply.status === 404) reply = await previews.phone.respond(r);
      requests.push({ range: r.headers.get('range'), status: reply.status });
      return reply;
    } catch (e) { errors.push(String(e)); throw e; }
  });
  ipcMain.handle('open', (_event, kind) => {
    if (!['local', 'phone'].includes(kind)) throw Error('Unknown fixture');
    return previews[kind].open(kind, kind === 'local' ? { kind, path: input } : { kind: 'device', path: '/sdcard/test.mp3' }, entry.fingerprint);
  });
  ipcMain.handle('report', () => ({ downloads, requests, errors }));
  const window = new BrowserWindow({ show: false, webPreferences: { preload: root + '/preload.cjs', sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await window.loadFile(root + '/index.html');
  let stopped = false;
  app.on('before-quit', e => { if (!stopped) { e.preventDefault(); void Promise.all(Object.values(previews).map(p => p.shutdown())).finally(() => { stopped = true; app.quit(); }); } });
  app.on('window-all-closed', () => app.quit());
}).catch(e => { console.error(e); app.exit(1); });
`)
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
let app
try {
  app = await electron.launch({ args: [path.join(root, 'main.mjs'), `--user-data-dir=${path.join(root, 'profile')}`], env, timeout: 30000 })
  const page = await app.firstWindow(), report = {}
  for (const kind of ['local', 'phone']) {
    const url = await page.evaluate(async kind => (await window.audioTest.open(kind)).url, kind)
    // Chromium abandons a response on seek. Cancel an actual protocol response
    // before playback too, so small caches cannot hide a closed shared handle.
    await app.evaluate(async ({ net }, url) => {
      const response = await net.fetch(url), reader = response.body.getReader()
      await reader.read(); await reader.cancel()
      const part = await net.fetch(url, { headers: { Range: 'bytes=1000000-1001023' } })
      if (part.status !== 206 || (await part.arrayBuffer()).byteLength !== 1024) throw Error('Range failed after cancellation')
    }, url)
    const audio = page.locator('audio')
    await audio.evaluate((a, url) => { a.src = url }, url)
    await expect.poll(() => audio.evaluate(a => a.readyState)).toBeGreaterThanOrEqual(2)
    assert.ok(await audio.evaluate(a => a.duration > 480))
    await expect.poll(() => audio.evaluate(a => !a.paused && a.currentTime > 0)).toBe(true)
    const seeks = []
    for (const time of [120, 450, 30, 300]) {
      await audio.evaluate((a, time) => { a.currentTime = time }, time)
      await expect.poll(() => audio.evaluate(a => ({ error: a.error?.code || null, seeking: a.seeking, playing: !a.paused }))).toEqual({ error: null, seeking: false, playing: true })
      await expect.poll(() => audio.evaluate(a => a.currentTime)).toBeGreaterThan(time + .1)
      seeks.push(await audio.evaluate(a => a.currentTime))
    }
    report[kind] = { duration: await audio.evaluate(a => a.duration), seeks }
    await audio.evaluate(a => { a.pause(); a.removeAttribute('src'); a.load() })
  }
  const transport = await page.evaluate(() => window.audioTest.report())
  assert.equal(transport.downloads, 1); assert.deepEqual(transport.errors, [])
  assert.ok(transport.requests.filter(r => r.status === 206).length >= 4)
  report.transport = transport
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} finally { if (app) await app.close() }
