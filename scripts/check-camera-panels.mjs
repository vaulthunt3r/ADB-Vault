import assert from 'node:assert/strict'
import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import path from 'node:path'
await mkdir('desktop-test-results', { recursive: true })
const profile = await mkdtemp(path.resolve('desktop-test-results/camera-panels-profile-'))
const env = { ...process.env, ADB_VAULT_SMOKE_TEST: '1' }; delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: path.resolve('node_modules/electron/dist/electron.exe'), args: [path.resolve('scripts/fixtures/camera-panels-host.mjs'), `--user-data-dir=${profile}`], env, timeout: 30000 })
const session = { id: 'camera-owned', deviceId: 'phone', deviceName: 'Camera test phone', title: 'Window 1 · Camera', mode: 'camera', startedAt: new Date().toISOString(), camera: { facing: 'back', id: '', audio: 'off', recordFormat: 'mkv' }, cameraControls: ['zoom-in', 'zoom-out', 'torch-on', 'torch-off', 'rotate-left', 'rotate-right'] }
try {
 await expect.poll(() => app.evaluate(() => !!globalThis.cameraPanelManager)).toBe(true)
 await app.evaluate((_electron, session) => globalThis.cameraPanelManager.sync([session]), session)
 await expect.poll(() => app.windows().length).toBe(2)
 const panel = app.windows().find(page => page.url().includes('#camera-session=')) || app.windows()[1]
 await expect(panel.getByRole('main', { name: 'Live camera controls' })).toBeAttached({ timeout: 30000 })
 await expect(panel.getByText('Live preview', { exact: true })).toBeAttached()
 const bridge = await panel.evaluate(() => ({ desktop: typeof window.desktop, camera: typeof window.cameraDesk }))
 assert.deepEqual(bridge, { desktop: 'undefined', camera: 'object' })
 const layout = await panel.evaluate(() => window.cameraDesk.layout())
 assert.equal(layout.docked, true)
 assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('#camera-session=')).isAlwaysOnTop()), false, 'Camera panels must not start above unrelated windows')
 await panel.evaluate(() => window.cameraDesk.layout({ collapsed: true }))
 const collapsedSize = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('#camera-session=')).getSize())
 assert.ok(collapsedSize[0] < 90, JSON.stringify(collapsedSize))
 await panel.evaluate(() => window.cameraDesk.layout({ collapsed: false }))
 const expandedSize = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('#camera-session=')).getSize())
 assert.ok(expandedSize[0] >= 330 && expandedSize[0] < 350 && Math.abs(expandedSize[1] - collapsedSize[1]) <= 1, JSON.stringify({ collapsedSize, expandedSize }))
 const stability = await app.evaluate(async ({ BrowserWindow, screen }) => {
   const manager = globalThis.cameraPanelManager
   clearTimeout(manager.timer); manager.timer = undefined
   const schedule = manager.schedule; manager.schedule = () => {}
   const window = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('#camera-session='))
   const before = window.getBounds(), readings = []
   try {
     for (let i = 0; i < 80; i++) {
       globalThis.cameraWindowState = { x: 80 + i % 20 * 2, y: 80 + i % 30 * 2, width: 400, height: 500, minimized: false, visible: true, foreground: true }
       await manager.follow(); readings.push(window.getBounds())
     }
   } finally { manager.schedule = schedule; manager.schedule() }
   return { before, readings, scale: screen.getPrimaryDisplay().scaleFactor }
 })
 // DIP edge rounding may differ by one, but repeated movement must not add size.
 for (const bounds of stability.readings) {
   assert.ok(Math.abs(bounds.width - stability.before.width) <= 1, JSON.stringify(stability))
   assert.ok(Math.abs(bounds.height - stability.before.height) <= 1, JSON.stringify(stability))
 }
 assert.ok(Math.abs(stability.readings.at(-1).x - stability.before.x) > 20)
 console.log(`PASS: 80 native docking moves preserve panel size at ${stability.scale * 100}% scaling.`)
 await app.evaluate(() => { globalThis.cameraWindowState = { x: 80, y: 80, width: 400, height: 500, minimized: false, visible: true, foreground: true } })
 await expect.poll(() => app.evaluate(({ BrowserWindow, screen }) => {
   const bounds = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('#camera-session=')).getBounds()
   const camera = screen.screenToDipRect(null, globalThis.cameraWindowState)
   return Math.abs(bounds.x - camera.x - camera.width - 8) < 2
 })).toBe(true)
 // A detached panel must drop even an inherited topmost camera policy.
 await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('#camera-session=')).setAlwaysOnTop(true))
 await panel.evaluate(() => window.cameraDesk.layout({ docked: false }))
 assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('#camera-session=')).isAlwaysOnTop()), false)
 // Restoring the floating position must also move without changing dimensions.
 const detachedSize = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('#camera-session=')).getSize())
 for (let i = 0; i < 8; i++) {
   await panel.evaluate(async () => { await window.cameraDesk.layout({ docked: true }); await window.cameraDesk.layout({ docked: false }) })
 }
 const afterDetachCycles = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('#camera-session=')).getSize())
 assert.ok(afterDetachCycles.every((size, i) => Math.abs(size - detachedSize[i]) <= 1))
 const detached = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('#camera-session=')).getBounds())
 await app.evaluate(() => { globalThis.cameraWindowState.x += 100; globalThis.cameraWindowState.y += 50 })
 await panel.waitForTimeout(400)
 assert.deepEqual(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('#camera-session=')).getBounds()), detached)
 await assert.rejects(panel.evaluate(() => window.cameraDesk.layout({ shortcut: 'C' })), /Use Ctrl/)
 await panel.evaluate(() => window.cameraDesk.layout({ shortcut: 'Ctrl+Alt+F8' }))
 assert.equal(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Ctrl+Alt+F8')), true)
 const blocked = await app.evaluate(({ globalShortcut }) => globalShortcut.register('Ctrl+Alt+F9', () => {}))
 if (blocked) {
   await assert.rejects(panel.evaluate(() => window.cameraDesk.layout({ shortcut: 'Ctrl+Alt+F9' })), /already in use/)
   assert.equal((await panel.evaluate(() => window.cameraDesk.layout())).shortcut, 'Ctrl+Alt+F8')
   await app.evaluate(({ globalShortcut }) => globalShortcut.unregister('Ctrl+Alt+F9'))
 }
 assert.deepEqual(JSON.parse(await readFile(path.join(profile, 'camera-panel.json'), 'utf8')), { docked: false, shortcut: 'Ctrl+Alt+F8' })
 await panel.evaluate(() => window.cameraDesk.request({ kind: 'control', command: 'zoom-in', sessionId: 'someone-else' }))
 assert.deepEqual(await app.evaluate(() => globalThis.cameraPanelRequests.at(-1)), { type: 'connection.cameraControl', sessionId: 'camera-owned', command: 'zoom-in' })
 await assert.rejects(panel.evaluate(() => window.cameraDesk.request({ kind: 'shell' })), /Unsupported/)
 const original = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('#camera-session=')).id)
 await app.evaluate((_electron, session) => globalThis.cameraPanelManager.sync([{ ...session, restarting: true }]), session)
 await expect(panel.getByText('Restarting stream…', { exact: true })).toBeAttached()
 await app.evaluate((_electron, session) => globalThis.cameraPanelManager.sync([session]), session)
 assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('#camera-session=')).id), original)
 await panel.evaluate(() => window.cameraDesk.hide())
 assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('#camera-session=')).isVisible()), false)
 await app.evaluate((_electron, session) => globalThis.cameraPanelManager.sync([session]), session)
 assert.equal(app.windows().length, 2)
 await app.evaluate(() => globalThis.cameraPanelManager.open('camera-owned'))
 await expect.poll(() => app.windows().length).toBe(2)
 await app.evaluate(() => globalThis.cameraPanelManager.sync([]))
 await expect.poll(() => app.windows().length).toBe(1)
 assert.equal(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Ctrl+Alt+F8')), false)
 // A new camera after the last one closes must resume docking (including a cancelled timer).
 await app.evaluate((_electron, session) => globalThis.cameraPanelManager.sync([{ ...session, id: 'camera-next' }]), session)
 await expect.poll(() => app.windows().length).toBe(2)
 const next = app.windows().find(page => page.url().includes('#camera-session=')) || app.windows()[1]
 await expect(next.getByRole('main', { name: 'Live camera controls' })).toBeAttached()
 await next.evaluate(() => window.cameraDesk.layout({ docked: true }))
 await expect.poll(() => app.evaluate(({ BrowserWindow, screen }) => {
   const bounds = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('#camera-session=')).getBounds()
   const camera = screen.screenToDipRect(null, globalThis.cameraWindowState)
   return Math.abs(bounds.x - camera.x - camera.width - 8) < 2
 })).toBe(true)
 await app.evaluate(() => globalThis.cameraPanelManager.sync([]))
 console.log('PASS: built camera panel, scoped IPC, docking/floating movement, shortcut ownership/conflicts/persistence, restart, hide/reopen and close. No phone operations.')
} finally { await app.close() }
