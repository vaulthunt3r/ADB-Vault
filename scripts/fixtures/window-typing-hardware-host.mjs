// Explicit hardware test: opens only Translator, using the existing ADB/scrcpy
// components and an isolated desktop profile. No APK installation or IME change.
import { app, BrowserWindow } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { DeviceScreenService } from '../../dist-electron/device-screen.js'
import { TouchPanels } from '../../dist-electron/touch-panels.js'
import { parseDevices } from '../../dist-electron/connections.js'
import { screenLaunch } from '../../dist-electron/screen-protocol.js'
import { checked, run } from '../../dist-electron/process.js'
app.setPath('userData', process.argv.find(a => a.startsWith('--user-data-dir=')).slice('--user-data-dir='.length))
app.whenReady().then(async () => {
  const saved = JSON.parse(await readFile(path.join(process.env.APPDATA, 'adb-vault/backend.json'), 'utf8'))
  const adb = path.join(saved.paths.adb, 'adb.exe'), scrcpy = path.join(saved.paths.scrcpy, 'scrcpy.exe')
  const devices = parseDevices(checked(await run(adb, ['devices', '-l']))).filter(d => d.status === 'connected')
  if (devices.length !== 1) throw new Error('Connect exactly the phone being tested.')
  const device = devices[0], selector = device.transportId ? ['-t', device.transportId] : ['-s', device.serial]
  const userId = Number(checked(await run(adb, [...selector, 'shell', 'am', 'get-current-user'])).trim())
  if (!Number.isInteger(userId)) throw new Error('No Android user.')
  const connection = { devices, activeDeviceId: device.id, busy: false }
  const screens = new DeviceScreenService(() => adb, () => scrcpy, () => connection, e => { if (e.type === 'screenSessions') globalThis.panels?.sync(e.sessions) }, async () => null)
  globalThis.screens = screens
  globalThis.panels = new TouchPanels(path.resolve('dist-electron'), true, path.resolve('android-helper/dist'), screens)
  const root = new BrowserWindow({ show: false }); globalThis.root = root
  await root.loadURL('data:text/html,Window typing hardware test')
  await screens.execute(device, 'open', { ...screenLaunch(), mode: 'virtual', virtualSize: '1200x800', audio: 'off', clipboard: false, maxFps: 30, application: { packageName: 'dev.davidv.translator', label: 'Translator input test', userId } })
  globalThis.ready = true
  globalThis.stop = async () => { globalThis.panels.shutdown(); await screens.shutdown(); app.quit() }
  setInterval(() => { if (existsSync(path.join(app.getPath('userData'), 'stop'))) void globalThis.stop() }, 500).unref()
  await writeFile(path.join(app.getPath('userData'), 'started.json'), JSON.stringify({ started: true }))
}).catch(error => { console.error(error); app.exit(1) })
