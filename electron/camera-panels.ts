import { app, BrowserWindow, ipcMain, screen } from 'electron'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { writeFile, rename } from 'node:fs/promises'
import type { BackendReply, BackendRequest } from './contracts.js'
import type { CameraPanelLayout, ScreenSession } from './screen-protocol.js'
import type { CameraWindowState } from './camera-window-control.js'
import { DesktopShortcuts } from './desktop-shortcuts.js'
import { cameraPanelBounds } from './camera-docking.js'

export class CameraPanels {
  private panels = new Map<string, BrowserWindow>()
  private seen = new Set<string>()
  private sessions: ScreenSession[] = []
  private closing = false
  private docked = new Map<string, boolean>()
  private collapsed = new Map<string, boolean>()
  private hidden = new Set<string>()
  private detachedBounds = new Map<string, Electron.Rectangle>()
  private shortcuts = new DesktopShortcuts()
  private shortcut = 'Ctrl+Alt+C'
  private shortcutAvailable = false
  private defaultDocked = true
  private lastId?: string
  private timer?: ReturnType<typeof setTimeout>
  private polling = false
  private saved = Promise.resolve()
  private moving = Promise.resolve()
  private preferencesFile = path.join(app.getPath('userData'), 'camera-panel.json')
  constructor(private directory: string, private packaged: boolean, private request: (request: BackendRequest) => Promise<BackendReply>, private windowState: (id: string) => Promise<CameraWindowState | null> = async () => null, private moveNativePanel?: (handle: string, title: string, x: number, y: number) => Promise<void>, private dockNativePanel?: (id: string, handle: string, title: string, enabled: boolean) => Promise<void>) {
    try {
      const text = readFileSync(this.preferencesFile, 'utf8')
      if (text.length < 8000) {
        const prefs = JSON.parse(text)
        if (typeof prefs.docked === 'boolean') this.defaultDocked = prefs.docked
        if (/^Ctrl\+(Alt|Shift)\+([A-Z0-9]|F([1-9]|1[0-2]))$/.test(prefs.shortcut)) this.shortcut = prefs.shortcut
      }
    } catch { /* Missing or invalid preferences use defaults. */ }
    const sessionId = (event: Electron.IpcMainInvokeEvent) => {
      const pair = [...this.panels].find(([, panel]) => !panel.isDestroyed() && event.sender === panel.webContents && event.senderFrame === panel.webContents.mainFrame)
      if (!pair) throw new Error('Untrusted camera panel')
      return pair[0]
    }
    ipcMain.handle('camera:state', event => this.sessions.find(s => s.id === sessionId(event)) || null)
    ipcMain.handle('camera:hide', event => { const id = sessionId(event); this.hidden.add(id); this.panels.get(id)?.hide() })
    ipcMain.handle('camera:layout', async (event, change: unknown) => {
      const id = sessionId(event)
      if (change !== undefined) {
        if (!change || typeof change !== 'object' || this.closing) throw new Error('Invalid camera panel settings.')
        const value = change as Record<string, unknown>
        if (value.docked !== undefined && typeof value.docked !== 'boolean' || value.collapsed !== undefined && typeof value.collapsed !== 'boolean' || value.shortcut !== undefined && typeof value.shortcut !== 'string') throw new Error('Invalid camera panel settings.')
        if (typeof value.shortcut === 'string') {
          if (!this.shortcuts.set('camera-controls', value.shortcut, () => { void this.toggle() })) throw new Error('This shortcut is already in use. Choose another combination.')
          this.shortcut = value.shortcut; this.shortcutAvailable = true
        }
        if (typeof value.docked === 'boolean') await this.setDocked(id, value.docked)
        if (typeof value.collapsed === 'boolean' && value.collapsed !== !!this.collapsed.get(id)) {
          this.collapsed.set(id, value.collapsed)
          const panel = this.panels.get(id)
          if (panel && !panel.isDestroyed()) {
            // Windows locks min/max to the current dimensions for nonresizable
            // windows. Unlock only around this explicit user-requested resize.
            panel.setResizable(true)
            panel.setSize(value.collapsed ? 64 : 336, Math.min(440, screen.getDisplayMatching(panel.getBounds()).workArea.height))
            panel.setResizable(false)
          }
        }
        await this.persist()
        this.layoutChanged()
      }
      return this.layout(id)
    })
    ipcMain.handle('camera:request', async (event, input: unknown) => {
      const id = sessionId(event)
      if (this.closing || !input || typeof input !== 'object') throw new Error('Camera panel is closing or the request is invalid.')
      const value = input as Record<string, unknown>
      let request: unknown
      if (value.kind === 'control') request = { type: 'connection.cameraControl', sessionId: id, command: value.command }
      else if (value.kind === 'zoom') request = { type: 'connection.cameraZoom', sessionId: id, value: value.value }
      else if (value.kind === 'update') request = { type: 'connection.cameraUpdate', sessionId: id, update: value.update, confirmedSplit: value.confirmedSplit }
      else if (value.kind === 'stop') request = { type: 'connection.screenStop', sessionId: id }
      else if (value.kind === 'always-on-top') request = { type: 'connection.screenOnTop', sessionId: id, enabled: value.enabled }
      else throw new Error('Unsupported camera panel request.')
      const reply = await this.request(request as BackendRequest)
      return reply.ok ? { ok: true } : { ok: false, error: reply.error }
    })
  }
  sync(sessions: ScreenSession[]) {
    this.sessions = sessions.filter(s => s.mode === 'camera')
    for (const [id, panel] of this.panels) {
      const session = this.sessions.find(s => s.id === id)
      if (!session) { panel.destroy(); this.panels.delete(id); this.docked.delete(id); this.collapsed.delete(id); this.hidden.delete(id); this.detachedBounds.delete(id) }
      else if (!panel.isDestroyed()) panel.webContents.send('camera:state', session)
    }
    for (const id of this.seen) if (!this.sessions.some(s => s.id === id)) this.seen.delete(id)
    for (const session of this.sessions) if (!this.seen.has(session.id)) { this.seen.add(session.id); this.open(session.id) }
    if (!this.sessions.length) { this.shortcuts.remove('camera-controls'); this.shortcutAvailable = false; clearTimeout(this.timer); this.timer = undefined }
    else {
      if (!this.shortcutAvailable) { this.shortcutAvailable = this.shortcuts.set('camera-controls', this.shortcut, () => { void this.toggle() }); this.layoutChanged() }
      this.schedule()
    }
  }
  private layout(id: string): CameraPanelLayout { return { docked: this.docked.get(id) ?? this.defaultDocked, collapsed: !!this.collapsed.get(id), shortcut: this.shortcut, shortcutAvailable: this.shortcutAvailable } }
  private layoutChanged() { for (const [id, panel] of this.panels) if (!panel.isDestroyed()) panel.webContents.send('camera:layout', this.layout(id)) }
  private persist() {
    const data = JSON.stringify({ docked: this.defaultDocked, shortcut: this.shortcut })
    const next = this.saved.catch(() => {}).then(async () => { await writeFile(`${this.preferencesFile}.tmp`, data); await rename(`${this.preferencesFile}.tmp`, this.preferencesFile) })
    this.saved = next; return next
  }
  private async setDocked(id: string, docked: boolean) {
    const panel = this.panels.get(id)
    const previous = this.docked.get(id)
    this.docked.set(id, docked); this.defaultDocked = docked; this.layoutChanged()
    if (panel && !panel.isDestroyed()) {
      if (docked && !previous) this.detachedBounds.set(id, panel.getBounds())
      if (!docked) { await this.nativeDock(id, panel, false); panel.setAlwaysOnTop(false); const bounds = this.detachedBounds.get(id); if (bounds) await this.movePanel(panel, bounds.x, bounds.y) }
    }
    this.schedule()
  }
  private schedule() {
    if (this.closing || !this.sessions.length || this.timer || this.polling || ![...this.panels.keys()].some(id => this.docked.get(id) && !this.hidden.has(id))) return
    this.timer = setTimeout(() => { this.timer = undefined; void this.follow() }, this.dockNativePanel ? 500 : 180)
  }
  private async follow() {
    this.polling = true
    try {
      for (const [id, panel] of this.panels) {
        if (!this.docked.get(id) || this.hidden.has(id) || panel.isDestroyed()) continue
        const state = await this.windowState(id).catch(() => null)
        if (this.closing || panel.isDestroyed() || !this.docked.get(id) || this.hidden.has(id) || !state) continue
        if (state.foreground) this.lastId = id
        if (state.minimized || !state.visible) { panel.hide(); continue }
        if (this.dockNativePanel) {
          await this.nativeDock(id, panel, true)
          if (!panel.isVisible() && process.env.ADB_VAULT_SMOKE_TEST !== '1') panel.showInactive()
          continue
        }
        const rect = process.platform === 'win32' ? screen.screenToDipRect(null, state) : state
        const bounds = cameraPanelBounds(rect, panel.getBounds(), screen.getDisplayMatching(rect).workArea)
        const previous = panel.getBounds()
        if (Math.abs(bounds.x - previous.x) > 1 || Math.abs(bounds.y - previous.y) > 1) await this.movePanel(panel, bounds.x, bounds.y)
        if (!panel.isVisible() && process.env.ADB_VAULT_SMOKE_TEST !== '1') panel.showInactive()
      }
    } catch { /* A closing or unavailable native window must never terminate ADB Vault. */ }
    finally { this.polling = false; this.schedule() }
  }
  private movePanel(panel: BrowserWindow, x: number, y: number) {
    // Calculate displacement after earlier moves finish, including rapid attach/detach.
    const next = this.moving.catch(() => {}).then(() => this.movePanelNow(panel, x, y))
    this.moving = next; return next
  }
  private async nativeDock(id: string, panel: BrowserWindow, enabled: boolean) {
    if (!this.dockNativePanel || panel.isDestroyed()) return
    const handle = panel.getNativeWindowHandle()
    await this.dockNativePanel(id, handle.length === 8 ? handle.readBigUInt64LE().toString(16) : handle.readUInt32LE().toString(16), panel.getTitle(), enabled)
  }
  private async movePanelNow(panel: BrowserWindow, x: number, y: number) {
    if (this.closing || panel.isDestroyed()) return
    if (process.platform !== 'win32') { panel.setPosition(x, y); return }
    // Electron's getBounds -> setBounds/setPosition round-trip grows frameless
    // windows at fractional Windows scaling. Native SWP_NOSIZE preserves pixels.
    if (!this.moveNativePanel) return
    const handle = panel.getNativeWindowHandle()
    const value = handle.length === 8 ? handle.readBigUInt64LE().toString(16) : handle.readUInt32LE().toString(16)
    const point = screen.dipToScreenPoint({ x, y })
    const current = panel.getBounds(), from = screen.dipToScreenPoint({ x: current.x, y: current.y })
    await this.moveNativePanel(value, panel.getTitle(), point.x - from.x, point.y - from.y)
  }
  private async toggle() {
    if (this.closing || !this.sessions.length) return
    let id = [...this.panels].find(([, panel]) => !panel.isDestroyed() && panel.isFocused())?.[0]
    if (!id) {
      for (const session of this.sessions) { if ((await this.windowState(session.id).catch(() => null))?.foreground) { id = session.id; break } }
    }
    if (this.closing || !this.sessions.length) return
    id ||= this.lastId && this.sessions.some(s => s.id === this.lastId) ? this.lastId : this.sessions.at(-1)!.id
    const panel = this.panels.get(id)
    if (panel && !panel.isDestroyed() && panel.isVisible()) { this.hidden.add(id); panel.hide() }
    else this.open(id)
  }
  open(id: string) {
    if (this.closing || !this.sessions.some(s => s.id === id)) return
    this.lastId = id; this.hidden.delete(id)
    const existing = this.panels.get(id)
    if (existing && !existing.isDestroyed()) { if (process.env.ADB_VAULT_SMOKE_TEST !== '1') existing.showInactive(); this.schedule(); return }
    const work = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    const width = Math.min(336, work.width), height = Math.min(440, work.height)
    const panel = new BrowserWindow({ width, height, x: work.x + Math.max(0, work.width - width - 16), y: work.y + Math.max(0, Math.floor((work.height - height) / 2)), resizable: false, maximizable: false, title: `Camera controls · ADB Vault · ${id}`, frame: false, alwaysOnTop: false, skipTaskbar: true, show: false, backgroundColor: '#101519', webPreferences: { preload: path.join(this.directory, 'camera-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } })
    this.panels.set(id, panel)
    this.docked.set(id, this.defaultDocked)
    this.detachedBounds.set(id, panel.getBounds())
    panel.setMenu(null)
    panel.on('page-title-updated', event => event.preventDefault())
    panel.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    panel.webContents.on('will-navigate', event => event.preventDefault())
    panel.once('ready-to-show', () => { if (!this.closing && !panel.isDestroyed() && process.env.ADB_VAULT_SMOKE_TEST !== '1') panel.showInactive() })
    panel.once('closed', () => { if (this.panels.get(id) === panel) this.panels.delete(id) })
    panel.on('focus', () => { this.lastId = id })
    panel.on('will-move', () => { if (this.docked.get(id)) { this.docked.set(id, false); this.defaultDocked = false; this.layoutChanged(); void this.nativeDock(id, panel, false).then(() => { if (!panel.isDestroyed()) panel.setAlwaysOnTop(false) }).catch(() => {}); void this.persist().catch(() => {}) } })
    const hash = `camera-session=${encodeURIComponent(id)}`
    if (!this.packaged && process.env.VITE_DEV_SERVER_URL) void panel.loadURL(`${process.env.VITE_DEV_SERVER_URL}#${hash}`)
    else void panel.loadFile(path.join(this.directory, '../dist/index.html'), { hash })
  }
  shutdown() { this.closing = true; clearTimeout(this.timer); this.shortcuts.shutdown(); for (const panel of this.panels.values()) panel.destroy(); this.panels.clear() }
}
