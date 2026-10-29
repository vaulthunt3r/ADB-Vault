import { app, BrowserWindow } from 'electron'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { DeviceScreenService } from '../../dist-electron/device-screen.js'
import { TouchPanels } from '../../dist-electron/touch-panels.js'
import { parseDevices } from '../../dist-electron/connections.js'
import { checked, run } from '../../dist-electron/process.js'
import { screenLaunch } from '../../dist-electron/screen-protocol.js'
import { installViewerPermissions } from '../../dist-electron/viewer-permissions.js'
app.setPath('userData', process.argv.find(arg => arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length))
app.whenReady().then(async () => {
  const root = new BrowserWindow({ show: false }); await root.loadURL('about:blank')
  installViewerPermissions(root.webContents)
  const saved = JSON.parse(await readFile(path.join(process.env.APPDATA, 'adb-vault/backend.json'), 'utf8'))
  const adb = path.join(saved.paths.adb, 'adb.exe'), scrcpy = path.join(saved.paths.scrcpy, 'scrcpy.exe')
  const devices = parseDevices(checked(await run(adb, ['devices', '-l']))).filter(d => d.status === 'connected')
  if (devices.length !== 1) throw new Error('Connect exactly one phone for the overlay test.')
  const device = devices[0], userId = Number(checked(await run(adb, ['-t', device.transportId, 'shell', 'am', 'get-current-user'])).trim())
  const screens = new DeviceScreenService(() => adb, () => scrcpy, () => ({ devices, busy: false }), event => { if (event.type === 'screenSessions') globalThis.touchPanels?.sync(event.sessions) }, async () => null)
  globalThis.touchScreens = screens
  globalThis.touchPanels = new TouchPanels(path.resolve('dist-electron'), true, path.resolve('android-helper/dist'), screens)
  await screens.execute(device, 'open', { ...screenLaunch(), mode: 'virtual', virtualSize: '1280x720', audio: 'off', clipboard: false, application: { packageName: 'com.android.settings', userId } })
  for (let i = 0; i < 100 && !screens.state[0]?.virtualDisplayId; i++) await new Promise(r => setTimeout(r, 100))
  globalThis.touchPanels.open(screens.state[0].id)
  globalThis.touchReady = true
}).catch(error => { globalThis.touchFailure = String(error) })
