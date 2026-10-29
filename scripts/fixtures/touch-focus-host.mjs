// Real production overlay / IPC / docking, with only the Android transport mocked.
import { app, BrowserWindow } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { TouchPanels } from '../../dist-electron/touch-panels.js'
import { TouchStream } from '../../dist-electron/touch-stream.js'
import { WindowsCameraControls } from '../../dist-electron/camera-window-control.js'
import { touchTemplate, validatePoints } from '../../dist-electron/touch-protocol.js'
app.setPath('userData', process.argv.find(a => a.startsWith('--user-data-dir=')).slice('--user-data-dir='.length))
app.whenReady().then(async () => {
  const root = new BrowserWindow({ show: false, width: 400, height: 300, x: 20, y: 20, title: 'Touch focus test — other window' })
  await root.loadURL('data:text/html,<h1>Other test window</h1>')
  globalThis.otherWindow = root
  const native = new WindowsCameraControls(); globalThis.touchFrames = []
  TouchStream.prototype.start = async function () { this.geometry = { width: 800, height: 600, epoch: 1, displayId: 5, uniqueId: 'virtual:test', rotation: 0, message: '' }; this.notify(this.geometry) }
  TouchStream.prototype.frame = function (epoch, points) { validatePoints(points); if (epoch === 1) globalThis.touchFrames.push(points) }
  TouchStream.prototype.release = function () { globalThis.touchFrames.push([]) }
  TouchStream.prototype.input = async function () { return undefined }
  TouchStream.prototype.close = function () { this.release() }
  globalThis.initializeTouch = async pid => {
    const title = 'ADB Vault — Touch focus test'
    const screens = {
      get state() { return [globalThis.touchSession] },
      touchTarget: () => ({ adb: 'test', device: { serial: 'focus-test', hardwareId: 'focus-test' }, userId: 0, packageName: 'dev.test.game', pid, title, displayId: 5, textInput: true }),
      touchWindow: () => native.inspect(pid, title),
      dockTouchPanel: (_id, handle, panelTitle, enabled) => native.dockPanel(handle, panelTitle, pid, title, enabled),
    }
    const key = createHash('sha256').update('focus-test:0:dev.test.game').digest('hex')
    await mkdir(path.join(app.getPath('userData'), 'touch-profiles'), { recursive: true })
    await writeFile(path.join(app.getPath('userData'), 'touch-profiles', `${key}-landscape.json`), JSON.stringify([{ ...touchTemplate('racing'), autoStart: true }]))
    globalThis.touchPanels = new TouchPanels(path.resolve('dist-electron'), true, '', screens)
    globalThis.touchSession = { id: 'focus-test', deviceId: 'test', deviceName: 'Test', startedAt: new Date().toISOString(), mode: 'virtual', touchControls: true, input: { control: true, keyboard: 'sdk', mouse: 'sdk', gamepad: false } }
  }
  app.on('before-quit', () => { globalThis.touchPanels?.shutdown(); native.shutdown() })
  globalThis.touchReady = true
})
