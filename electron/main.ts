import { app, BrowserWindow, clipboard, dialog, ipcMain, protocol, Notification, shell } from 'electron'
import { Backend } from './backend.js'
import { CameraPanels } from './camera-panels.js'
import { TouchPanels } from './touch-panels.js'
import { ScreenPins } from './screen-pins.js'
import { Storage } from './storage.js'
import { installViewerPermissions } from './viewer-permissions.js'
import { CloseCoordinator } from './close-coordinator.js'
import { OperationNotifications } from './operation-notifications.js'
import { DesktopNotifications } from './desktop-notifications.js'
import { notificationSettings } from './notifications-protocol.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { appendFile } from 'node:fs/promises'
import { configurePortableProfile, portableProfilePath } from './portable-profile.js'

app.commandLine.appendSwitch('lang', 'en-US')
const portableData = portableProfilePath(process.execPath, app.isPackaged, app.commandLine.hasSwitch('user-data-dir'))
if (portableData) {
  try { configurePortableProfile(app, portableData) }
  catch (error) {
    dialog.showErrorBox('Portable folder is not writable', `ADB Vault could not create its portable profile in:\n${portableData}\n\nExtract the entire portable archive to a writable folder, then try again.\n\n${String(error)}`)
    app.exit(1)
  }
}

