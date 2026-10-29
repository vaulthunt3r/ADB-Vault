import { apkFingerprints } from './app-data-restore.js'
import { constants, createReadStream, createWriteStream } from 'node:fs'
import { copyFile, link, lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import path from 'node:path'
import { ZipFile } from 'yazl'
import { backupIdentity, type BackupCatalog, type BackupCopy } from './backup-catalog.js'
import { archiveStreamCommand, finalizeArchiveStream, captureData, checkDataTarget, planData, shellQuote, type DataPlan, type DataPart, type DeviceShell } from './app-data-backup.js'
import { actionOutput, AppActionsService } from './app-actions.js'
import { ApkTransferSession } from './apk-transfer.js'
import { validateAppTarget } from './app-details-protocol.js'
import { backupParts, defaultBackupContents, backupFormats, type AppPreset, type BackupRequest, type BackupState, type PresetPreview } from './app-backup-protocol.js'
import type { AppsSnapshot, AndroidApp } from './apps-protocol.js'
import type { ConnectionSnapshot } from './contracts.js'
import { checked, run, type Runner } from './process.js'

export function validatePresetName(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 80 || /[<>:"/\\|?*\x00-\x1f]/.test(value) || /[. ]$/.test(value) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value) || value === '.' || value === '..') throw new Error('Use a preset name of 1–80 characters without filesystem symbols or reserved Windows names.')
}
export function validateBackupRequest(value: BackupRequest, presetOnly = false) {
  if (value.contents !== undefined && (!value.contents || typeof value.contents !== 'object' || Object.keys(value.contents).some(k => !backupParts.includes(k as typeof backupParts[number])) || !backupParts.every(k => typeof value.contents![k] === 'boolean') || !backupParts.some(k => value.contents![k]))) throw new Error('Choose at least one valid backup component.')
  if (presetOnly && value.contents) throw new Error('Presets contain package names only.')
  if (value.stopApps !== undefined && typeof value.stopApps !== 'boolean' || value.allowPartial !== undefined && typeof value.allowPartial !== 'boolean') throw new Error('Invalid backup options.')
  if (value.contents && backupParts.some(k => k !== 'apk' && value.contents![k]) && value.stopApps !== true) throw new Error('Confirm stopping selected applications before copying their data.')
  if (value.zip !== undefined && typeof value.zip !== 'boolean') throw new Error('Invalid ZIP option.')
  if (value.zip && (presetOnly || !['auto', 'apk', 'apks'].includes(value.format))) throw new Error('ZIP packaging is available for APK, APKS and Auto exports only.')
  if (presetOnly || value.name !== undefined) validatePresetName(value.name)
  if (value.folderName !== undefined) validatePresetName(value.folderName)
  if (typeof value.id !== 'string' || !value.id || value.id.length > 512 || /[\x00-\x1f]/.test(value.id) || !backupFormats.includes(value.format) || !Array.isArray(value.packages) || !value.packages.length || value.packages.length > 10000 || new Set(value.packages).size !== value.packages.length) throw new Error('Invalid backup selection or format.')
  for (const pkg of value.packages) validateAppTarget(pkg, value.userId)
}
export function parsePreset(text: string): AppPreset {
  if (Buffer.byteLength(text) > 4_000_000) throw new Error('Preset exceeds the 4 MB limit.')
  const value = JSON.parse(text.replace(/^\uFEFF/, ''))
  if (!value || value.format !== 'adb-vault-app-preset' || value.version !== 1) throw new Error('Unsupported preset format or version.')
  validatePresetName(value.name)
  const bounded = (v: unknown, max: number) => typeof v === 'string' && v.length <= max && !/[\x00-\x1f]/.test(v)
  if (!value.device || !value.profile || !bounded(value.device.name, 512) || !bounded(value.device.identity, 512) || !bounded(value.profile.name, 512) || !bounded(value.createdAt, 64) || !Number.isFinite(Date.parse(value.createdAt)) || !Array.isArray(value.applications) || !value.applications.length || value.applications.length > 10000) throw new Error('Invalid preset metadata.')
  const packages: string[] = []
  const applications = value.applications.map((app: { packageName: string; label: string }) => {
    if (!app || !bounded(app.label, 8192)) throw new Error('Invalid application in preset.')
    validateAppTarget(app.packageName, value.profile.id); packages.push(app.packageName)
    return { packageName: app.packageName, label: app.label }
  })
  if (new Set(packages).size !== packages.length) throw new Error('Duplicate packages in preset.')
  return { format: value.format, version: 1, name: value.name, createdAt: value.createdAt, device: { name: value.device.name, identity: value.device.identity }, profile: { id: value.profile.id, name: value.profile.name }, applications }
}
function folderName(value: string) { return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 60) || 'Device' }
export function apkArtifactStem(label: string, packageName: string) {
  const clean = (value: string) => value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().replace(/\.(?:apk|apks)$/i, '').slice(0, 80).replace(/[. ]+$/g, '')
  const name = clean(label) || clean(packageName) || 'Application'
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? `_${name}` : name
}
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-')
const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 8)
async function childDirectory(parent: string, name: string) {
  const target = path.resolve(parent, name)
  if (path.dirname(target) !== parent) throw new Error('Invalid backup directory.')
  await mkdir(target, { recursive: true })
  const resolved = await realpath(target)
  if ((await lstat(target)).isSymbolicLink() || resolved !== target) throw new Error('Backup directories must not be symbolic links or junctions.')
  return resolved
}
async function writeJson(file: string, value: unknown, exclusive = false) {
  await writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: exclusive ? 'wx' : 'w' })
}
async function fileDigest(file: string, signal: AbortSignal) {
  const sha = createHash('sha256'); let bytes = 0
  for await (const chunk of createReadStream(file, { signal })) { sha.update(chunk); bytes += chunk.length }
  return { sha256: sha.digest('hex'), bytes }
}
// Publish only complete files; hard links fail atomically if a name already exists.
async function publishArtifact(source: string, output: string, stem: string, extension: string, packageName: string) {
  for (let attempt = 0; attempt < 10000; attempt++) {
    const suffix = attempt === 0 ? '' : ` (${packageName}${attempt > 1 ? ` ${attempt}` : ''})`
    const name = `${stem}${suffix}.${extension}`
    const target = path.resolve(output, name)
    if (path.dirname(target) !== output) throw new Error('Invalid APK filename.')
    try {
      try { await link(source, target) } catch (error) {
        if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'ENOSYS'].includes((error as NodeJS.ErrnoException).code || '')) throw error
        // FAT/exFAT destinations may not support links. Never replace an existing file.
        await copyFile(source, target, constants.COPYFILE_EXCL)
      }
      return name
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  throw new Error('Too many copies with the same APK filename.')
}
interface Dialogs { folder: () => Promise<string | null>; presetFile: () => Promise<string | null> }
const lostAdbConnection = (message: string) => /no device with transport id\b|\bdevice (?:offline|not found)\b|\bdevice '[^'\r\n]+' not found\b|no devices\/emulators found|\bprotocol fault\b|\bconnection (?:reset|closed|lost)\b|(?:^|\n)(?:adb(?:\.exe)?:\s*)?error:\s*closed\b/i.test(message)

