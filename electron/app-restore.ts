import { prepareRestoreTrees } from './restore-tar.js'
import { prepareInstallSource } from './install-source.js'
import { restoreDataTrees, DataRestoreFailure } from './app-data-restore.js'
import { shellQuote, type DataPart, type DeviceShell } from './app-data-backup.js'
import { probeDeviceRoot } from './device-root.js'
import { checked } from './process.js'
import path from 'node:path'
import os from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdtemp, realpath, rm } from 'node:fs/promises'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { openRestoreZip } from './restore-zip.js'
import { readApkIdentity } from './apk-identity.js'
import { validateAppTarget } from './app-details-protocol.js'
import { backupParts, type BackupPart } from './app-backup-protocol.js'
import { canRetryRestore, restoreBusy, type RestoreState, type RestoreApplication, type RestoreBatchRequest, type RestoreBatchItem } from './app-restore-protocol.js'
import type { AppsSnapshot } from './apps-protocol.js'
import type { ConnectionSnapshot } from './contracts.js'
import { run, type Runner } from './process.js'

interface Digest { sha256: string; bytes: number }
interface Artifact extends Digest { file: string; component: BackupPart }
interface ReportItem extends RestoreApplication { dataSources?: { component: DataPart; roots: string[] }[]; dataApkSha256?: string[]; artifacts: Artifact[]; files: (Digest & { file: string })[]; archiveFormat?: 'apk' | 'apks' }
interface Report { userId: number; device: string; profile: string; createdAt: string; items: ReportItem[] }
export function validateRestoreBatch(value: RestoreBatchRequest) {
  if (!value || !Array.isArray(value.packages) || !value.packages.length || value.packages.length > 10000 || new Set(value.packages).size !== value.packages.length) throw new Error('Choose distinct applications from this backup.')
  value.packages.forEach(p => validateAppTarget(p, 0))
  if (!Array.isArray(value.components) || !value.components.length || value.components.length > 5 || new Set(value.components).size !== value.components.length || value.components.some(c => !backupParts.includes(c))) throw new Error('Choose valid restore components.')
}
const bounded = (v: unknown, max = 8192): v is string => typeof v === 'string' && v.length <= max && !/[\x00-\x1f]/.test(v)
function fileName(v: unknown): asserts v is string {
  if (!bounded(v, 255) || !v || /[<>:"/\\|?*]/.test(v) || /[. ]$/.test(v) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(v)) throw new Error('Invalid backup filename.')
}
function digest(value: unknown): Digest {
  const v = value as Digest
  if (!v || typeof v.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(v.sha256) || !Number.isSafeInteger(v.bytes) || v.bytes <= 0 || v.bytes > 64 * 1024 ** 3) throw new Error('Missing or invalid backup checksum.')
  return { sha256: v.sha256.toLowerCase(), bytes: v.bytes }
}
export function parseBackupReport(text: string): Report {
  if (Buffer.byteLength(text) > 8_000_000) throw new Error('Backup report exceeds 8 MB.')
  const v = JSON.parse(text.replace(/^\uFEFF/, ''))
  if (!v || !((v.format === 'adb-vault-apk-backup' && v.version === 2) || (v.format === 'adb-vault-app-backup' && v.version === 3))) throw new Error('Choose an ADB Vault backup manifest or ZIP. Presets and standalone APK/APKS files are not supported by this restore screen yet.')
  if (!bounded(v.device?.name, 512) || !bounded(v.profile?.name, 512) || !bounded(v.createdAt, 64) || !Number.isFinite(Date.parse(v.createdAt)) || !Array.isArray(v.items) || !v.items.length || v.items.length > 10000) throw new Error('Invalid backup metadata.')
  const packages = new Set<string>(), allFiles = new Set<string>()
  const items: ReportItem[] = v.items.map((item: Record<string, any>) => {
    validateAppTarget(item?.packageName, v.profile.id)
    if (!bounded(item.label) || packages.has(item.packageName)) throw new Error('Invalid or duplicate backup application.')
    packages.add(item.packageName)
    const raw = item.artifacts ?? (item.artifact && item.artifactIntegrity ? [{ component: 'apk', file: item.artifact, ...item.artifactIntegrity }] : [])
    if (!Array.isArray(raw) || raw.length > 5) throw new Error('Invalid backup components.')
    const components = new Set<BackupPart>()
    const artifacts: Artifact[] = raw.map((a: Artifact) => {
      fileName(a?.file)
      if (!backupParts.includes(a.component) || components.has(a.component) || allFiles.has(a.file.toLowerCase())) throw new Error('Duplicate or invalid backup component.')
      components.add(a.component); allFiles.add(a.file.toLowerCase())
      return { file: a.file, component: a.component, ...digest(a) }
    })
    const apk = artifacts.find(a => a.component === 'apk')
    let files: ReportItem['files'] = [], archiveFormat: ReportItem['archiveFormat']
    if (apk) {
      if (!['apk', 'apks'].includes(item.archiveFormat) || !apk.file.toLowerCase().endsWith('.' + item.archiveFormat) || !Array.isArray(item.files) || !item.files.length || item.files.length > 128) throw new Error('Incomplete APK backup metadata.')
      archiveFormat = item.archiveFormat
      const names = new Set<string>()
      files = item.files.map((f: { file: string }) => { fileName(f?.file); if (!f.file.endsWith('.apk') || names.has(f.file.toLowerCase())) throw new Error('Invalid or duplicate APK file.'); names.add(f.file.toLowerCase()); return { file: f.file, ...digest(f) } })
      if (archiveFormat === 'apk' && (files.length !== 1 || files[0].sha256 !== apk.sha256 || files[0].bytes !== apk.bytes) || archiveFormat === 'apks' && !names.has('base.apk') || files.reduce((n, f) => n + f.bytes, 0) > 8 * 1024 ** 3 || apk.bytes > 8 * 1024 ** 3) throw new Error('Invalid or oversized APK set (8 GiB maximum).')
    }
    if (artifacts.length && (!Number.isSafeInteger(item.sourceVersionCode) || item.sourceVersionCode < 0 || !(item.sourceVersionName === null || bounded(item.sourceVersionName)))) throw new Error('Missing backup version.')
    const dataSources = Array.isArray(item.dataSources) ? item.dataSources.filter((d: any) => d && ['data', 'cache', 'obb', 'media'].includes(d.component) && Array.isArray(d.roots) && d.roots.length <= 6 && d.roots.every((r: unknown) => bounded(r, 4096))).map((d: any) => ({ component: d.component, roots: d.roots })) : []
    const dataApkSha256 = Array.isArray(item.dataApkSha256) && item.dataApkSha256.length <= 128 && item.dataApkSha256.every((h: unknown) => typeof h === 'string' && /^[a-f0-9]{64}$/.test(h)) ? item.dataApkSha256 : files.map(f => f.sha256)
    return { dataSources, dataApkSha256, packageName: item.packageName, label: item.label, versionName: item.sourceVersionName ?? null, versionCode: item.sourceVersionCode ?? 0, components: [...components], installable: !!apk, artifacts, files, archiveFormat }
  })
  return { userId: v.profile.id, device: v.device.name, profile: `${v.profile.name} · ID ${v.profile.id}`, createdAt: v.createdAt, items }
}

async function consume(stream: Readable, expected: Digest, signal: AbortSignal, output?: string) {
  const hash = createHash('sha256'); let bytes = 0
  const meter = new Transform({ transform(chunk, _encoding, done) { bytes += chunk.length; if (bytes > expected.bytes) done(new Error('Backup size does not match its report.')); else { hash.update(chunk); done(null, output ? chunk : undefined) } } })
  if (output) await pipeline(stream, meter, createWriteStream(output, { flags: 'wx', mode: 0o600 }), { signal })
  else await pipeline(stream, meter, { signal })
  if (bytes !== expected.bytes || hash.digest('hex') !== expected.sha256) throw new Error('Backup checksum does not match. The copy is incomplete or has changed.')
}
async function localStream(file: string, signal: AbortSignal, parent?: string) {
  const info = await lstat(file)
  if (!info.isFile() || info.isSymbolicLink() || parent && path.dirname(await realpath(file)) !== await realpath(parent)) throw new Error('Backup must contain regular files in the manifest folder.')
  return createReadStream(file, { signal })
}
async function limitedText(file: string, signal: AbortSignal) {
  const stream = await localStream(file, signal), chunks: Buffer[] = []; let bytes = 0
  try { for await (const c of stream) { bytes += c.length; if (bytes > 8_000_000) throw new Error('Backup report exceeds 8 MB.'); chunks.push(c) } } finally { stream.destroy() }
  return Buffer.concat(chunks).toString('utf8')
}
export class AppRestoreService {
  state: RestoreState | null = null
  private source?: { file: string; zip: boolean; report: Report }
  private staged?: { archives: { component: DataPart; path: string; digest: Digest }[]; directory: string; files: { path: string; digest: Digest }[] }
  private target?: { serial: string; transportId?: string; hardwareId?: string }
  private controller?: AbortController
  private task?: Promise<void>
  private closing = false
  private installDirectory?: string
  constructor(private adb: () => string | null, private connection: () => ConnectionSnapshot, private apps: () => AppsSnapshot,
    private publish: (state: RestoreState) => void,
    private dialogs: { file: () => Promise<string | null>; installFiles?: () => Promise<string[] | null>; confirm: (state: RestoreState) => Promise<boolean> },
    private refresh: (id: string, userId: number, packageName: string) => Promise<void>, private runner: Runner = run) {}
  get busy() { return !!this.task || restoreBusy(this.state) }
  private update(patch: Partial<RestoreState>) { this.state = { ...this.state!, ...patch }; this.publish(this.state) }
  private current() {
    this.controller?.signal.throwIfAborted()
    const s = this.state!, c = this.connection(), a = this.apps(), d = c.devices.find(d => d.id === s.id && d.status === 'connected')
    if (this.closing || !d || c.activeDeviceId !== s.id || a.deviceId !== s.id || a.userId !== s.userId || a.status !== 'ready' || !a.profiles.some(p => p.id === s.userId) || (this.target && (d.serial !== this.target.serial || d.transportId !== this.target.transportId || d.hardwareId !== this.target.hardwareId))) throw new Error('Device or profile changed. Open the backup again for the intended target.')
    return d
  }
  contextChanged() {
    if (!this.state || ['success', 'error', 'partial', 'cancelled'].includes(this.state.status)) return
    try { this.current() } catch {
      if (this.busy) this.controller?.abort()
      else { this.update({ status: 'error', token: undefined, message: 'Device or profile changed. Open the backup again.' }); void this.cleanup() }
    }
  }
  cancel() {
    if (this.state?.batch && this.busy) { this.update({ batch: { ...this.state.batch, stopRequested: true } }); return }
    if (['opening', 'verifying'].includes(this.state?.status || '')) this.controller?.abort()
  }
  private async cleanup() {
    const staged = this.staged; this.staged = undefined
    if (staged) await rm(staged.directory, { recursive: true, force: true }) // Only our mkdtemp directory.
  }
  private async cleanupInstallSource() { const directory = this.installDirectory; this.installDirectory = undefined; if (directory) await rm(directory, { recursive: true, force: true }) }
  async shutdown() { this.closing = true; this.controller?.abort(); await this.task?.catch(() => {}); await this.cleanup(); await this.cleanupInstallSource() }
  private perform(work: (signal: AbortSignal) => Promise<void>) {
    if (this.busy || this.closing) throw new Error('Wait for the current restore operation.')
    const controller = new AbortController(); this.controller = controller
    const task = Promise.resolve().then(() => work(controller.signal)).catch(async error => {
      if (this.state?.operation === 'batch' && this.state.batch) {
        const items = this.state.batch.items.map(i => i.status === 'pending' ? { ...i, status: 'cancelled' as const, message: 'Not started. Queue stopped.' } : i.status === 'running' ? { ...i, status: 'partial' as const, uncertain: true } : i)
        this.update({ status: items.some(i => i.completed.length || i.uncertain) ? 'partial' : 'error', token: undefined, batch: { ...this.state.batch, items, finished: items.length, stopRequested: true }, message: error instanceof Error ? error.message : String(error) })
        await this.cleanup(); return
      }
      const installation = this.state?.status === 'installing'
      const restoring = this.state?.status === 'restoring'
      const uncertain = error instanceof DataRestoreFailure && error.mayHaveChanged
      this.update({ status: uncertain ? 'partial' : controller.signal.aborted && !installation && !restoring ? 'cancelled' : 'error', uncertain: installation || uncertain, token: undefined, recoveryPaths: error instanceof DataRestoreFailure ? error.recovery : undefined,
        message: installation ? `Installation was not confirmed. Android may have completed it; refresh applications before trying again. ${error instanceof Error ? error.message : String(error)}` : restoring ? (error instanceof Error ? error.message : String(error)) : controller.signal.aborted ? 'Verification cancelled. Nothing was installed.' : error instanceof Error ? error.message : String(error) })
      await this.cleanup()
    }).finally(() => { if (this.task === task) { this.task = undefined; this.controller = undefined } })
    this.task = task; return task
  }
  restoreBatch(request: RestoreBatchRequest) {
    validateRestoreBatch(request)
    if (!this.source || !this.state) throw new Error('Open a backup first.')
    const items = request.packages.map(packageName => {
      const item = this.source!.report.items.find(a => a.packageName === packageName)
      if (!item) throw new Error('Application is not in this backup.')
      return { packageName, label: item.label, versionCode: item.versionCode, components: request.components.filter(p => item.components.includes(p)), completed: [], status: 'pending', message: '' } as RestoreBatchItem
    })
    return this.runBatch(items)
  }
  retryBatch() {
    if (this.busy || !this.state?.batch) throw new Error('Wait for the current restore operation.')
    const items = this.state.batch.items.filter(canRetryRestore).map(i => ({ ...i, components: i.components.filter(p => !i.completed.includes(p)), completed: [], status: 'pending' as const, message: '', recoveryPaths: undefined }))
    if (!items.length) throw new Error('No safe unfinished operations to retry. Check uncertain results on the phone first.')
    return this.runBatch(items)
  }
  private runBatch(items: RestoreBatchItem[]) {
    return this.perform(async signal => {
      this.current()
      const source = this.source!
      if (items.some(i => i.components.some(p => p === 'data' || p === 'cache')) && !this.apps().options.root) throw new Error('Enable root operations for private data/cache restoration.')
      await this.cleanup()
      this.update({ operationId: randomUUID(), startedAt: new Date().toISOString(), status: 'confirming', operation: 'batch', token: undefined, packageName: undefined, uncertain: undefined, recoveryPaths: undefined,
        batch: { items, finished: 0, stopRequested: false }, message: 'Confirm the selected applications and saved components.' })
      const publish = () => this.update({ batch: { ...this.state!.batch!, items: items.map(i => ({ ...i, completed: [...i.completed] })), finished: items.filter(i => !['pending', 'running'].includes(i.status)).length } })
      if (!await this.dialogs.confirm(this.state!)) {
        items.forEach(i => { i.status = 'cancelled'; i.message = 'Cancelled before device access.' }); publish()
        this.update({ status: 'cancelled', message: 'Restoration cancelled. No applications were changed.' }); return
      }
      this.current(); this.update({ status: 'batch', message: this.state!.sourceKind === 'install' ? 'Starting installation…' : 'Starting restoration…' })
      for (const item of items) {
        if (this.state!.batch!.stopRequested || signal.aborted) break
        if (!item.components.length) { item.status = 'skipped'; item.message = 'None of the chosen components are saved for this application.'; publish(); continue }
        item.status = 'running'; publish()
        const child = new AppRestoreService(this.adb, () => { this.current(); return this.connection() }, this.apps,
          state => this.update({ status: 'batch', packageName: item.packageName, message: state.message }),
          { file: async () => source.file, confirm: async () => { this.current(); return true } }, this.refresh,
          async (...args) => { this.current(); const result = await this.runner(...args); this.current(); return result })
        const abort = () => { void child.shutdown() }; signal.addEventListener('abort', abort, { once: true })
        const requireState = (status: RestoreState['status']) => { if (child.state?.status !== status) throw new Error(child.state?.message || 'Restore step did not complete.') }
        try {
          this.current()
          await child.open(this.state!.id, this.state!.userId); requireState('choosing')
          const original = source.report.items.find(i => i.packageName === item.packageName), reopened = child.source?.report.items.find(i => i.packageName === item.packageName)
          if (child.source?.report.userId !== source.report.userId || JSON.stringify(original) !== JSON.stringify(reopened)) throw new Error('Backup metadata changed after confirmation. Open the copy again.')
          await child.prepare(item.packageName); requireState('ready')
          if (item.components.includes('apk')) {
            await child.install(child.state!.token!); requireState('success'); item.completed.push('apk'); publish()
          }
          const files = item.components.filter((p): p is DataPart => p !== 'apk')
          if (files.length) {
            if (item.completed.includes('apk')) { await child.prepare(item.packageName); requireState('ready') }
            await child.restoreFiles(child.state!.token!, files); requireState('success'); item.completed.push(...files)
          }
          item.status = 'success'; item.message = child.state!.message
        } catch (error) {
          item.status = item.completed.length || child.state?.status === 'partial' ? 'partial' : 'error'
          item.message = error instanceof Error ? error.message : String(error)
          item.uncertain = !!child.state?.uncertain || child.state?.status === 'partial'
          item.recoveryPaths = child.state?.recoveryPaths
          let contextValid = true; try { this.current() } catch { contextValid = false }
          if (!contextValid || item.uncertain || item.recoveryPaths?.length) this.update({ batch: { ...this.state!.batch!, stopRequested: true } })
        } finally { signal.removeEventListener('abort', abort); await child.shutdown(); publish() }
      }
      for (const item of items) if (item.status === 'pending') { item.status = 'cancelled'; item.message = 'Not started. Queue stopped.' }
      publish()
      const count = (status: RestoreBatchItem['status']) => items.filter(i => i.status === status).length
      const success = count('success'), failed = count('error') + count('partial'), stopped = count('cancelled')
      this.update({ status: failed ? 'partial' : stopped ? 'cancelled' : success ? 'success' : 'error', packageName: undefined,
        message: `${success} completed · ${failed} failed or partial · ${count('skipped')} skipped · ${stopped} not started. Completed applications are not rolled back when another application fails.` })
    })
  }
  open(id: string, userId: number, install = false, selectedFiles?: (signal: AbortSignal, progress: (message: string) => void) => ReturnType<typeof prepareInstallSource>) {
    if (this.busy) throw new Error('Wait for the current restore operation.')
    const d = this.connection().devices.find(d => d.id === id), p = this.apps().profiles.find(p => p.id === userId)
    this.state = { operationId: randomUUID(), startedAt: new Date().toISOString(), id, userId, sourceKind: install ? 'install' : undefined, deviceName: d?.name || id, profileName: p?.name || 'Profile', status: 'choosing', message: '', applications: [] }; this.target = undefined
    return this.perform(async signal => {
      const device = this.current(); this.target = { serial: device.serial, transportId: device.transportId, hardwareId: device.hardwareId }
      await this.cleanup(); await this.cleanupInstallSource(); this.source = undefined
      this.update({ status: 'opening', message: install ? 'Choose APK and APKS files.' : 'Choose a backup manifest or ZIP.' })
      let file: string | null
      if (install) {
        const files = selectedFiles ? undefined : await this.dialogs.installFiles?.(); signal.throwIfAborted(); this.current()
        if (!selectedFiles && !files?.length) { this.update({ status: 'cancelled', message: 'No installation files selected.' }); return }
        const progress = (message: string) => this.update({ message })
        const prepared = selectedFiles ? await selectedFiles(signal, progress) : await prepareInstallSource(files!, userId, signal, progress)
        this.installDirectory = prepared.directory; file = prepared.file
      } else file = await this.dialogs.file()
      signal.throwIfAborted()
      if (!file) { this.source = undefined; await this.cleanup(); this.update({ status: 'cancelled', message: 'No backup selected.' }); return }
      await this.cleanup(); this.source = undefined
      const zip = path.extname(file).toLowerCase() === '.zip'
      let text: string
      if (zip) { const archive = await openRestoreZip(file, signal); try { text = (await archive.buffer('manifest.json', 8_000_000)).toString('utf8') } finally { archive.close() } }
      else text = await limitedText(file, signal)
      const report = parseBackupReport(text); this.current()
      this.source = { file, zip, report }
      this.update({ status: 'choosing', source: file, sourceDevice: report.device, sourceProfile: report.profile, createdAt: report.createdAt,
        applications: report.items.map(({ artifacts: _a, files: _f, archiveFormat: _z, dataSources: _d, dataApkSha256: _h, ...item }) => item), message: 'Choose an application and verify its saved files.' })
    })
  }
  prepare(packageName: string) {
    if (!this.state || !this.source) throw new Error('Open a backup first.')
    return this.perform(async signal => {
      this.current()
      const source = this.source, item = source?.report.items.find(a => a.packageName === packageName)
      if (!source || !item || !item.artifacts.length) throw new Error('No saved files for this application.')
      this.update({ status: 'verifying', packageName, token: undefined, apkCount: undefined, verifiedComponents: undefined, operation: undefined, batch: undefined, uncertain: undefined, selectedParts: undefined, restoredParts: undefined, recoveryPaths: undefined, message: 'Checking saved files…' })
      await this.cleanup()
      const directory = await mkdtemp(path.join(os.tmpdir(), 'adb-vault-restore-'))
      this.staged = { directory, files: [], archives: [] }
      const archive = source.zip ? await openRestoreZip(source.file, signal) : undefined
      try {
        for (const artifact of item.artifacts) {
          this.update({ message: `Verifying ${artifact.file}…` })
          const input = archive ? await archive.stream(artifact.file, artifact.bytes) : await localStream(path.join(path.dirname(source.file), artifact.file), signal, path.dirname(source.file))
          const output = artifact.component === 'apk' ? path.join(directory, 'source.' + item.archiveFormat) : path.join(directory, artifact.component + '.tar')
          await consume(input, artifact, signal, output)
          if (artifact.component !== 'apk') this.staged.archives.push({ component: artifact.component, path: output, digest: artifact })
          if (artifact.component === 'apk' && item.archiveFormat === 'apk') this.staged.files.push({ path: output, digest: artifact })
          if (artifact.component === 'apk' && item.archiveFormat === 'apks') {
            const apks = await openRestoreZip(output, signal)
            try {
              const apkNames = apks.names.filter(n => n.toLowerCase().endsWith('.apk'))
              if (apkNames.length !== item.files.length || apkNames.some(n => !item.files.some(f => f.file === n))) throw new Error('APKS contents do not match the complete saved APK set.')
              for (const [i, file] of item.files.entries()) {
                const target = path.join(directory, `${i}.apk`)
                await consume(await apks.stream(file.file, file.bytes), file, signal, target)
                this.staged.files.push({ path: target, digest: file })
              }
            } finally { apks.close() }
          }
        }
      } finally { archive?.close() }
      const splits = new Set<string>()
      for (const file of this.staged.files) {
        const apk = await openRestoreZip(file.path, signal, 'apk')
        try {
          const identity = readApkIdentity(await apk.buffer('AndroidManifest.xml', 8_000_000))
          if (identity.packageName !== packageName || identity.versionCode !== item.versionCode || splits.has(identity.split)) throw new Error('APK identity or version does not match the backup report, or duplicate splits were found.')
          splits.add(identity.split)
          if (!identity.split) this.staged.files = [file, ...this.staged.files.filter(f => f !== file)]
        } finally { apk.close() }
      }
      if (this.staged.files.length && !splits.has('')) throw new Error('The base APK is missing.')
      this.current()
      this.update({ status: 'ready', token: randomUUID(), verifiedComponents: item.components, apkCount: this.staged.files.length,
        message: this.staged.files.length ? 'Saved files verified. APK identity and version match the report.' : 'Saved files verified. This copy has no APK. File restoration requires the matching application to be installed.' })
    })
  }
  restoreFiles(token: string, components: DataPart[]) {
    if (this.state?.status !== 'ready' || this.state.token !== token || !this.staged) throw new Error('Verify this copy before restoring files.')
    if (!components.length || new Set(components).size !== components.length || components.some(c => !['data', 'cache', 'obb', 'media'].includes(c))) throw new Error('Choose saved data components.')
    return this.perform(async signal => {
      this.current()
      const staged = this.staged!, item = this.source!.report.items.find(i => i.packageName === this.state!.packageName)!
      const app = this.apps().apps.find(a => a.packageName === item.packageName)
      if (!app || app.versionCode !== item.versionCode) throw new Error('Install the matching application version in this profile first.')
      if (components.some(c => !staged.archives.some(a => a.component === c))) throw new Error('Selected component is absent from this copy.')
      if (components.some(c => c === 'data' || c === 'cache') && !this.apps().options.root) throw new Error('Internal data and cache require root on the phone and root operations enabled in Settings > Apps.')
      this.update({ operationId: randomUUID(), startedAt: new Date().toISOString(), status: 'verifying', operation: 'files', selectedParts: components, restoredParts: undefined, recoveryPaths: undefined, message: 'Validating data archive paths and file types…' })
      const work = await mkdtemp(path.join(staged.directory, 'trees-')), trees = []
      try {
        for (const component of components) {
          const archive = staged.archives.find(a => a.component === component)!
          await consume(await localStream(archive.path, signal), archive.digest, signal)
          const sources = item.dataSources?.filter(d => d.component === component)
          if (sources?.length !== 1) throw new Error('This copy lacks unambiguous saved directory metadata. Create a new backup.')
          trees.push(...await prepareRestoreTrees(archive.path, item.packageName, this.source!.report.userId, this.state!.userId, component, sources[0].roots, work, signal))
        }
        if (!item.dataApkSha256?.length) throw new Error('This older data-only copy lacks APK identity evidence. Create a new backup before restoring files.')
        this.current()
        this.update({ status: 'confirming', message: 'Confirm replacement of the selected application files.' })
        if (!await this.dialogs.confirm(this.state!)) { this.current(); this.update({ status: 'ready', message: 'File restoration cancelled. Nothing was replaced.' }); return }
        const invoke = async (args: string[], timeout = 30000) => {
          const d = this.current(), adb = this.adb(); if (!adb) throw new Error('ADB is unavailable.')
          const result = await this.runner(adb, [...(d.transportId ? ['-t', d.transportId] : ['-s', d.serial]), ...args], timeout, undefined, undefined, { signal, maxOutputBytes: 2_000_000 })
          this.current(); return result
        }
        let method: 'su' | 'adb' | undefined
        if (this.apps().options.root) {
          const root = await probeDeviceRoot((command, timeout) => invoke(['shell', '-T', command], timeout), true)
          if (root.status === 'available') method = root.method
          else if (trees.some(t => t.private)) throw new Error(root.message)
        }
        if (trees.some(t => t.private) && !method) throw new Error('Root access on the phone is required for internal data/cache restoration.')
        const shell: DeviceShell = async (command, root = false) => checked(await invoke(['shell', '-T', root && method !== 'adb' ? `su -c ${shellQuote('set -e; ' + command)}` : 'set -e; ' + command], 1800000))
        this.update({ status: 'restoring', token: undefined, message: 'Checking the installed application and destination directories…' })
        const result = await restoreDataTrees(app, trees, item.dataApkSha256, !!method, shell, async (local, remote) => { checked(await invoke(['push', local, remote], 1800000)) }, message => this.update({ message }), signal)
        let warning = ''
        try { await this.refresh(this.state!.id, this.state!.userId, item.packageName) } catch { warning = ' Refresh applications to update the list.' }
        this.update({ status: 'success', restoredParts: result.restored, message: `Restored: ${result.restored.join(', ')}. The app remains stopped. Android Keystore keys and system-managed accounts are not included.${warning}${result.warnings.length ? ' ' + result.warnings.join(' ') : ''}` })
        await this.cleanup()
      } finally { await rm(work, { recursive: true, force: true }) }
    })
  }
  install(token: string) {
    if (this.state?.status !== 'ready' || this.state.token !== token || !this.staged?.files.length) throw new Error('Verify this copy before restoring it.')
    return this.perform(async signal => {
      this.current()
      this.update({ operationId: randomUUID(), startedAt: new Date().toISOString(), status: 'confirming', operation: 'apk', selectedParts: undefined, message: 'Confirm installation on the selected device.' })
      if (!await this.dialogs.confirm(this.state!)) { this.current(); this.update({ status: 'ready', message: 'Installation cancelled. The verified copy is still ready.' }); return }
      const device = this.current(), files = this.staged!.files, adb = this.adb()
      if (!adb) throw new Error('ADB is unavailable.')
      for (const file of files) await consume(await localStream(file.path, signal), file.digest, signal)
      this.current()
      this.update({ status: 'installing', token: undefined, message: `Installing ${this.state!.applications.find(a => a.packageName === this.state!.packageName)?.label || this.state!.packageName}…` })
      const result = await this.runner(adb, [...(device.transportId ? ['-t', device.transportId] : ['-s', device.serial]), files.length === 1 ? 'install' : 'install-multiple', '--user', String(this.state!.userId), '-r', ...files.map(f => f.path)], 300000, undefined, undefined, { signal, maxOutputBytes: 1_000_000 })
      if (/device.*(?:offline|not found)|no devices|connection.*(?:closed|reset|lost)|protocol fault|transport.*(?:error|closed)|closed|timed out/i.test(result.stdout + result.stderr)) throw new Error((result.stderr || result.stdout).slice(0, 1200))
      if (result.code !== 0 || /(?:Failure\s*\[|Error:|INSTALL_FAILED)/i.test(result.stdout + result.stderr) || !/^Success\s*$/m.test(result.stdout.replace(/\r/g, ''))) {
        this.update({ status: 'error', message: `Android did not confirm installation: ${(result.stderr || result.stdout || `exit ${result.code}`).slice(0, 1200)}. No uninstall or downgrade fallback was attempted.` }); await this.cleanup(); return
      }
      let warning = ''
      try { this.current(); await this.refresh(this.state!.id, this.state!.userId, this.state!.packageName!) } catch { warning = ' Refresh applications to update the list.' }
      this.update({ status: 'success', message: 'Application installed. Data, cache, OBB and media were not restored.' + warning })
      await this.cleanup()
    })
  }
}