protocol.registerSchemesAsPrivileged([{ scheme: 'vault-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }])
const appModelId = app.isPackaged ? 'dev.adbvault.desktop' : 'dev.adbvault.desktop.dev'
if (process.platform === 'win32') app.setAppUserModelId(appModelId)

const directory = path.dirname(fileURLToPath(import.meta.url))
// Windows Explorer reads the taskbar/pinning icon itself, outside Electron's
// ASAR filesystem. Keep the ICO as a real file in the packaged resources.
const appIconPath = process.platform === 'win32'
  ? app.isPackaged ? path.join(process.resourcesPath, 'app-icon.ico') : path.join(directory, '../build/icon.ico')
  : path.join(directory, '../dist/app-icon.png')
let window: BrowserWindow | null = null
let backend: Backend | null = null
let cameraPanels: CameraPanels | undefined
let touchPanels: TouchPanels | undefined
let screenPins: ScreenPins | undefined
let closeCoordinator: CloseCoordinator | undefined
let locatingComponent = 0
let mediaPlaying = false
const downloads = new Set<Electron.DownloadItem>()

async function reportCloseError(error: unknown) {
  console.error('Shutdown failed:', error)
  await appendFile(path.join(app.getPath('userData'), 'shutdown-errors.log'), `${new Date().toISOString()} ${String(error)}\n`).catch(() => {})
}

function createWindow() {
  window = new BrowserWindow({
    width: 1440, height: 940, minWidth: 1000, minHeight: 680,
    show: false,
    title: 'ADB Vault', backgroundColor: '#f7f8f7', frame: false,
    icon: appIconPath,
    webPreferences: { preload: path.join(directory, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  if (process.platform === 'win32') {
    window.setAppDetails({
      appId: appModelId,
      appIconPath,
      appIconIndex: 0,
      relaunchCommand: `"${process.execPath}"${app.isPackaged ? '' : ` "${app.getAppPath()}"`}`,
      relaunchDisplayName: 'ADB Vault',
    })
  }
  if (process.env.ADB_VAULT_SMOKE_TEST !== '1') window.show()
  window.setMenu(null)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.on('did-start-loading', () => backend?.confirmations.cancel())
  window.webContents.on('render-process-gone', () => backend?.confirmations.cancel())
  installViewerPermissions(window.webContents)
  window.webContents.on('media-started-playing', () => { mediaPlaying = true })
  window.webContents.on('media-paused', () => { mediaPlaying = false })
  if (!app.isPackaged && process.env.VITE_DEV_SERVER_URL) void window.loadURL(process.env.VITE_DEV_SERVER_URL)
  else void window.loadFile(path.join(directory, '../dist/index.html'))
  window.on('close', event => {
    if (!closeCoordinator || closeCoordinator.ready) return
    event.preventDefault()
    void closeCoordinator.request()
  })
  window.on('closed' , () => { backend?.confirmations.cancel(); window = null; mediaPlaying = false })
}

app.whenReady().then(async () => {
  const storage = new Storage(app.getPath('userData'))
  await storage.load()
  const preferences = () => notificationSettings(storage.data.notifications)
  const nativeNotifications = new DesktopNotifications(preferences, (destination, taskPanel) => {
    if (!window || window.isDestroyed() || backend?.closing) return
    if (window.isMinimized()) window.restore()
    window.show(); window.focus()
    window.webContents.send('backend:event', { type: 'notificationOpen', destination, taskPanel })
  }, { isSupported: () => Notification.isSupported(), create: options => new Notification(options), beep: () => shell.beep() })
  let notificationErrorReported = false
  const operationNotifications = new OperationNotifications(preferences, () => !!window?.isFocused(), (alert, channels) => {
    void nativeNotifications.show(alert, channels).catch(error => {
      if (!notificationErrorReported && window && !window.isDestroyed()) {
        notificationErrorReported = true
        window.webContents.send('backend:event', { type: 'notice', text: String(error) + ' See Settings → Notifications.' })
      }
    })
  })
  backend = new Backend(storage, event => {
    operationNotifications.capture(event)
    if (event.type === 'screenSessions') { cameraPanels?.sync(event.sessions); touchPanels?.sync(event.sessions); screenPins?.sync(event.sessions) }
    if (window && !window.isDestroyed()) window.webContents.send('backend:event', event)
  }, app.isPackaged ? path.join(process.resourcesPath, 'android-helper') : path.join(directory, '../android-helper/dist'), () => nativeNotifications.test())
  cameraPanels = new CameraPanels(directory, app.isPackaged, request => backend!.request(request), id => backend!.screens.cameraWindow(id), (handle, title, x, y) => backend!.screens.moveCameraPanel(handle, title, x, y), (id, handle, title, enabled) => backend!.screens.dockCameraPanel(id, handle, title, enabled))
  touchPanels = new TouchPanels(directory, app.isPackaged, app.isPackaged ? path.join(process.resourcesPath, 'android-helper') : path.join(directory, '../android-helper/dist'), backend.screens)
  screenPins = new ScreenPins(directory, backend.screens, request => backend!.request(request))
  closeCoordinator = new CloseCoordinator(() => [
    ...backend!.closeOperations(),
    ...(locatingComponent ? ['Components · Choosing a component folder'] : []),
    ...(downloads.size ? ['Activity · Saving exported history'] : []),
    ...(mediaPlaying ? ['Files · Audio or video playback'] : []),
  ], async operations => {
    const options: Electron.MessageBoxOptions = {
      type: 'warning', title: 'Operations are active', message: 'Close ADB Vault with active operations?',
      detail: operations.map(operation => `• ${operation}`).join('\n') + '\n\nActive operations will be stopped where possible. Completed changes are kept; interrupted operations may be partial. Installers and operations that cannot be cancelled may need to finish before closing. A command already sent to the phone may still complete.\n\nMinimize the window to keep tasks running.',
      buttons: ['Keep working', 'Close safely'], defaultId: 0, cancelId: 0, noLink: true,
    }
    const result = window && !window.isDestroyed() ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options)
    return result.response === 1
  }, async () => {
    operationNotifications.stop(); nativeNotifications.stop()
    cameraPanels?.shutdown()
    touchPanels?.shutdown()
    screenPins?.shutdown()
    const stopped = backend!.shutdown() // Reject new work synchronously, before cancelling downloads.
    for (const download of downloads) download.cancel()
    await stopped
  }, () => app.quit(), reportCloseError)
  const trusted = (event: Electron.IpcMainInvokeEvent) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted sender')
  }
  ipcMain.handle('clipboard:writeText', (event, text: unknown) => {
    trusted(event)
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 1_000_000) throw new Error('Invalid clipboard text.')
    return clipboard.writeText(text)
  })
  ipcMain.handle('clipboard:readText', async event => {
    trusted(event)
    const text = await clipboard.readText()
    if (Buffer.byteLength(text, 'utf8') > 262144 || text.includes('\0')) throw new Error('Clipboard text must be at most 256 KiB and contain no null characters.')
    return text
  })
  ipcMain.handle('window:control', (event, command: unknown) => {
    trusted(event)
    if (command === 'minimize') window?.minimize()
    if (command === 'maximize') { if (window?.isMaximized()) window.unmaximize(); else window?.maximize() }
    if (command === 'close') window?.close()
  })
  ipcMain.handle('component:locate', async (event, kind: unknown = 'folder') => {
    trusted(event)
    if (kind !== 'folder' && kind !== 'adb-file') throw new Error('Unknown component picker.')
    if (backend!.closing) return null
    locatingComponent++
    try {
      const result = await dialog.showOpenDialog(window!, kind === 'adb-file'
        ? { title: 'Choose adb.exe', properties: ['openFile'], filters: [{ name: 'Windows executable', extensions: ['exe'] }] }
        : { title: 'Locate component folder', properties: ['openDirectory'] })
      return result.canceled || backend!.closing ? null : result.filePaths[0]
    } finally { locatingComponent-- }
  })
  ipcMain.handle('backend:request', async (event, request: unknown) => {
    trusted(event)
    const reply = await backend!.request(request)
    if (reply.ok && request && typeof request === 'object' && 'type' in request && request.type === 'connection.touchControls' && 'sessionId' in request && typeof request.sessionId === 'string') {
      try { touchPanels?.open(request.sessionId) } catch (error) { return { ...reply, ok: false, error: String(error) } }
    }
    if (reply.ok && request && typeof request === 'object' && 'type' in request && request.type === 'connection.cameraPanel' && 'sessionId' in request && typeof request.sessionId === 'string') cameraPanels?.open(request.sessionId)
    return reply
  })
  protocol.handle('vault-media', request => backend!.previews.respond(request))
  await backend.history.initialize()
  createWindow()
  window!.webContents.session.on('will-download', (event, item, contents) => {
    if (contents !== window?.webContents) return
    if (backend!.closing) { event.preventDefault(); return }
    downloads.add(item)
    item.once('done', () => downloads.delete(item))
  })
  void backend.initialize().catch(error => { if (window && !window.isDestroyed()) window.webContents.send('backend:event', { type: 'activity', tone: 'warning', text: String(error) }) })
  app.on('activate', () => { if (!backend?.closing && BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', event => {
  if (!closeCoordinator || closeCoordinator.ready) return
  event.preventDefault()
  void closeCoordinator.request()
})
