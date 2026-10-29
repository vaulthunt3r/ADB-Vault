import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { CameraPanels } from '../../dist-electron/camera-panels.js'
import { WindowsCameraControls } from '../../dist-electron/camera-window-control.js'
app.setPath('userData', process.argv.find(arg => arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length))
app.whenReady().then(async () => {
const root = new BrowserWindow({ show: false })
await root.loadURL('about:blank')
globalThis.cameraPanelRequests = []
globalThis.cameraWindowState = null
const nativeControls = new WindowsCameraControls()
globalThis.cameraNativeControls = nativeControls
globalThis.cameraPanelManager = new CameraPanels(path.resolve('dist-electron'), true, async request => { globalThis.cameraPanelRequests.push(request); return { ok: true } }, async () => globalThis.cameraWindowState, (handle, title, x, y) => nativeControls.movePanel(handle, title, x, y))
app.on('before-quit', () => { globalThis.cameraPanelManager.shutdown(); nativeControls.shutdown() })
})
