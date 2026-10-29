// Isolated Electron/media check. No Backend, ADB discovery, credentials or user profile are loaded.
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { _electron as electron, expect } from '@playwright/test'

const root = path.resolve('desktop-test-results/file-viewer-native')
await fs.mkdir(root, { recursive: true })
const wav = Buffer.alloc(44 + 16000)
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16000, 40)
await fs.writeFile(path.join(root, 'sample.wav'), wav)
await fs.writeFile(path.join(root, 'sample.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2OOUAAAAASUVORK5CYII=', 'base64'))
await fs.writeFile(path.join(root, 'preload.cjs'), `const { contextBridge, ipcRenderer } = require('electron'); contextBridge.exposeInMainWorld('mediaTest', { open: name => ipcRenderer.invoke('open', name), video: bytes => ipcRenderer.invoke('video', bytes), phone: () => ipcRenderer.invoke('phone') });`)
const csp = (await fs.readFile('index.html', 'utf8')).match(/<meta http-equiv="Content-Security-Policy"[^>]+>/)[0]
await fs.writeFile(path.join(root, 'index.html'), `<!doctype html><html><head>${csp}</head><body><img id="image" alt="sample"><img id="phone" alt="phone preview"><img id="thumbnail" alt="phone thumbnail"><audio id="audio" controls></audio><video id="video" controls></video></body></html>`)
await fs.writeFile(path.join(root, 'main.mjs'), `
import { app, BrowserWindow, protocol, ipcMain } from 'electron';
import * as fs from 'node:fs/promises';
import { FilePreviewService } from ${JSON.stringify(pathToFileURL(path.resolve('dist-electron/file-preview.js')).href)};
import { FileIO } from ${JSON.stringify(pathToFileURL(path.resolve('dist-electron/files.js')).href)};
import { validateRequest } from ${JSON.stringify(pathToFileURL(path.resolve('dist-electron/backend.js')).href)};
import { fileThumbnail } from ${JSON.stringify(pathToFileURL(path.resolve('dist-electron/files-desktop.js')).href)};
import { installViewerPermissions } from ${JSON.stringify(pathToFileURL(path.resolve('dist-electron/viewer-permissions.js')).href)};
const root = ${JSON.stringify(root)};
protocol.registerSchemesAsPrivileged([{ scheme: 'vault-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }]);
const io = new FileIO(() => null, () => ({ devices: [] })), previews = new FilePreviewService(io);
app.whenReady().then(async () => {
protocol.handle('vault-media', r => previews.respond(r));
ipcMain.handle('open', async (_event, name) => {
  if (!['sample.png', 'sample.wav', 'sample.webm'].includes(name)) throw Error('Unknown fixture');
  const location = { kind: 'local', path: root + '/' + name }, entry = await io.stat(location);
  validateRequest({ type: 'files.preview', requestId: name, location, fingerprint: entry.fingerprint });
  return previews.open(name, location, entry.fingerprint);
});
// Exercise Android CRLF metadata through the actual request validator, transfer
// completion checks and both preview routes, without accessing a real phone.
const png = await fs.readFile(root + '/sample.png');
const phone = { id: 'fixture', serial: 'PHONE', transportId: '3', status: 'connected' };
const phoneLocation = { kind: 'device', id: phone.id, serial: phone.serial, transportId: phone.transportId, path: '/sdcard/sample.png' };
const phoneIO = new FileIO(() => 'fixture-adb', () => ({ devices: [phone] }), async (_exe, args, _timeout, _input, _env, controls) => {
  if (!controls?.stdoutFile) return { code: 0, stderr: '', stdout: '81f8\\t' + png.length + '\\t1765294784\\t0\\t0\\t152868\\t1765485141\\t2025-12-09 14:39:44.549616531 +0300\\r\\n/sdcard/sample.png\\0' };
  const token = args.at(-1).match(/ADB_VAULT_EXPORT_([a-f0-9-]{36})/)[1];
  await fs.writeFile(controls.stdoutFile, Buffer.concat([png, Buffer.from('\\nADB_VAULT_EXPORT_' + token + ':0\\n')]));
  return { code: 0, stderr: '', stdout: '' };
});
const phoneEntry = await phoneIO.stat(phoneLocation);
for (const type of ['files.preview', 'files.thumbnail']) validateRequest({ type, requestId: 'phone-fixture', location: phoneLocation, fingerprint: phoneEntry.fingerprint });
const phonePreviews = new FilePreviewService(phoneIO);
const phonePreview = await phonePreviews.open('phone-fixture', phoneLocation, phoneEntry.fingerprint);
const phoneThumbnail = await fileThumbnail(phoneIO, phoneLocation, phoneEntry.fingerprint, new AbortController().signal);
if (!phoneThumbnail) throw Error('Android thumbnail missing');
ipcMain.handle('phone', () => ({ preview: phonePreview.url, thumbnail: phoneThumbnail }));
const originalRespond = previews.respond.bind(previews);
protocol.unhandle('vault-media');
protocol.handle('vault-media', async r => { const reply = await originalRespond(r); return reply.status === 404 ? phonePreviews.respond(r) : reply; });
ipcMain.handle('video', (_e, bytes) => fs.writeFile(root + '/sample.webm', Buffer.from(bytes)));
const window = new BrowserWindow({ show: false, webPreferences: { preload: root + '/preload.cjs', sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
installViewerPermissions(window.webContents);
await window.loadFile(root + '/index.html');
let stopped = false;
app.on('before-quit', e => { if (!stopped) { e.preventDefault(); void Promise.all([previews.shutdown(), phonePreviews.shutdown()]).finally(() => { stopped = true; app.quit(); }); } });
app.on('window-all-closed', () => app.quit());
}).catch(error => { console.error(error); app.exit(1); });
`)
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
let app
try {
  app = await electron.launch({ ...(process.env.ADB_VAULT_TEST_EXECUTABLE ? { executablePath: path.resolve(process.env.ADB_VAULT_TEST_EXECUTABLE) } : {}), args: [path.join(root, 'main.mjs'), `--user-data-dir=${path.join(root, 'profile')}`], env, timeout: 30000 })
  const page = await app.firstWindow(), errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.evaluate(async () => {
    document.querySelector('#image').src = (await window.mediaTest.open('sample.png')).url
    const phone = await window.mediaTest.phone()
    document.querySelector('#phone').src = phone.preview
    document.querySelector('#thumbnail').src = phone.thumbnail
    document.querySelector('#audio').src = (await window.mediaTest.open('sample.wav')).url
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90
    const stream = canvas.captureStream(0), recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' }), chunks = []
    recorder.ondataavailable = e => chunks.push(e.data)
    const done = new Promise(resolve => { recorder.onstop = resolve })
    recorder.start()
    for (let i = 0; i < 8; i++) { canvas.getContext('2d').fillStyle = i % 2 ? '#227d62' : '#acdaca'; canvas.getContext('2d').fillRect(0, 0, 160, 90); stream.getVideoTracks()[0].requestFrame(); await new Promise(resolve => setTimeout(resolve, 100)) }
    recorder.stop(); await done; stream.getTracks().forEach(t => t.stop())
    await window.mediaTest.video([...new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer())])
    document.querySelector('#video').src = (await window.mediaTest.open('sample.webm')).url
  })
  await expect.poll(() => page.locator('#image').evaluate(e => e.naturalWidth)).toBe(1)
  await expect.poll(() => page.locator('#phone').evaluate(e => e.naturalWidth)).toBe(1)
  await expect.poll(() => page.locator('#thumbnail').evaluate(e => e.naturalWidth)).toBe(1)
  await expect.poll(() => page.locator('#audio').evaluate(e => e.readyState)).toBeGreaterThanOrEqual(2)
  await expect.poll(() => page.locator('#video').evaluate(e => e.readyState)).toBeGreaterThanOrEqual(2)
  const report = await page.evaluate(async () => {
    const audio = document.querySelector('#audio'), video = document.querySelector('#video')
    audio.currentTime = .25; video.currentTime = .2
    await new Promise(resolve => setTimeout(resolve, 200))
    return { image: document.querySelector('#image').naturalWidth, phonePreview: document.querySelector('#phone').naturalWidth, phoneThumbnail: document.querySelector('#thumbnail').naturalWidth, audioDuration: audio.duration, audioSeek: audio.currentTime, videoWidth: video.videoWidth, videoSeek: video.currentTime }
  })
  assert.equal(report.audioDuration, 1); assert.equal(report.videoWidth, 160); assert.equal(report.audioSeek, .25); assert.equal(report.videoSeek, .2); assert.deepEqual(errors, [])
  // Production permission handlers previously denied even native video fullscreen.
  await page.locator('#video').evaluate(video => video.requestFullscreen())
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id)).toBe('video')
  report.fullscreen = true
  await page.evaluate(() => document.exitFullscreen())
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true)
  report.fullscreenExit = true
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} catch (error) {
  if (app) {
    const page = await app.firstWindow()
    console.error('Media diagnostics:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('audio,video')].map(media => ({ id: media.id, readyState: media.readyState, networkState: media.networkState, error: media.error && { code: media.error.code, message: media.error.message }, source: media.currentSrc }))), null, 2))
    console.error('Electron:', await app.evaluate(() => process.versions.electron))
  }
  throw error
} finally { if (app) await app.close() }
