// Real sandboxed camera preload and production UI, with simulated camera IPC.
// Uses an isolated profile and a hidden window; no phone or camera is accessed.
import { _electron as electron, expect } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
const root = await mkdtemp(path.resolve('desktop-test-results/camera-runtime-'))
const preload = path.resolve('dist-electron/camera-preload.cjs')
const index = path.resolve('dist/index.html')
const main = path.join(root, 'main.mjs')
await writeFile(main, `
import { app, BrowserWindow, ipcMain } from 'electron';
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 336, height: 440, webPreferences: { preload: ${JSON.stringify(preload)}, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const session = { id: 'camera-runtime', deviceId: 'fixture', deviceName: 'Test phone', mode: 'camera', title: 'Window 1 · Camera', startedAt: new Date().toISOString(), canSetAlwaysOnTop: true, alwaysOnTop: false, camera: { facing: 'back', id: '', audio: 'mic', recordFormat: 'mkv' }, cameraControls: ['zoom-in', 'zoom-out', 'torch-on', 'torch-off', 'rotate-left', 'rotate-right'] };
  let layout = { docked: true, collapsed: false, shortcut: 'Ctrl+Alt+C', shortcutAvailable: true };
  globalThis.cameraRuntime = { requests: [], session };
  ipcMain.handle('camera:state', () => session);
  ipcMain.handle('camera:layout', (_event, change) => { if (change) { layout = { ...layout, ...change }; window.webContents.send('camera:layout', layout); } return layout; });
  ipcMain.handle('camera:hide', () => window.hide());
  ipcMain.handle('camera:request', (_event, request) => {
    globalThis.cameraRuntime.requests.push(request);
    if (request.kind === 'always-on-top') { window.setAlwaysOnTop(request.enabled); session.alwaysOnTop = request.enabled; window.webContents.send('camera:state', session); }
    return { ok: true };
  });
  await window.loadFile(${JSON.stringify(index)}, { hash: 'camera-session=camera-runtime' });
});
app.on('window-all-closed', () => app.quit());
`)
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL
let app
try {
  app = await electron.launch({ args: [main, `--user-data-dir=${path.join(root, 'profile')}`], env, timeout: 30000 })
  const page = await app.firstWindow(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await expect(page.getByText('Live preview', { exact: true })).toBeAttached()
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await page.getByRole('button', { name: 'Zoom in', exact: true }).evaluate(button => button.click())
  assert.deepEqual(await app.evaluate(() => globalThis.cameraRuntime.requests.at(-1)), { kind: 'control', command: 'zoom-in' })
  const pin = page.getByRole('button', { name: 'Always on top', exact: true })
  await pin.evaluate(button => button.click())
  await expect(pin).toHaveAttribute('aria-pressed', 'true')
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop()), true)
  await pin.evaluate(button => button.click())
  await expect(pin).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('button', { name: 'Collapse camera controls', exact: true }).evaluate(button => button.click())
  await expect(page.getByRole('button', { name: 'Expand camera controls', exact: true })).toBeAttached()
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.isVisible())), false)
  assert.deepEqual(errors, [])
  console.log('PASS: camera sandboxed preload, real IPC, English UI, zoom action, native pin/unpin and collapse; no renderer errors. Electron ' + await app.evaluate(() => process.versions.electron))
} finally { if (app) await app.close() }
