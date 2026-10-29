import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { ScreenPins } from '../../dist-electron/screen-pins.js'
import { WindowsCameraControls } from '../../dist-electron/camera-window-control.js'
app.setPath('userData', process.argv.find(a => a.startsWith('--user-data-dir=')).slice('--user-data-dir='.length))
app.whenReady().then(async () => {
  const root = new BrowserWindow({ show: false }); await root.loadURL('about:blank')
  const native = new WindowsCameraControls()
  globalThis.pinNative = native
  globalThis.initializePins = pid => {
    const modes = ['display', 'virtual', 'camera']
    const sessions = globalThis.pinSessions = modes.map(mode => ({ id: mode, mode, deviceId: 'test', deviceName: 'Test', startedAt: new Date().toISOString(), canSetAlwaysOnTop: true, alwaysOnTop: false }))
    globalThis.pinTitles = Object.fromEntries(modes.map(mode => [mode, `ADB Vault — Caption pin ${mode}`]))
    const screens = {
      screenWindow: id => sessions.find(s => s.id === id)?.restarting ? Promise.resolve(null) : native.inspect(pid, globalThis.pinTitles[id]),
      dockScreenPin: async (id, handle, title) => { try { await native.dockPanel(handle, title, pid, globalThis.pinTitles[id], true) } catch (error) { globalThis.pinDockError = String(error); throw error } },
    }
    globalThis.pinRequests = []
    globalThis.addTestTouch = async () => {
      const overlay = new BrowserWindow({ show: false, frame: false, focusable: false, skipTaskbar: true })
      await overlay.loadURL('about:blank'); overlay.setTitle('Touch controls · ADB Vault · pin-test')
      const handle = overlay.getNativeWindowHandle().readBigUInt64LE().toString(16)
      await native.dockPanel(handle, overlay.getTitle(), pid, globalThis.pinTitles.virtual, true)
      overlay.showInactive()
      return handle
    }
    globalThis.screenPins = new ScreenPins(path.resolve('dist-electron'), screens, async request => {
      globalThis.pinRequests.push(request)
      if (globalThis.pinFailure) return { ok: false, error: globalThis.pinFailure }
      await native.setAlwaysOnTop(pid, globalThis.pinTitles[request.sessionId], request.enabled)
      sessions.find(s => s.id === request.sessionId).alwaysOnTop = request.enabled
      globalThis.screenPins.sync(sessions)
      return { ok: true }
    })
    globalThis.screenPins.sync(sessions)
  }
  app.on('before-quit', () => { globalThis.screenPins?.shutdown(); native.shutdown() })
  globalThis.pinsReady = true
})
