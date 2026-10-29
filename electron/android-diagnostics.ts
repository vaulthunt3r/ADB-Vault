import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import type { EventEmitter } from 'node:events'
import { mkdtemp, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { BackendEvent, ConnectionSnapshot, DeviceRecord } from './contracts.js'
import type { AndroidDiagnosticKind, AndroidDiagnosticsState, AndroidLogLine, DiagnosticTarget, LogBuffer } from './android-diagnostics-protocol.js'
import { parseBatteryUsage } from './battery-usage.js'
import { checked, run, type Runner } from './process.js'

export function parseLogcat(text: string): AndroidLogLine[] {
  const lines: AndroidLogLine[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || /^--------- beginning of/.test(line)) continue
    const m = line.match(/^(\d\d-\d\d\s+\d\d:\d\d:\d\d\.\d+)\s+(\d+)\s+(\d+)\s+([VDIWEFS])\s+([^:]*):\s?(.*)$/)
    lines.push(m ? { time: m[1], pid: m[2], tid: m[3], level: m[4], tag: m[5].trim(), message: m[6] } : { time: '', pid: '', tid: '', level: '', tag: '', message: line })
  }
  return lines.slice(-2000)
}

interface Zip extends EventEmitter { readEntry(): void; close(): void }
const yauzl = createRequire(import.meta.url)('yauzl') as { open(file: string, options: object, callback: (e: Error | null, zip: Zip) => void): void }
async function validateReport(file: string, signal: AbortSignal) {
  if (!(await stat(file)).size) throw new Error('Android returned an empty report.')
  const zip = await new Promise<Zip>((resolve, reject) => yauzl.open(file, { lazyEntries: true, autoClose: false, validateEntrySizes: true }, (e, z) => e ? reject(e) : resolve(z)))
  try {
    await new Promise<void>((resolve, reject) => {
      let found = false, count = 0
      const abort = () => reject(new Error('Operation cancelled.'))
      signal.addEventListener('abort', abort, { once: true })
      const cleanup = () => signal.removeEventListener('abort', abort)
      zip.once('error', error => { cleanup(); reject(error) })
      zip.once('end', () => { cleanup(); found ? resolve() : reject(new Error('The ZIP does not contain an Android bug report.')) })
      zip.on('entry', (entry: { fileName: string; uncompressedSize: number }) => {
        if (signal.aborted || ++count > 100000) { cleanup(); reject(new Error('Report verification stopped.')); return }
        if (/^bugreport[^/]*\.txt$/i.test(entry.fileName) && entry.uncompressedSize > 0) found = true
        zip.readEntry()
      })
      if (signal.aborted) { cleanup(); abort() } else zip.readEntry()
    })
  } finally { zip.close() }
}

