import { app, BrowserWindow, clipboard, ipcMain } from 'electron'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import type { DeviceScreenService } from './device-screen.js'
import { supportsTouchControls, type ScreenSession } from './screen-protocol.js'
import { TouchStream } from './touch-stream.js'
import { touchTemplate, validateProfile, type TouchState, type TouchProfile } from './touch-protocol.js'
import { validateTouchInput } from './touch-input.js'

type Panel = { id: string; window: BrowserWindow; stream: TouchStream; state: TouchState; key: string; timer?: ReturnType<typeof setTimeout> }
const pinState = (session?: ScreenSession) => ({ alwaysOnTop: !!session?.alwaysOnTop, canSetAlwaysOnTop: !!session?.canSetAlwaysOnTop, windowBusy: !!(session?.controlling || session?.restarting || session?.stopping) })
export class TouchPanels {
  private panels = new Map<string, Panel>()
  private started = new Set<string>()
  private closing = false
  private saved: Promise<unknown> = Promise.resolve()
  constructor(private directory: string, private packaged: boolean, private helperDirectory: string, private screens: DeviceScreenService) {
    const sender = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => {
      const panel = [...this.panels.values()].find(p => !p.window.isDestroyed() && event.sender === p.window.webContents && event.senderFrame === p.window.webContents.mainFrame)
      if (!panel || this.closing) throw new Error('Untrusted touch panel.')
      return panel
    }
    ipcMain.handle('touch:state', event => sender(event).state)
    ipcMain.handle('touch:input', async (event, epoch: unknown, input: unknown) => {
      const panel = sender(event)
      if (!panel.window.isFocused() || !panel.window.isVisible() || panel.state.error) throw new Error('Select the app window before typing.')
      if (!this.screens.touchTarget(panel.id).textInput) throw new Error('Restart this virtual display to enable typing with the PC layout.')
      if (!Number.isInteger(epoch)) throw new Error('Invalid input epoch.')
      validateTouchInput(input)
      if (input.type === 'paste') { const text = clipboard.readText(); if (!text) return; input = { type: 'text', text }; validateTouchInput(input) }
      const text = await panel.stream.input(epoch as number, input)
      if (input.type === 'key' && (input.key === 'Copy' || input.key === 'Cut') && text !== undefined) clipboard.writeText(text)
    })
    ipcMain.handle('touch:always-on-top', (event, enabled: unknown) => {
      const panel = sender(event)
      if (typeof enabled !== 'boolean') throw new Error('Invalid window pin setting.')
      return this.screens.setAlwaysOnTop(panel.id, enabled)
    })
    ipcMain.handle('touch:close', event => sender(event).window.close())
    ipcMain.handle('touch:profiles', (event, orientation: unknown, profiles: unknown) => {
      const panel = sender(event)
      if (orientation !== 'landscape' && orientation !== 'portrait') throw new Error('Invalid profile orientation.')
      const file = path.join(app.getPath('userData'), 'touch-profiles', `${panel.key}-${orientation}.json`)
      const task = this.saved.catch(() => {}).then(async () => {
        if (profiles !== undefined) {
          if (!Array.isArray(profiles) || !profiles.length || profiles.length > 20) throw new Error('Use between 1 and 20 profiles.')
          profiles.forEach(validateProfile)
          if (new Set(profiles.map(p => p.name)).size !== profiles.length) throw new Error('Each profile needs a different name.')
          await mkdir(path.dirname(file), { recursive: true }); await writeFile(`${file}.tmp`, JSON.stringify(profiles)); await rename(`${file}.tmp`, file)
          return profiles as TouchProfile[]
        }
        try {
          if ((await stat(file)).size > 100000) throw new Error('Profile file is too large.')
          const data: unknown = JSON.parse(await readFile(file, 'utf8'))
          if (!Array.isArray(data) || !data.length || data.length > 20) throw new Error('Invalid saved profiles.')
          data.forEach(validateProfile); return data as TouchProfile[]
        } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [touchTemplate('empty')]; throw error }
      })
      this.saved = task; return task
    })
    ipcMain.on('touch:frame', (event, epoch: unknown, points: unknown) => {
      let panel: Panel | undefined
      try {
        panel = sender(event)
        if (!panel.window.isFocused() || !panel.window.isVisible() || panel.state.error) { panel.stream.release(); return }
        if (!Number.isInteger(epoch)) throw new Error('Invalid input epoch.')
        panel.stream.frame(epoch as number, points as Parameters<TouchStream['frame']>[1])
      } catch (error) { if (panel) { panel.stream.release(); panel.state.error = String(error); panel.window.webContents.send('touch:state', panel.state) } }
    })
  }
  sync(sessions: ScreenSession[]) {
    for (const [id, panel] of this.panels) {
      const session = sessions.find(s => s.id === id && s.mode === 'virtual' && !s.stopping)
      if (!session) panel.window.destroy()
      else if (!panel.window.isDestroyed()) { panel.state = { ...panel.state, ...pinState(session) }; panel.window.webContents.send('touch:state', panel.state) }
    }
    for (const id of this.started) if (!sessions.some(s => s.id === id)) this.started.delete(id)
    if (this.closing) return
    for (const session of sessions) {
      if (session.mode !== 'virtual' || !session.touchControls || !session.virtualDisplayId || session.stopping || !supportsTouchControls(session.input) || this.started.has(session.id)) continue
      this.started.add(session.id)
      try { this.open(session.id, true) } catch (error) { console.error('Could not open touch controls:', error) }
    }
  }
  open(id: string, autoStart = true) {
    if (this.closing) throw new Error('ADB Vault is closing.')
    const target = this.screens.touchTarget(id)
    const existing = this.panels.get(id)
    if (existing && !existing.window.isDestroyed()) { existing.window.show(); existing.window.focus(); return }
    const window = new BrowserWindow({ width: 960, height: 600, title: `Touch controls · ADB Vault · ${id}`, transparent: true, backgroundColor: '#00000000', frame: false, hasShadow: false, resizable: true, maximizable: false, skipTaskbar: true, show: false, webPreferences: { partition: `touch-controls-${id}`, preload: path.join(this.directory, 'touch-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } })
    window.setMenu(null)
    window.on('page-title-updated', event => event.preventDefault())
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    // Pointer lock is granted only to this owned overlay, after a user gesture.
    const allowed = (sender: Electron.WebContents | null, permission: string, details: { isMainFrame: boolean; requestingUrl?: string }) => !window.isDestroyed() && sender === window.webContents && permission === 'pointerLock' && details.isMainFrame && details.requestingUrl === window.webContents.getURL()
    window.webContents.session.setPermissionCheckHandler((sender, permission, _origin, details) => allowed(sender, permission, details))
    window.webContents.session.setPermissionRequestHandler((sender, permission, callback, details) => callback(allowed(sender, permission, details)))
    const panel: Panel = { id, window, key: createHash('sha256').update(`${target.device.hardwareId || target.device.serial}:${target.userId}:${target.packageName}`).digest('hex'), state: { title: target.packageName, autoStart, ...pinState(this.screens.state.find(s => s.id === id)) }, stream: new TouchStream(this.helperDirectory, () => this.screens.touchTarget(id), (geometry, error) => {
      if (window.isDestroyed()) return
      panel.state = { ...panel.state, ...(geometry ? { geometry } : {}), ...(error ? { error } : {}) }
      window.webContents.send('touch:state', panel.state)
    }) }
    this.panels.set(id, panel)
    const pause = () => { panel.stream.release(); if (!window.isDestroyed()) window.webContents.send('touch:focus', false) }
    window.on('blur', pause); window.on('hide', pause); window.webContents.on('render-process-gone', () => { panel.stream.close(); window.destroy() })
    window.on('focus', () => window.webContents.send('touch:focus', true))
    window.on('closed', () => { clearTimeout(panel.timer); panel.stream.close(); if (this.panels.get(id) === panel) this.panels.delete(id) })
    const follow = async () => {
      if (this.closing || window.isDestroyed()) return
      try {
        const state = await this.screens.touchWindow(id)
        if (window.isDestroyed()) return
        if (!state || state.minimized || !state.visible) { if (window.isVisible()) window.hide() }
        else {
          const handle = window.getNativeWindowHandle()
          await this.screens.dockTouchPanel(id, handle.length === 8 ? handle.readBigUInt64LE().toString(16) : handle.readUInt32LE().toString(16), window.getTitle(), true)
          if (!window.isDestroyed() && !window.isVisible() && process.env.ADB_VAULT_SMOKE_TEST !== '1') window.showInactive()
        }
      } catch (error) { if (!window.isDestroyed()) { pause(); panel.state.error = String(error); window.webContents.send('touch:state', panel.state) } }
      if (!this.closing && !window.isDestroyed()) panel.timer = setTimeout(() => void follow(), 300)
    }
    window.once('ready-to-show', () => { void follow(); void panel.stream.start() })
    const hash = `touch-session=${encodeURIComponent(id)}`
    if (!this.packaged && process.env.VITE_DEV_SERVER_URL) void window.loadURL(`${process.env.VITE_DEV_SERVER_URL}#${hash}`)
    else void window.loadFile(path.join(this.directory, '../dist/index.html'), { hash })
  }
  shutdown() { this.closing = true; for (const p of this.panels.values()) { p.stream.close(); p.window.destroy() } this.panels.clear() }
}