async function writeGroupZip(target: string, directory: string, artifacts: string[], report: object, signal: AbortSignal) {
  const zip = new ZipFile()
  zip.on('error', error => (zip.outputStream as Readable).destroy(error))
  const saved = pipeline(zip.outputStream, createWriteStream(target, { flags: 'wx' }), { signal })
  void saved.catch(() => {})
  try {
    zip.addBuffer(Buffer.from(JSON.stringify(report, null, 2) + '\n'), 'manifest.json')
    for (const artifact of artifacts) {
      const file = path.resolve(directory, artifact)
      if (path.dirname(file) !== directory) throw new Error('Invalid archive entry.')
      const { size } = await stat(file)
      // APK/APKS files are already archives. Store them intact, without recompression.
      zip.addReadStreamLazy(artifact, { compress: false, size }, callback => callback(null, createReadStream(file, { signal })))
    }
    zip.end()
    await saved
  } catch (error) {
    ;(zip.outputStream as Readable).destroy(error instanceof Error ? error : new Error(String(error)))
    await saved.catch(() => {})
    throw error
  }
}

export class AppBackupService {
  state: BackupState | null = null
  preview: PresetPreview | null = null
  private locked = false
  private controller?: AbortController
  private current?: AppActionsService
  private pending?: Promise<void>
  private interruption?: string
  private context?: { id: string; userId: number; serial: string; transport?: string; hardware?: string }
  get busy() { return this.locked }
  constructor(private adb: () => string | null, private connection: () => ConnectionSnapshot, private apps: () => AppsSnapshot,
    private publish: (state: BackupState) => void, private log: (message: string, tone: 'success' | 'warning' | 'info') => void,
    private dialogs: Dialogs, private runner: Runner = run, private catalogue?: BackupCatalog, private refreshApp?: (id: string, userId: number, packageName: string) => Promise<void>, private apkZstd: () => boolean = () => false) {}
  private update(patch: Partial<BackupState>) { this.state = { ...this.state!, ...patch }; this.publish(this.state) }
  contextChanged() {
    if (!this.context || this.controller?.signal.aborted) return
    const { id, userId, serial, transport, hardware } = this.context
    const d = this.connection().devices.find(d => d.id === id && d.status === 'connected'), apps = this.apps()
    if (!d) this.interrupt('Device disconnected.')
    else if (this.connection().activeDeviceId !== id) this.interrupt('The selected device changed.')
    else if (d.serial !== serial || d.transportId !== transport || d.hardwareId !== hardware) this.interrupt('The ADB connection changed. Review the connected device before retrying.')
    else if (apps.deviceId !== id || apps.userId !== userId) this.interrupt('The selected device/profile changed.')
    else if (apps.status !== 'ready') this.interrupt('The application list is no longer available.')
  }
  private interrupt(reason: string) {
    if (this.controller?.signal.aborted) return
    this.interruption = `Backup interrupted: ${reason} Completed files were kept. Retry the remaining applications after checking the connection and profile.`
    this.cancel()
  }
  private ensureCurrent() { this.contextChanged(); if (this.controller?.signal.aborted) throw new Error(this.interruption || 'Backup cancelled. Completed files were kept.') }
  cancel() { this.controller?.abort(); this.current?.cancel() }
  async shutdown() { this.cancel(); await this.pending }
  execute(request: BackupRequest, presetOnly: boolean) {
    if (this.locked) return Promise.reject(new Error('Wait for the current backup or preset operation.'))
    validateBackupRequest(request, presetOnly)
    this.state = null
    this.interruption = undefined
    this.locked = true
    const task = this.perform(request, presetOnly).finally(() => { this.locked = false; this.current = undefined; this.context = undefined; this.controller = undefined })
    this.pending = task
    void task.finally(() => { if (this.pending === task) this.pending = undefined }).catch(() => {})
    return task
  }
  async loadPreset(id: string, userId: number) {
    if (this.locked) throw new Error('Wait for the current backup or preset operation.')
    this.locked = true; this.preview = null
    try {
      const initial = this.apps(), device = this.connection().devices.find(d => d.id === id && d.status === 'connected')
      if (initial.status !== 'ready' || initial.deviceId !== id || initial.userId !== userId || !device || this.connection().activeDeviceId !== id) throw new Error('Load a connected Android profile first.')
      const file = await this.dialogs.presetFile(); if (!file) return
      const handle = await open(file, 'r')
      let preset: AppPreset
      try { if ((await handle.stat()).size > 4_000_000) throw new Error('Preset exceeds the 4 MB limit.'); preset = parsePreset(await handle.readFile('utf8')) } finally { await handle.close() }
      const current = this.apps(), currentDevice = this.connection().devices.find(d => d.id === id && d.status === 'connected')
      if (current.status !== 'ready' || current.deviceId !== id || current.userId !== userId || this.connection().activeDeviceId !== id || !currentDevice || currentDevice.serial !== device.serial || currentDevice.transportId !== device.transportId || currentDevice.hardwareId !== device.hardwareId) throw new Error('Device/profile changed. Load the preset again.')
      const existing = new Set(current.apps.map(app => app.packageName)), packages = preset.applications.map(app => app.packageName)
      this.preview = { token: randomUUID(), id, userId, preset, matched: packages.filter(pkg => existing.has(pkg)), missing: packages.filter(pkg => !existing.has(pkg)) }
    } finally { this.locked = false }
  }
  private async perform(request: BackupRequest, presetOnly: boolean) {
    const snapshot = this.apps(), connection = this.connection(), device = connection.devices.find(d => d.id === request.id && d.status === 'connected')
    const selected = request.packages.map(pkg => snapshot.apps.find(app => app.packageName === pkg && app.userId === request.userId))
    if (!device || connection.activeDeviceId !== request.id || snapshot.status !== 'ready' || snapshot.deviceId !== request.id || snapshot.userId !== request.userId || selected.some(app => !app)) throw new Error('The selection no longer belongs to the connected Android profile. Refresh Apps and select again.')
    const contents = request.contents || defaultBackupContents()
    const dataParts = backupParts.filter((p): p is DataPart => p !== 'apk' && contents[p])
    if ((contents.data || contents.cache) && !snapshot.options.root) throw new Error('Enable root in Settings > Apps to back up internal data or cache.')
    const apps = selected as AndroidApp[], controller = new AbortController(); this.controller = controller
    const transferSession = new ApkTransferSession(this.apkZstd())
    const runner: Runner = async (...args) => {
      try {
        const result = await this.runner(...args)
        checked(result)
        return result
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (lostAdbConnection(message)) this.interrupt(`ADB connection lost. ${message}`)
        throw error
      }
    }
    this.context = { id: device.id, userId: request.userId, serial: device.serial, transport: device.transportId, hardware: device.hardwareId }
    const metadata = { createdAt: new Date().toISOString(), device: { name: device.name, identity: device.hardwareId || device.serial }, profile: { id: request.userId, name: snapshot.profiles.find(p => p.id === request.userId)?.name || `User ${request.userId}` }, applications: apps.map(app => ({ packageName: app.packageName, label: app.label })) }
    this.state = { operationId: randomUUID(), startedAt: new Date().toISOString(), id: request.id, userId: request.userId, name: presetOnly ? request.name! : request.folderName || request.name || 'Applications', format: request.format, zip: !!request.zip, contents, stopApps: request.stopApps, allowPartial: request.allowPartial, operation: presetOnly ? 'preset' : 'backup', status: 'running', message: 'Choose a destination folder…', items: apps.map(app => ({ packageName: app.packageName, label: app.label, status: 'pending' })), completed: 0, total: apps.length }; this.publish(this.state)
    let work: string | undefined, output: string | undefined, reportFile: string | undefined
    const packageReports = new Map<string, object>()
    const catalogueCopies: BackupCopy[] = []
    let catalogueWarning = ''
    const register = async (copies: BackupCopy[], replacing: string[] = []) => {
      try { await this.catalogue?.record(copies, replacing); return true }
      catch { catalogueWarning = ' Backup badge catalogue could not be saved; exported files are kept.'; return false }
    }
    const report = () => ({ format: dataParts.length ? 'adb-vault-app-backup' : 'adb-vault-apk-backup', version: dataParts.length ? 3 : 2, createdAt: metadata.createdAt, device: metadata.device, profile: metadata.profile, name: this.state!.name, apkFormat: request.format, contents: { ...contents, internalData: contents.data, externalData: contents.data }, dataArchive: { format: 'tar', ownerAndMode: true, extendedAttributes: false, storage: 'primary emulated only', restoration: 'validated regular files and directories; matching installed APKs required; private files require root' }, status: this.state!.status, items: this.state!.items.map(item => ({ ...item, ...packageReports.get(item.packageName) })) })
    const saveReport = async () => { if (reportFile) { const tmp = `${reportFile}.tmp`; await writeJson(tmp, report()); await rename(tmp, reportFile) } }
    try {
      const chosen = await this.dialogs.folder()
      if (!chosen) { this.cancel(); this.update({ status: 'cancelled', message: 'No folder selected.' }); return }
      this.ensureCurrent()
      const root = await realpath(chosen)
      const deviceFolder = await childDirectory(root, `${folderName(device.name)}-${hash(metadata.device.identity)}`)
      const profileFolder = await childDirectory(deviceFolder, `Profile ${metadata.profile.id} - ${folderName(metadata.profile.name).trim().replace(/[. ]+$/g, '') || 'Profile'}`)
      if (presetOnly) {
        const preset: AppPreset = { format: 'adb-vault-app-preset', version: 1, name: request.name!, ...metadata }
        let presetFile = path.join(profileFolder, `${preset.name}.json`)
        try { await writeJson(presetFile, preset, true) } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
          presetFile = path.join(profileFolder, `${preset.name}-${stamp()}-${randomUUID().slice(0, 8)}.json`)
          await writeJson(presetFile, preset, true)
        }
        this.ensureCurrent()
        this.update({ presetPath: presetFile, status: 'complete', message: 'Preset saved. No APKs or application data were copied.', completed: apps.length, outputDirectory: profileFolder, items: this.state.items.map(item => ({ ...item, status: 'success' })) }); return
      }
      output = await childDirectory(profileFolder, this.state.name)
      // Each operation has its own report, including repeated exports to the same folder.
      reportFile = path.join(output, `manifest-${stamp()}-${randomUUID().slice(0, 8)}.json`)
      await writeJson(reportFile, report(), true)
      this.update({ outputDirectory: output, message: 'Preparing backup…' }); await saveReport()
      for (let index = 0; index < apps.length; index++) {
        this.ensureCurrent()
        const app = apps[index]
        const patchItem = (patch: Partial<BackupState['items'][number]>) => this.update({ items: this.state!.items.map((item, i) => i === index ? { ...item, ...patch } : item) })
        patchItem({ status: 'running' }); this.update({ message: `Saving ${app.label} (${index + 1}/${apps.length})…`, currentFile: undefined })
        let stopped = false
        const artifacts: NonNullable<BackupState['items'][number]['artifacts']> = []
        const parts: NonNullable<BackupState['items'][number]['parts']> = []
        const shell: DeviceShell = async (cmd, root = false, file) => {
          this.ensureCurrent()
          const adb = this.adb(); if (!adb) throw new Error('ADB is unavailable.')
          const command = root && device.root?.method !== 'adb' ? `su -c ${shellQuote(cmd)}` : cmd
          const token = file ? randomUUID() : undefined
          const args = file ? ['exec-out', archiveStreamCommand(command, token!)] : ['shell', '-T', command]
          const result = await runner(adb, [...(device.transportId ? ['-t', device.transportId] : ['-s', device.serial]), ...args], file ? 1800000 : 30000, undefined, undefined, { signal: controller.signal, stdoutFile: file })
          checked(result); this.ensureCurrent()
          if (file) await finalizeArchiveStream(file, token!)
          if (file && result.stderr.trim()) throw new Error('Data archive was not complete: ' + result.stderr.slice(0, 500))
          return file ? result.stdout : actionOutput([result.stdout, result.stderr].filter(Boolean).join('\n'))
        }
        const plans: DataPlan[] = []
        try {
          work = await mkdtemp(path.join(output, '.partial-'))
          const temporary = work
          if (dataParts.length) {
            await checkDataTarget(app, shell)
            const root = snapshot.options.root === true && (!device.root || device.root.status === 'available')
            if (root && !/^uid=0\b/.test(await shell('id', true))) throw new Error('Root access was not granted to Shell.')
            if (!(await shell('tar --help', root)).includes('--exclude')) throw new Error('A compatible tar with --exclude support is required.')
            for (const part of dataParts) {
              try { plans.push(await planData(app, part, root, shell)) }
              catch (error) {
                parts.push({ component: part, status: 'error', message: error instanceof Error ? error.message : String(error) })
                patchItem({ parts: [...parts] })
                if (!request.allowPartial) throw error
              }
            }
          }
          if (contents.apk) {
            try {
              const exporter = new AppActionsService(this.adb, this.connection, this.apps, state => {
                if (state.status === 'running') this.update({ message: `${app.label}: ${state.message}`, currentFile: state.total ? { completed: state.completed || 0, total: state.total } : undefined })
              }, () => {}, { confirm: async () => false, exportFolder: async () => temporary }, async () => {}, runner, undefined, () => transferSession)
              this.current = exporter
              const outcome = await exporter.execute({ id: request.id, userId: request.userId, packageName: app.packageName }, 'export', request.format === 'apk' || request.format === 'apks' ? request.format : undefined)
              this.ensureCurrent()
              if (outcome === 'skipped') {
                patchItem({ status: 'skipped', message: exporter.state?.message })
                this.update({ completed: index + 1, phase: undefined, currentFile: undefined }); await saveReport()
                this.ensureCurrent()
                continue
              }
              if (exporter.state?.status !== 'success' || !exporter.state.exportPath) throw new Error(exporter.state?.message || 'APK export failed.')
              const exported = exporter.state.exportPath
              if (path.dirname(exported) !== temporary) throw new Error('Unexpected export location.')
              const original = JSON.parse(await readFile(path.join(exported, 'manifest.json'), 'utf8')) as { files: { file: string; source: string; sha256: string; bytes: number }[] }
              const single = original.files.length === 1
              const format = request.format === 'auto' || request.format === 'files' ? single ? 'apk' : 'apks' : request.format
              const artifact = `${apkArtifactStem(app.label, app.packageName)}.${format}`
              let archiveDigest: { sha256: string; bytes: number } | undefined
              if (format === 'apk') {
                if (original.files[0].file !== artifact) await rename(path.join(exported, original.files[0].file), path.join(exported, artifact!))
              }
              else if (artifact) {
                this.update({ message: `${app.label}: creating ${format.toUpperCase()} archive…` })
                const zip = new ZipFile(), target = path.join(exported, artifact)
                zip.on('error', error => (zip.outputStream as Readable).destroy(error))
                const saved = pipeline(zip.outputStream, createWriteStream(target, { flags: 'wx' }), { signal: controller.signal })
                // Attach rejection handling before asynchronous file preparation.
                void saved.catch(() => {})
                const meta = { package: app.packageName, label: app.label, version_code: app.versionCode, version_name: app.versionName, export_timestamp: Date.now() }
                zip.addBuffer(Buffer.from(JSON.stringify(meta)), 'meta.sai_v1.json')
                zip.addBuffer(Buffer.from(JSON.stringify({ ...meta, meta_version: 2, split_apk: !single, min_sdk: app.minSdk, target_sdk: app.targetSdk, backup_components: [{ type: 'apk_files', size: original.files.reduce((n, f) => n + f.bytes, 0) }] })), 'meta.sai_v2.json')
                for (const file of original.files) zip.addReadStreamLazy(file.file, { compress: false, size: file.bytes }, callback => callback(null, createReadStream(path.join(exported, file.file), { signal: controller.signal })))
                zip.end(); await saved
                this.update({ message: `${app.label}: verifying ${format.toUpperCase()} archive…` })
                archiveDigest = await fileDigest(target, controller.signal)
                for (const file of original.files) await rm(path.join(exported, file.file))
              }
              this.ensureCurrent()
              const published = await publishArtifact(path.join(exported, artifact), output, apkArtifactStem(app.label, app.packageName), format, app.packageName)
              packageReports.set(app.packageName, { sourceVersionName: app.versionName, sourceVersionCode: app.versionCode, archiveFormat: format, artifactIntegrity: archiveDigest || { sha256: original.files[0].sha256, bytes: original.files[0].bytes }, files: original.files.map(file => ({ ...file, file: format === 'apk' ? published : file.file })) })
              artifacts.push({ component: 'apk', file: published, ...(archiveDigest || { sha256: original.files[0].sha256, bytes: original.files[0].bytes }) })
              parts.push({ component: 'apk', status: 'saved' })
              patchItem({ artifact: published, artifacts: [...artifacts], parts: [...parts], message: 'Verified APK copy saved.' })
              const identity = backupIdentity(device)
              if (identity && (format === 'apk' || format === 'apks')) {
                const copy: BackupCopy = { identity, userId: request.userId, packageName: app.packageName, versionName: app.versionName, versionCode: app.versionCode, createdAt: metadata.createdAt, file: path.join(output, published), format }
                catalogueCopies.push(copy)
                await register([copy])
              }
            } catch (error) {
              parts.push({ component: 'apk', status: 'error', message: error instanceof Error ? error.message : String(error) })
              patchItem({ artifacts: [...artifacts], parts: [...parts] })
              if (!request.allowPartial || controller.signal.aborted) throw error
            }
          }
          let dataApkSha256: string[] = []
          if (plans.some(p => p.roots.length)) {
            dataApkSha256 = await apkFingerprints(app, shell)
            await shell(`am force-stop --user ${app.userId} ${shellQuote(app.packageName)}`)
            stopped = true
          }
          for (const plan of plans) {
            try {
              if (!plan.roots.length) { parts.push({ component: plan.part, status: 'absent', message: 'No directories found.' }); continue }
              this.update({ phase: 'data', message: `${app.label}: copying ${plan.part}...`, currentFile: undefined })
              const file = path.join(temporary, `${plan.part}.tar`)
              await captureData(plan, file, shell)
              const integrity = await fileDigest(file, controller.signal)
              this.ensureCurrent()
              const name = await publishArtifact(file, output, apkArtifactStem(app.label, app.packageName), `${plan.part}.tar`, app.packageName)
              artifacts.push({ component: plan.part, file: name, ...integrity })
              parts.push({ component: plan.part, status: 'saved', message: plan.absent.length ? `Optional directories absent: ${plan.absent.join(', ')}` : undefined })
              packageReports.set(app.packageName, { ...packageReports.get(app.packageName), sourceUid: app.uid, dataApkSha256, sourceVersionName: app.versionName, sourceVersionCode: app.versionCode, dataSources: plans.map(p => ({ component: p.part, roots: p.roots, absent: p.absent, selinux: p.selinux })) })
              const identity = backupIdentity(device)
              if (identity) {
                const copy: BackupCopy = { identity, userId: app.userId, packageName: app.packageName, versionName: app.versionName, versionCode: app.versionCode, createdAt: metadata.createdAt, file: path.join(output, name), format: 'tar', component: plan.part }
                catalogueCopies.push(copy); await register([copy])
              }
              patchItem({ artifacts: [...artifacts], parts: [...parts] })
            } catch (error) {
              parts.push({ component: plan.part, status: 'error', message: error instanceof Error ? error.message : String(error) })
              patchItem({ artifacts: [...artifacts], parts: [...parts] })
              if (!request.allowPartial || controller.signal.aborted) throw error
            }
          }
          patchItem({ status: parts.some(p => p.status === 'error') ? 'error' : 'success', artifacts: [...artifacts], parts: [...parts], message: parts.some(p => p.status === 'error') ? 'Some components could not be copied. Completed files were kept.' : artifacts.length ? 'Selected components saved.' : 'No data directories were present; no backup files created.' })
        } catch (error) {
          patchItem({ status: controller.signal.aborted && !this.interruption ? 'cancelled' : 'error', message: this.interruption || (error instanceof Error ? error.message : String(error)) })
        } finally {
          this.current = undefined
          if (stopped && !controller.signal.aborted) { try { await this.refreshApp?.(request.id, request.userId, app.packageName) } catch { /* Copy results stay valid if inventory refresh fails. */ } }
          if (work && path.dirname(path.resolve(work)) === output && path.basename(work).startsWith('.partial-')) { await rm(work, { recursive: true, force: true }); work = undefined }
        }
        this.update({ completed: index + 1, phase: undefined, currentFile: undefined }); await saveReport()
        this.ensureCurrent()
      }
      const failed = this.state.items.filter(item => item.status === 'error').length
      const saved = this.state.items.filter(item => item.artifact || item.artifacts?.length).length
      const skipped = this.state.items.filter(item => item.status === 'skipped').length
      const finalStatus = failed ? 'partial' : 'complete'
      let archivePath: string | undefined, cleanupNote = ''
      const allArtifacts = this.state.items.flatMap(item => item.artifacts?.map(a => a.file) || (item.artifact ? [item.artifact] : []))
      if (request.zip && allArtifacts.length) {
        this.update({ phase: 'archiving', message: 'Creating ZIP archive…', currentFile: undefined })
        this.ensureCurrent()
        const archiveWork = await mkdtemp(path.join(output, '.zip-'))
        const artifacts = allArtifacts
        try {
          const target = path.join(archiveWork, 'export.zip')
          await writeGroupZip(target, output, artifacts, { ...report(), status: finalStatus, packaging: 'zip' }, controller.signal)
          this.ensureCurrent()
          const published = await publishArtifact(target, profileFolder, this.state.name, 'zip', 'copy')
          archivePath = path.join(profileFolder, published)
          this.update({ archivePath, outputDirectory: profileFolder })
          // Only remove this operation's copies after the complete archive is published.
          // Existing files from earlier exports in the same folder are never included or deleted.
          const indexed = await register(catalogueCopies.map(c => ({ ...c, file: archivePath!, entry: path.basename(c.file) })), catalogueCopies.map(c => c.file))
          const ownReport = reportFile; reportFile = undefined
          try {
            if (indexed) for (const artifact of artifacts) await rm(path.join(output, artifact))
            if (indexed && ownReport) await rm(ownReport)
          } catch { cleanupNote = ' Some extra copies remain in the export folder.' }
        } finally {
          if (path.dirname(path.resolve(archiveWork)) === output && path.basename(archiveWork).startsWith('.zip-')) {
            try { await rm(archiveWork, { recursive: true, force: true }) } catch (error) {
              if (!archivePath) throw error
              cleanupNote = ' Some extra copies remain in the export folder.'
            }
          }
        }
        try { await rmdir(output) } catch { /* Keep folders containing earlier exports or recovery files. */ }
      }
      this.update({ status: finalStatus, phase: undefined, ...(archivePath ? { archivePath, outputDirectory: profileFolder } : {}), message: `Saved files for ${saved} applications${archivePath ? ' in one ZIP archive' : ''}.${skipped ? ` ${skipped} skipped: different APK type.` : ''}${failed ? ` ${failed} failed.` : ''}${!saved && skipped === apps.length ? ' No applications match the selected format.' : dataParts.length ? ' See component results for the saved contents. Apps stopped for copying remain stopped.' : ' APK files only; no app data or cache.'}${cleanupNote}` })
    } catch (error) {
      this.update({ status: controller.signal.aborted && !this.interruption ? 'cancelled' : 'error', phase: undefined, message: `${this.interruption || (error instanceof Error ? error.message : String(error))}${request.zip && !this.state.archivePath && this.state.items.some(item => item.artifacts?.length || item.artifact) ? ' Completed files are kept in the export folder; no complete ZIP was published.' : ''}`, items: this.state.items.map(item => item.status === 'pending' || item.status === 'running' ? { ...item, status: 'cancelled', message: this.interruption ? 'Not started: backup interrupted.' : 'Not started: backup cancelled.' } : item) })
    } finally {
      if (this.state.status === 'cancelled') this.update({ items: this.state.items.map(item => item.status === 'pending' ? { ...item, status: 'cancelled' } : item) })
      try { await saveReport() } catch (error) { this.update({ status: 'error', message: `Could not finish the backup report: ${error instanceof Error ? error.message : String(error)}` }) }
      if (catalogueWarning) this.update({ message: this.state.message + catalogueWarning })
      this.log(this.state.message, this.state.status === 'complete' ? 'success' : 'warning')
    }
  }
}