export class AndroidDiagnosticsService {
  state: AndroidDiagnosticsState = { job: null, logcat: null, battery: null }
  private work?: Promise<void>
  private controller?: AbortController
  private captured?: DeviceRecord
  private executable?: string
  private interrupted = ''
  private closing = false
  get busy() { return !!this.work }
  constructor(private adb: () => string | null, private connection: () => ConnectionSnapshot,
    private emit: (event: BackendEvent) => void, private save: (name: string, extension: 'zip' | 'txt') => Promise<string | null>,
    private runner: Runner = run) {}
  private publish() { this.emit({ type: 'androidDiagnostics', state: { ...this.state, job: this.state.job ? { ...this.state.job } : null } }) }
  private target(target: DiagnosticTarget) {
    const state = this.connection(), d = state.devices.find(d => d.id === target.id)
    if (this.closing || !d || d.status !== 'connected' || state.busy) throw new Error('Connect the selected phone and wait for its current operation.')
    if (d.serial !== target.serial || d.transportId !== target.transportId) throw new Error('The phone connection changed. Reopen this action for the current connection.')
    return d
  }
  private assertCurrent() {
    const d = this.captured!, current = this.connection().devices.find(item => item.id === d.id)
    if (this.closing || this.adb() !== this.executable || !current || current.status !== 'connected' || current.serial !== d.serial || current.transportId !== d.transportId || current.hardwareId !== d.hardwareId) throw new Error('The phone connection changed. Collection stopped; no other phone was used.')
    if (this.controller?.signal.aborted) throw new Error(this.interrupted || 'Collection cancelled.')
  }
  contextChanged() { if (this.busy) { try { this.assertCurrent() } catch (error) { this.interrupted = (error as Error).message; this.controller?.abort() } } }
  start(kind: AndroidDiagnosticKind, target: DiagnosticTarget, buffer: LogBuffer = 'default') {
    if (this.busy) throw new Error('Finish or cancel the current Android diagnostic collection.')
    const device = { ...this.target(target) }, executable = this.adb()
    if (!executable) throw new Error('Install or locate ADB first.')
    this.captured = device; this.executable = executable; this.controller = new AbortController(); this.interrupted = ''
    this.state.job = { id: randomUUID(), kind, target: { ...target }, deviceName: device.name, status: 'running', startedAt: new Date().toISOString(), message: kind === 'bugreport' ? 'Choose where to save the report…' : kind === 'battery' ? 'Reading battery usage…' : 'Reading recent Android logs…' }
    this.work = Promise.resolve().then(() => this.collect(kind, target, buffer)).finally(() => { this.work = undefined; this.controller = undefined; this.publish() })
    this.publish()
  }
  private async collect(kind: AndroidDiagnosticKind, target: DiagnosticTarget, buffer: LogBuffer) {
    const job = this.state.job!, device = this.captured!, signal = this.controller!.signal
    const selector = target.transportId ? ['-t', target.transportId] : ['-s', target.serial]
    try {
      this.assertCurrent()
      if (kind === 'bugreport') await this.bugreport(selector, signal)
      else {
        const args = kind === 'logcat' ? ['logcat', '-d', '-t', '2000', '-v', 'threadtime', '-b', buffer, '*:V'] : ['shell', 'dumpsys', 'batterystats', '--charged', '--checkin']
        const result = await this.runner(this.executable!, [...selector, ...args], kind === 'battery' ? 60000 : 20000, undefined, undefined, { signal, maxOutputBytes: kind === 'battery' ? 12_000_000 : 2_000_000 })
        checked(result); this.assertCurrent()
        if (/Permission Denial|Permission denied|SecurityException|unknown option|not found/i.test(result.stderr)) throw new Error(result.stderr.slice(0, 1200))
        const capturedAt = new Date().toISOString()
        if (kind === 'logcat') this.state.logcat = { target: { ...target }, capturedAt, buffer, lines: parseLogcat(result.stdout), raw: result.stdout, limit: 2000 }
        else this.state.battery = { target: { ...target }, capturedAt, ...parseBatteryUsage(result.stdout) }
        job.message = kind === 'battery' ? 'Battery usage collected.' : 'Android logs collected.'
      }
      if (job.status === 'running') { job.status = 'success'; this.log(device, job.message, 'success') }
    } catch (error) {
      job.status = signal.aborted && !this.interrupted ? 'cancelled' : 'error'
      job.message = this.interrupted || (signal.aborted ? 'Collection cancelled.' : error instanceof Error ? error.message : String(error))
      if (kind === 'bugreport' && signal.aborted) job.message += ' Android may continue generating its report on the phone.'
      this.log(device, `${kind}: ${job.message}`, job.status === 'error' ? 'warning' : 'info')
    } finally { job.endedAt = new Date().toISOString() }
  }
  private async bugreport(selector: string[], signal: AbortSignal) {
    const job = this.state.job!, name = job.deviceName.replace(/[^\p{L}\p{N}_.-]/gu, '_').slice(0, 60) || 'phone'
    const destination = await this.save(`bugreport-${name}-${Date.now()}.zip`, 'zip')
    this.assertCurrent()
    if (!destination) { job.status = 'cancelled'; job.message = 'Report not started: no destination selected.'; return }
    if (path.extname(destination).toLowerCase() !== '.zip') throw new Error('Choose a ZIP file name.')
    const directory = await mkdtemp(path.join(path.dirname(destination), '.adb-vault-report-')), temporary = path.join(directory, 'report.zip')
    try {
      job.message = 'Android is generating and transferring the report. This can take several minutes; total progress is unavailable.'; this.publish()
      checked(await this.runner(this.executable!, [...selector, 'bugreport', temporary], 15 * 60_000, undefined, undefined, { signal, maxOutputBytes: 2_000_000 }))
      this.assertCurrent(); job.message = 'Checking the report archive…'; this.publish()
      await validateReport(temporary, signal); this.assertCurrent()
      await rename(temporary, destination)
      job.output = destination; job.message = `Bug report saved: ${destination}`
    } finally { await rm(temporary, { force: true }).catch(() => {}); await rmdir(directory).catch(() => {}) }
  }
  cancel(jobId: string) { if (this.state.job?.id === jobId && this.busy) { this.controller?.abort(); this.state.job.message = 'Stopping collection…'; this.publish() } }
  async exportLog(capturedAt: string) {
    const log = this.state.logcat
    if (!log || log.capturedAt !== capturedAt) throw new Error('The log snapshot changed. Open it again before saving.')
    const destination = await this.save(`android-logcat-${Date.now()}.txt`, 'txt')
    if (!destination) return
    if (path.extname(destination).toLowerCase() !== '.txt') throw new Error('Choose a TXT file name.')
    const temporary = path.join(path.dirname(destination), `.adb-vault-log-${randomUUID()}.tmp`)
    try { await writeFile(temporary, `Device: ${log.target.serial}\nCaptured: ${log.capturedAt}\nBuffer: ${log.buffer}\n\n${log.raw}`, { flag: 'wx', mode: 0o600 }); await rename(temporary, destination) }
    finally { await rm(temporary, { force: true }).catch(() => {}) }
  }
  reportPath(jobId: string) { const job = this.state.job; if (job?.id !== jobId || job.status !== 'success' || job.kind !== 'bugreport' || !job.output) throw new Error('No saved report for this operation.'); return job.output }
  async wait() { await this.work }
  async shutdown() { this.closing = true; this.controller?.abort(); await this.work }
  private log(device: DeviceRecord, text: string, tone: 'info' | 'success' | 'warning') { this.emit({ type: 'activity', source: 'connection', device: device.serial, text: `${device.name}: ${text}`, tone }) }
}
