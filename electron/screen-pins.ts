import { BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import type { BackendReply, BackendRequest } from './contracts.js'
import type { ScreenSession } from './screen-protocol.js'
import type { DeviceScreenService } from './device-screen.js'

type Pin = { window: BrowserWindow; session: ScreenSession; pending: boolean; error: string; timer?: ReturnType<typeof setTimeout> }
export class ScreenPins {
  private pins = new Map<string, Pin>()
  private closing = false
  constructor(private directory: string, private screens: DeviceScreenService, private request: (request: BackendRequest) => Promise<BackendReply>) {
    const sender = (event: Electron.IpcMainInvokeEvent) => {
      const pin = [...this.pins.values()].find(p => !p.window.isDestroyed() && event.sender === p.window.webContents && event.senderFrame === p.window.webContents.mainFrame)
      if (!pin || this.closing) throw new Error('Untrusted window pin.')
      return pin
    }
    ipcMain.handle('screen-pin:state', event => this.state(sender(event)))
    ipcMain.handle('screen-pin:toggle', async event => {
      const pin = sender(event)
      if (this.state(pin).busy) return this.state(pin)
      pin.pending = true; pin.error = ''; this.publish(pin)
      try {
        const reply = await this.request({ type: 'connection.screenOnTop', sessionId: pin.session.id, enabled: !pin.session.alwaysOnTop })
        if (!reply.ok) pin.error = reply.error
      } catch (error) { pin.error = error instanceof Error ? error.message : String(error) }
      finally { pin.pending = false; this.publish(pin) }
      return this.state(pin)
    })
  }
  private state(pin: Pin) {
    const s = pin.session
    return { enabled: !!s.alwaysOnTop, busy: pin.pending || !!(s.stopping || s.restarting || s.controlling), error: pin.error }
  }
  private publish(pin: Pin) { if (!pin.window.isDestroyed()) pin.window.webContents.send('screen-pin:state', this.state(pin)) }
  sync(sessions: ScreenSession[]) {
    if (this.closing) return
    const live = sessions.filter(s => s.canSetAlwaysOnTop && !s.stopping)
    for (const [id, pin] of this.pins) if (!live.some(s => s.id === id)) { pin.window.destroy(); this.pins.delete(id) }
    for (const session of live) {
      const pin = this.pins.get(session.id)
      if (pin) {
        pin.session = session; this.publish(pin)
        if (session.restarting) pin.window.hide()
      } else this.open(session)
    }
  }
  private open(session: ScreenSession) {
    // Nonactivating owned popup: clicks must not blur the game or its input
    // overlay. Placement and z-order follow the SDL window natively.
    const window = new BrowserWindow({ width: 30, height: 26, minWidth: 1, minHeight: 1, title: `Screen pin · ADB Vault · ${session.id}`, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, focusable: false, resizable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, show: false, webPreferences: { preload: path.join(this.directory, 'screen-pin-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } })
    window.setMenu(null)
    window.on('page-title-updated', event => event.preventDefault())
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    const pin: Pin = { window, session, pending: false, error: '' }
    this.pins.set(session.id, pin)
    window.on('closed', () => { clearTimeout(pin.timer); if (this.pins.get(session.id) === pin) this.pins.delete(session.id) })
    const follow = async () => {
      if (this.closing || window.isDestroyed()) return
      try {
        const state = await this.screens.screenWindow(session.id)
        if (this.closing || window.isDestroyed()) return
        if (pin.session.restarting || !state || state.minimized || !state.visible) window.hide()
        else {
          const handle = window.getNativeWindowHandle()
          await this.screens.dockScreenPin(session.id, handle.length === 8 ? handle.readBigUInt64LE().toString(16) : handle.readUInt32LE().toString(16), window.getTitle())
          if (!this.closing && !window.isDestroyed() && !pin.session.restarting && !pin.session.stopping && !window.isVisible()) window.showInactive()
        }
      } catch { if (!window.isDestroyed()) window.hide() } // Startup/restart: retry after the owned window appears.
      if (!this.closing && !window.isDestroyed()) pin.timer = setTimeout(() => void follow(), 500)
    }
    window.once('ready-to-show', () => void follow())
    void window.loadFile(path.join(this.directory, 'screen-pin.html'), { hash: `session=${encodeURIComponent(session.id)}` })
  }
  shutdown() { this.closing = true; for (const pin of this.pins.values()) pin.window.destroy(); this.pins.clear() }
}
