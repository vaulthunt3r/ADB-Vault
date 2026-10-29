// Opt-in hardware comparison through the production backup service.
// Read-only on the phone. No reconnect, root, app mutation, or shared-server shutdown.
import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { open as openZip } from 'yauzl'
import { AppBackupService } from '../dist-electron/app-backup.js'
import { AdbLifecycle } from '../dist-electron/adb-lifecycle.js'
import { parseDevices } from '../dist-electron/connections.js'
import { emptyApps } from '../dist-electron/apps-protocol.js'
import { checked, powershell } from '../dist-electron/process.js'

const [serial, identity, selectionFile] = process.argv.slice(2)
if (!serial || !identity || !selectionFile) throw new Error('Usage: node scripts/check-backup-wifi-soak.mjs SERIAL HARDWARE_ID BACKUP_MANIFEST')
const selection = JSON.parse(await fs.readFile(selectionFile, 'utf8'))
if (selection.device?.identity !== identity || selection.profile?.id !== 0 || !Array.isArray(selection.items)) throw new Error('Manifest identity/profile mismatch.')
const selected = selection.items.slice(0, 14)
if (selected.length !== 14 || selected.some(item => !/^[\w]+(?:\.[\w]+)+$/.test(item.packageName)) || new Set(selected.map(item => item.packageName)).size !== 14) throw new Error('Expected 14 distinct package names.')
const root = path.resolve('desktop-test-results', 'backup-wifi-soak', randomUUID())
await fs.mkdir(root, { recursive: true })
const config = JSON.parse(await fs.readFile(path.join(process.env.APPDATA, 'adb-vault', 'backend.json'), 'utf8'))
const adb = path.join(config.paths.adb, 'adb.exe'), life = new AdbLifecycle()
const reportFile = path.join(root, 'report.json'), eventsFile = path.join(root, 'events.jsonl')
const report = { startedAt: new Date().toISOString(), status: 'preparing', serial, identity, packages: selected.map(item => item.packageName), passes: [], notes: [
  'Production AppBackupService, APK-only Auto format; includes APKS creation and verification. No private app data accessed.',
  'Four passes in default/Zstd/Zstd/default order. Same package order and profile, one pinned transport; stop at first failure.',
  'ADB devices queried every 5 seconds (server-side only); ADB process IDs recorded about every 15 seconds. Raw command results retained in events.jsonl.',
  'APK/APKS contents independently rehashed after each pass; identical source APK hashes required across passes.',
  'Successful test artifacts removed after independent verification. Manifests retained. Original user backups and settings never changed.',
  'Observer phase times are wall-clock intervals between production progress messages; archive verification includes publication/bookkeeping.',
  'Source checksums warm filesystem caches. This comparison cannot prove absence of intermittent disconnects.',
] }
let eventWrites = Promise.resolve(), service, device, stopped = false, polling, pollTimer, tick = 0
const now = () => new Date().toISOString()
const record = value => { eventWrites = eventWrites.then(() => fs.appendFile(eventsFile, JSON.stringify({ at: now(), ...value }) + '\n')); return eventWrites }
const save = async () => { await eventWrites; await fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n') }
process.on('SIGINT', () => { stopped = true; service?.cancel(); console.log('Stopping test; completed test files are retained.') })
const tracedRunner = async (...args) => {
  const start = performance.now(), startedAt = now()
  try {
    const result = await life.runner(...args)
    await record({ kind: 'command', startedAt, args: args[1], ms: Math.round(performance.now() - start), ...result })
    return result
  } catch (error) {
    await record({ kind: 'command-error', startedAt, args: args[1], ms: Math.round(performance.now() - start), error: error.message })
    throw error
  }
}
const command = async args => checked(await tracedRunner(adb, args, 15000))
const deviceCommand = args => command(['-t', device.transportId, ...args])
async function processSnapshot() {
  try {
    const output = await powershell("Get-CimInstance Win32_Process -Filter \"Name='adb.exe'\" | Select-Object ProcessId,ParentProcessId,CreationDate | ConvertTo-Json -Compress", undefined, 10000)
    await record({ kind: 'adb-processes', output })
  } catch (error) { await record({ kind: 'process-snapshot-error', error: error.message }) }
}
async function poll() {
  try {
    const output = checked(await life.runner(adb, ['devices', '-l'], 5000))
    await record({ kind: 'devices', output })
    const live = parseDevices(output).find(candidate => candidate.serial === serial)
    if (!live || live.status !== 'connected' || live.transportId !== device.transportId) {
      report.connectionFailure = { at: now(), previousTransport: device.transportId, live: live || null }
      device.status = live?.status || 'disconnected'
      if (live) device.transportId = live.transportId
      service?.contextChanged(); stopped = true
    }
    if (tick++ % 3 === 0) await processSnapshot()
  } catch (error) {
    report.pollFailure = { at: now(), message: error.message }
    await record({ kind: 'poll-error', error: error.message })
    stopped = true; service?.cancel()
  }
}
function startPolling() {
  const schedule = () => { pollTimer = setTimeout(() => { polling = poll().finally(() => { polling = undefined; if (!stopped) schedule() }) }, 5000) }
  schedule()
}
async function streamHash(stream) {
  const hash = createHash('sha256'); let bytes = 0
  for await (const chunk of stream) { hash.update(chunk); bytes += chunk.length }
  return { sha256: hash.digest('hex'), bytes }
}
function artifactPath(directory, name) {
  const file = path.resolve(directory, name)
  if (path.dirname(file) !== directory || !file.startsWith(root + path.sep)) throw new Error('Test artifact escaped its exclusive run directory.')
  return file
}
async function verifySplits(file, expected) {
  const zip = await new Promise((resolve, reject) => openZip(file, { lazyEntries: true }, (error, value) => error ? reject(error) : resolve(value)))
  const wanted = new Map(expected.map(item => [item.file, item])), seen = new Set()
  await new Promise((resolve, reject) => {
    const fail = error => { zip.close(); reject(error) }
    zip.on('error', fail)
    zip.on('end', () => seen.size === wanted.size ? resolve() : reject(new Error('APKS is missing expected APK entries.')))
    zip.on('entry', entry => {
      if (!entry.fileName.endsWith('.apk')) { zip.readEntry(); return }
      const item = wanted.get(entry.fileName)
      if (!item || seen.has(entry.fileName)) { fail(new Error('Unexpected/duplicate APK entry.')); return }
      seen.add(entry.fileName)
      zip.openReadStream(entry, (error, stream) => {
        if (error) { fail(error); return }
        void streamHash(stream).then(actual => {
          if (actual.sha256 !== item.sha256 || actual.bytes !== item.bytes) throw new Error('APKS entry bytes/SHA-256 differ from the source APK.')
          zip.readEntry()
        }).catch(fail)
      })
    })
    zip.readEntry()
  })
}
function phaseOf(state) {
  if (state.status !== 'running') return 'finished'
  const text = state.message
  if (text.includes('creating APKS archive')) return 'apksPackaging'
  if (text.includes('verifying APKS archive')) return 'apksVerificationAndPublication'
  if (text.includes('Reading checksum on device')) return 'deviceChecksum'
  if (text.includes('Copying to computer') || text.includes('Copying through Android shell') || text.includes('Copying normally')) return 'transfer'
  if (text.includes('Verifying copied APK')) return 'localApkVerification'
  return 'other'
}
try {
  const devices = parseDevices(await command(['devices', '-l']))
  device = devices.find(candidate => candidate.serial === serial && candidate.status === 'connected')
  if (!device?.transportId || device.method !== 'Wi-Fi') throw new Error('Expected connected Wi-Fi transport.')
  if ((await deviceCommand(['shell', 'getprop', 'ro.serialno'])).trim() !== identity) throw new Error('Hardware identity mismatch.')
  if ((await deviceCommand(['shell', 'am', 'get-current-user'])).trim() !== '0') throw new Error('Expected Android user 0.')
  device.hardwareId = identity
  report.initialTransport = device.transportId
  report.adbVersion = await command(['version'])
  await processSnapshot()
  const connection = { activeDeviceId: device.id, devices: [device] }
  const apps = { ...emptyApps(), deviceId: device.id, userId: 0, status: 'ready', profiles: [{ id: 0, name: 'Owner' }], apps: selected.map(item => ({ packageName: item.packageName, label: item.label || item.packageName, userId: 0, versionName: item.sourceVersionName || '', versionCode: item.sourceVersionCode || 0, enabled: true, system: false })) }
  report.status = 'running'; await save()
  console.log(JSON.stringify({ phase: 'ready', reportFile, transport: device.transportId, packages: report.packages, order: ['default', 'zstd', 'zstd', 'default'] }))
  startPolling()
  let sourceSignature
  for (const [index, zstd] of [false, true, true, false].entries()) {
    if (stopped) throw new Error('Comparison stopped after cancellation or a connection change.')
    if ((await deviceCommand(['shell', 'getprop', 'ro.serialno'])).trim() !== identity) throw new Error('Hardware identity changed.')
    const pass = { index: index + 1, mode: zstd ? 'zstd' : 'default', startedAt: now(), status: 'running', observedPhaseMs: {}, apps: [] }
    report.passes.push(pass); await save()
    console.log(JSON.stringify({ phase: 'pass-started', index: pass.index, mode: pass.mode }))
    let phase = 'other', phaseAt = performance.now(), lastMessage = '', lastCompleted = -1
    const changePhase = next => {
      if (next === phase) return
      if (phase !== 'finished') pass.observedPhaseMs[phase] = (pass.observedPhaseMs[phase] || 0) + Math.round(performance.now() - phaseAt)
      phase = next; phaseAt = performance.now()
    }
    service = new AppBackupService(() => adb, () => connection, () => apps, state => {
      changePhase(phaseOf(state))
      if (state.message !== lastMessage || state.completed !== lastCompleted) {
        void record({ kind: 'backup-progress', pass: pass.index, mode: pass.mode, status: state.status, message: state.message, completed: state.completed, total: state.total })
        if (state.completed !== lastCompleted) console.log(JSON.stringify({ pass: pass.index, mode: pass.mode, completed: state.completed, total: state.total, message: state.message }))
        lastMessage = state.message; lastCompleted = state.completed
      }
    }, () => {}, { folder: async () => root, presetFile: async () => null }, tracedRunner, undefined, undefined, () => zstd)
    const start = performance.now()
    await service.execute({ id: device.id, userId: 0, packages: report.packages, folderName: `pass-${pass.index}-${pass.mode}`, format: 'auto' }, false)
    changePhase('finished')
    pass.backupMs = Math.round(performance.now() - start)
    pass.status = service.state.status; pass.message = service.state.message; pass.outputDirectory = service.state.outputDirectory
    if (pass.status !== 'complete') { await save(); throw new Error(pass.message) }
    const manifestName = (await fs.readdir(pass.outputDirectory)).find(name => /^manifest-.*\.json$/.test(name))
    if (!manifestName) throw new Error('Completed backup has no manifest.')
    pass.manifest = path.join(pass.outputDirectory, manifestName)
    const manifest = JSON.parse(await fs.readFile(pass.manifest, 'utf8'))
    const signature = JSON.stringify(manifest.items.map(item => ({ packageName: item.packageName, files: item.files.map(file => ({ source: file.source, bytes: file.bytes, sha256: file.sha256 })) })))
    if (sourceSignature && sourceSignature !== signature) throw new Error('Source APKs changed; cross-pass comparison is invalid.')
    sourceSignature = signature
    const verifyStart = performance.now()
    for (const item of manifest.items) {
      if (item.status !== 'success' || !item.artifact) throw new Error('Expected a successful APK/APKS artifact for every selected app.')
      const file = artifactPath(pass.outputDirectory, item.artifact)
      const actual = await streamHash(createReadStream(file))
      if (actual.sha256 !== item.artifactIntegrity.sha256 || actual.bytes !== item.artifactIntegrity.bytes) throw new Error('Published artifact bytes/SHA-256 mismatch.')
      if (item.archiveFormat === 'apks') await verifySplits(file, item.files)
      pass.apps.push({ packageName: item.packageName, format: item.archiveFormat, bytes: actual.bytes, apkCount: item.files.length, compression: [...new Set(item.files.map(file => file.transfer?.compression))], timingsMs: item.files.reduce((total, file) => { for (const [key, value] of Object.entries(file.timingsMs)) total[key] = (total[key] || 0) + value; return total }, {}) })
    }
    pass.independentVerificationMs = Math.round(performance.now() - verifyStart)
    pass.verified = true; pass.finishedAt = now()
    await save()
    // Only exact artifacts from this successful test operation; preserve manifests.
    for (const item of manifest.items) await fs.rm(artifactPath(pass.outputDirectory, item.artifact))
    pass.testArtifactsRemoved = true
    await save(); console.log(JSON.stringify({ phase: 'pass-finished', ...pass, apps: pass.apps.length }))
  }
  report.status = 'complete'
} catch (error) {
  report.status = 'error'; report.error = error.message; process.exitCode = 1
} finally {
  stopped = true; clearTimeout(pollTimer); await polling
  await service?.shutdown()
  await processSnapshot()
  report.finishedAt = now()
  await save()
  console.log(JSON.stringify({ phase: 'finished', status: report.status, error: report.error, reportFile, connectionFailure: report.connectionFailure }))
  await life.shutdown(false)
}
