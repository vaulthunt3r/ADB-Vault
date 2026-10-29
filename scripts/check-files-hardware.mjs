// Read-only smoke check: no files, connection settings or ADB server state are changed.
import fs from 'node:fs/promises'
import path from 'node:path'
import { AdbLifecycle } from '../dist-electron/adb-lifecycle.js'
import { FileIO } from '../dist-electron/files.js'
import { checked } from '../dist-electron/process.js'

const settings = JSON.parse(await fs.readFile(path.join(process.env.APPDATA, 'adb-vault', 'backend.json'), 'utf8'))
const adb = path.join(settings.paths.adb, 'adb.exe'), lifecycle = new AdbLifecycle()
try {
  const output = checked(await lifecycle.runner(adb, ['devices', '-l'], 10000))
  const devices = output.split(/\r?\n/).flatMap(line => {
    const match = line.match(/^(\S+)\s+device(?:\s|$)/)
    return match ? [{ id: match[1], serial: match[1], transportId: line.match(/transport_id:(\d+)/)?.[1], status: 'connected' }] : []
  })
  if (!devices.length) { console.log('NO_CONNECTED_PHONE: hardware validation skipped.'); process.exitCode = 2 }
  const io = new FileIO(() => adb, () => ({ devices }), lifecycle.runner)
  for (let n = 0; n < devices.length; n++) {
    const d = devices[n], location = { kind: 'device', id: d.id, serial: d.serial, transportId: d.transportId, path: process.argv.includes('--system-root') ? '/' : '/sdcard' }
    const result = await io.list(location)
    console.log(JSON.stringify({ phone: n + 1, directoryRead: true, canonicalPath: result.location.path, entries: result.entries.length, warning: result.warning, metadataValid: result.entries.every(e => e.fingerprint && Number.isFinite(e.size) && Number.isFinite(e.modified)) }))
    if (process.argv.includes('--storages')) console.log(JSON.stringify({ phone: n + 1, storages: await io.storages(location) }))
  }
} finally { await lifecycle.shutdown(false) }
