// Read-only verification against an explicitly selected phone and JPEG file.
// Does not connect, restart ADB, install a helper or change anything on the phone.
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { FileIO } from '../dist-electron/files.js'
import { parseDevices } from '../dist-electron/connections.js'
import { run, checked } from '../dist-electron/process.js'
import { readThumbnailBytes } from '../dist-electron/file-thumbnail.js'
import { FilePreviewService } from '../dist-electron/file-preview.js'
import { _electron as electron } from '@playwright/test'

const settings = JSON.parse(await fs.readFile(path.join(process.env.APPDATA, 'adb-vault/backend.json'), 'utf8'))
const adb = path.join(settings.paths.adb, 'adb.exe')
const devices = parseDevices(checked(await run(adb, ['devices', '-l'], 10000)))
const serial = process.env.ADB_VAULT_TEST_SERIAL
const phonePath = process.env.ADB_VAULT_TEST_FILE
assert.ok(serial && phonePath?.startsWith('/'), 'Set ADB_VAULT_TEST_SERIAL and an absolute ADB_VAULT_TEST_FILE JPEG path before running this hardware check.')
const device = devices.find(d => d.serial === serial && d.status === 'connected')
assert.ok(device, 'The selected phone is not connected. No connection changes were attempted.')
const location = { kind: 'device', id: device.id, serial: device.serial, transportId: device.transportId, path: phonePath }
const io = new FileIO(() => adb, () => ({ devices }))
const entry = await io.stat(location)
const listing = await io.list({ ...location, path: path.posix.dirname(location.path) }, undefined, false)
const listed = listing.entries.find(e => e.path === location.path)
assert.ok(listed)
const controls = value => [...value].flatMap((c, i) => c.charCodeAt(0) < 32 ? [{ offset: i, code: c.charCodeAt(0) }] : [])
const report = { file: entry.name, transport: device.transportId, size: entry.size, statFingerprint: entry.fingerprint, listingFingerprint: listed.fingerprint, controls: controls(entry.fingerprint), listingControls: controls(listed.fingerprint), sameFingerprint: listed.fingerprint === entry.fingerprint }
if (!process.argv.includes('--metadata-only')) {
  assert.deepEqual(report.controls, []); assert.deepEqual(report.listingControls, []); assert.equal(report.sameFingerprint, true)
  const bytes = await readThumbnailBytes(io, location, listed.fingerprint, new AbortController().signal)
  assert.ok(bytes); assert.equal(bytes.length, entry.size); assert.equal(bytes.subarray(0, 2).toString('hex'), 'ffd8')
  const previews = new FilePreviewService(io)
  try {
    const preview = await previews.open('phone-check', location, listed.fingerprint)
    assert.equal(preview.kind, 'image')
    const response = await previews.respond(new Request(preview.url))
    assert.equal(response.status, 200)
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes)
    report.thumbnailBytes = bytes.length; report.viewerBytes = bytes.length
  } finally { await previews.shutdown() }
  // Decode the actual downloaded bytes in Electron without displaying or saving
  // the personal image. This process has no Backend, ADB or user-profile startup.
  const root = path.resolve('desktop-test-results/file-preview-phone')
  await fs.mkdir(root, { recursive: true })
  await fs.writeFile(path.join(root, 'decode.mjs'), "import { app } from 'electron'; app.whenReady().then(() => {});\n")
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: [path.join(root, 'decode.mjs'), `--user-data-dir=${path.join(root, 'profile')}`], env, timeout: 30000 })
  try {
    report.decodedSize = await app.evaluate(({ nativeImage }, base64) => nativeImage.createFromBuffer(Buffer.from(base64, 'base64')).getSize(), bytes.toString('base64'))
    assert.ok(report.decodedSize.width > 0 && report.decodedSize.height > 0)
  } finally { await app.close() }
}
await fs.mkdir('desktop-test-results/file-preview-phone', { recursive: true })
await fs.writeFile(`desktop-test-results/file-preview-phone/${process.argv.includes('--metadata-only') ? 'metadata' : 'report'}.json`, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report))
