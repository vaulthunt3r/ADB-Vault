// Opt-in read-only phone check. Copies one named APK into workspace test results.
import fs from 'node:fs/promises'
import path from 'node:path'
import { AdbLifecycle } from '../dist-electron/adb-lifecycle.js'
import { AppActionsService } from '../dist-electron/app-actions.js'
import { ApkTransferSession } from '../dist-electron/apk-transfer.js'
import { emptyApps } from '../dist-electron/apps-protocol.js'
import { parseDevices } from '../dist-electron/connections.js'
import { checked } from '../dist-electron/process.js'

const [serial, identity, packageName, mode] = process.argv.slice(2)
if (mode && mode !== '--zstd') throw new Error('Optional transfer mode: --zstd')
if (!serial || !identity || !/^[\w]+(?:\.[\w]+)+$/.test(packageName || '')) throw new Error('Usage: node scripts/check-vendor-apk-hardware.mjs SERIAL IDENTITY PACKAGE')
const config = JSON.parse(await fs.readFile(path.join(process.env.APPDATA, 'adb-vault', 'backend.json'), 'utf8'))
const lifecycle = new AdbLifecycle(), adb = path.join(config.paths.adb, 'adb.exe')
try {
  const device = parseDevices(checked(await lifecycle.runner(adb, ['devices', '-l'], 5000))).find(d => d.serial === serial && d.status === 'connected')
  if (!device) throw new Error('The selected device is not connected.')
  const args = device.transportId ? ['-t', device.transportId] : ['-s', serial]
  if (checked(await lifecycle.runner(adb, [...args, 'shell', 'getprop', 'ro.serialno'], 5000)) !== identity) throw new Error('Unexpected hardware identity.')
  device.hardwareId = identity
  const connection = { activeDeviceId: device.id, devices: [device] }
  const apps = { ...emptyApps(), status: 'ready', deviceId: device.id, userId: 0, apps: [{ packageName, label: packageName, userId: 0 }], profiles: [{ id: 0, name: 'Owner' }] }
  const folder = path.resolve('desktop-test-results', 'vendor-apk-export')
  await fs.mkdir(folder, { recursive: true })
  let fallback = false
  const service = new AppActionsService(() => adb, () => connection, () => apps, state => {
    if (state.message.startsWith('Copying through Android shell')) fallback = true
  }, () => {}, { confirm: async () => false, exportFolder: async () => folder }, async () => {}, lifecycle.runner, undefined, () => new ApkTransferSession(mode === '--zstd'))
  await service.execute({ id: device.id, userId: 0, packageName }, 'export')
  if (service.state.status !== 'success') throw new Error(service.state.message)
  const manifest = JSON.parse(await fs.readFile(path.join(service.state.exportPath, 'manifest.json'), 'utf8'))
  console.log(JSON.stringify({ status: service.state.status, fallback, output: service.state.exportPath, files: manifest.files.map(f => ({ source: f.source, bytes: f.bytes, sha256: f.sha256, transfer: f.transfer, timingsMs: f.timingsMs })) }))
} finally { await lifecycle.shutdown(false) }
