import { createHash, randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { BackendEvent, ConnectionSnapshot, DeviceRecord } from './contracts.js'
import { checked, run, type Runner } from './process.js'
import {
  PHONE_RECORD_LIMIT, phoneDataLabels, phoneExportFormats, samePhoneTarget, validatePhoneToolsRequest,
  type PhoneDataKind, type PhoneDateRange, type PhoneExportFormat, type PhoneToolsRequest, type PhoneToolsState, type PhoneToolsTarget,
} from './phone-tools-protocol.js'
import { formatPhoneExport, parsePhoneToolsOutput } from './phone-tools-output.js'

const remoteDirectory = '/data/local/tmp/android-manager'
const remote = `${remoteDirectory}/manager-server.jar`

export class PhoneToolsService {
  state: PhoneToolsState = { revision: 0, job: null, data: null, clipboard: null }
  private work?: Promise<void>
  private controller?: AbortController
  private device?: DeviceRecord
  private executable?: string
  private interrupted = ''
  private closing = false
  get busy() { return !!this.work }
  get phoneBusy() { return this.busy && this.state.job?.action !== 'export' }
  constructor(private helperDirectory: string, private adb: () => string | null, private connection: () => ConnectionSnapshot,
    private emit: (event: BackendEvent) => void, private save: (name: string, extension: PhoneExportFormat) => Promise<string | null>,
    private runner: Runner = run) {}
  private publish() { this.state.revision++; this.emit({ type: 'phoneTools', state: structuredClone(this.state) }) }
  private target(target: PhoneToolsTarget) {
    const current = this.connection(), device = current.devices.find(d => d.id === target.id)
    if (!device || device.status !== 'connected' || current.busy) throw new Error('Connect the selected phone and wait for its current operation.')
    if (!samePhoneTarget(device, target)) throw new Error('This phone connection changed. Reopen the action for its current connection.')
    if (!this.adb()) throw new Error('Install or locate ADB in Components first.')
    return device
  }
  private assertCurrent() {
    if (this.closing || this.controller?.signal.aborted) throw new Error(this.interrupted || 'Operation cancelled.')
    if (this.state.job?.action === 'export') return
    const device = this.device!, current = this.connection().devices.find(d => d.id === device.id)
    if (!current || current.status !== 'connected' || !samePhoneTarget(current, device) || current.hardwareId !== device.hardwareId || this.adb() !== this.executable)
      throw new Error('The phone connection changed. The operation stopped without switching to another phone.')
  }
  contextChanged() {
    if (!this.phoneBusy) return
    try { this.assertCurrent() } catch (error) { this.interrupted = (error as Error).message; this.controller?.abort() }
  }
  private begin(kind: PhoneDataKind | 'clipboard', action: 'read' | 'write' | 'export', target: PhoneToolsTarget, name: string, task: () => Promise<void>) {
    if (this.closing) throw new Error('ADB Vault is closing.')
    if (this.busy) throw new Error('Finish or cancel the current clipboard or phone export operation.')
    this.controller = new AbortController(); this.interrupted = ''
    const label = kind === 'clipboard' ? 'clipboard' : phoneDataLabels[kind]
    this.state.job = { id: randomUUID(), kind, action, target: { ...target }, deviceName: name, status: 'running', startedAt: new Date().toISOString(),
      message: action === 'export' ? 'Choose where to save the export…' : action === 'write' ? 'Sending text to Android…' : `Reading ${label}…` }
    const job = this.state.job, signal = this.controller.signal
    this.work = Promise.resolve().then(task).then(() => {
      if (job.status !== 'running') return
      this.assertCurrent(); job.status = 'success'
      this.log(`${action === 'export' ? 'Exported' : action === 'write' ? 'Updated' : 'Read'} ${label}.`, 'success')
    }).catch(error => {
      if (action === 'read') { if (kind === 'clipboard') this.state.clipboard = null; else this.state.data = null }
      job.status = signal.aborted && !this.interrupted ? 'cancelled' : 'error'
      job.message = this.interrupted || (signal.aborted ? 'Operation cancelled.' : error instanceof Error ? error.message : String(error))
      // Never persist provider responses, clipboard text, contact names, numbers or message bodies.
      this.log(`${label}: ${job.status === 'cancelled' ? 'operation cancelled' : 'operation failed; see the open dialog for details'}.`, job.status === 'error' ? 'warning' : 'info')
    }).finally(() => {
      job.endedAt = new Date().toISOString()
      this.work = undefined; this.controller = undefined
      this.publish()
    })
    this.publish()
  }
  read(request: Extract<PhoneToolsRequest, { type: 'phoneTools.read' }>) {
    validatePhoneToolsRequest(request)
    if (this.busy) throw new Error('Finish or cancel the current phone operation.')
    this.device = { ...this.target(request.target) }; this.executable = this.adb()!
    this.state.data = null
    this.begin(request.kind, 'read', request.target, this.device.name, async () => {
      const userId = await this.prepare()
      const result = await this.collect(request.kind, userId, request.range)
      this.assertCurrent()
      this.state.data = { id: randomUUID(), kind: request.kind, target: { ...request.target }, deviceName: this.device!.name,
        userId, capturedAt: new Date().toISOString(), range: { ...request.range }, rows: result.rows }
      this.state.job!.message = `Read ${result.rows.length} ${phoneDataLabels[request.kind]} records for Android user ${userId}.`
    })
  }
  clipboard(request: Extract<PhoneToolsRequest, { type: 'phoneTools.clipboard.read' | 'phoneTools.clipboard.write' }>) {
    validatePhoneToolsRequest(request)
    if (this.busy) throw new Error('Finish or cancel the current phone operation.')
    this.device = { ...this.target(request.target) }; this.executable = this.adb()!
    const writing = request.type === 'phoneTools.clipboard.write'
    if (!writing) this.state.clipboard = null
    this.begin('clipboard', writing ? 'write' : 'read', request.target, this.device.name, async () => {
      const userId = await this.prepare()
      const result = await this.collect(writing ? 'clipboard-write' : 'clipboard-read', userId, {}, writing ? JSON.stringify({ text: request.text }) : undefined)
      this.assertCurrent()
      if (!writing) this.state.clipboard = { id: this.state.job!.id, target: { ...request.target }, userId, text: result.clipboard! }
      this.state.job!.message = writing ? 'Text copied to the Android clipboard. Paste it in an app on the phone.' : result.clipboard ? 'Android clipboard text received.' : 'The Android clipboard is empty.'
    })
  }
  export(request: Extract<PhoneToolsRequest, { type: 'phoneTools.export' }>) {
    validatePhoneToolsRequest(request)
    const snapshot = this.state.data
    if (!snapshot || snapshot.id !== request.snapshotId) throw new Error('The loaded data changed. Select records from the current snapshot.')
    if (!phoneExportFormats[snapshot.kind].includes(request.format)) throw new Error('This format is unavailable for the selected data.')
    const selected = request.ids === 'all' ? null : new Set(request.ids)
    const rows = snapshot.rows.filter(row => !selected || selected.has(row.id))
    if (!rows.length || selected && rows.length !== selected.size) throw new Error('Some selected records are no longer available. Refresh the selection.')
    this.begin(snapshot.kind, 'export', snapshot.target, snapshot.deviceName, async () => {
      const job = this.state.job!, name = snapshot.deviceName.replace(/[^\p{L}\p{N}_.-]/gu, '_').slice(0, 60) || 'phone'
      const destination = await this.save(`${snapshot.kind}-${name}-${new Date().toISOString().slice(0, 10)}.${request.format}`, request.format)
      this.assertCurrent()
      if (!destination) { job.status = 'cancelled'; job.message = 'Export cancelled: no destination selected.'; return }
      if (path.extname(destination).toLowerCase() !== `.${request.format}`) throw new Error(`Choose a .${request.format} file name.`)
      job.message = `Saving ${rows.length} records…`; this.publish()
      const temporary = path.join(path.dirname(destination), `.adb-vault-phone-${randomUUID()}.tmp`)
      try {
        const content = formatPhoneExport(snapshot, rows, request.format)
        await writeFile(temporary, content, { flag: 'wx', mode: 0o600, signal: this.controller!.signal })
        this.assertCurrent()
        await rename(temporary, destination)
        job.output = destination
        job.message = `${rows.length} records saved: ${destination}`
        // Rename is the commit point. A cancellation after this point cannot undo a saved export.
        job.status = 'success'
        this.log(`Exported ${rows.length} ${phoneDataLabels[snapshot.kind]} records as ${request.format.toUpperCase()}.`, 'success')
      } finally { await rm(temporary, { force: true }).catch(() => {}) }
    })
  }
  private async command(args: string[], timeout = 15000, input?: string, maxOutputBytes = 1000000, onStdout?: (chunk: string) => void) {
    this.assertCurrent()
    const device = this.device!, selector = device.transportId ? ['-t', device.transportId] : ['-s', device.serial]
    const result = await this.runner(this.executable!, [...selector, ...args], timeout, input, undefined, { signal: this.controller!.signal, maxOutputBytes, maxStderrBytes: 64000, onStdout })
    this.assertCurrent()
    return result
  }
  private async prepare() {
    this.assertCurrent()
    const manifest = JSON.parse(await readFile(path.join(this.helperDirectory, 'helper-manifest.json'), 'utf8'))
    const jar = path.join(this.helperDirectory, 'manager-server.jar')
    const digest = createHash('sha256').update(await readFile(jar)).digest('hex')
    if (manifest.protocolVersion !== 1 || manifest.helperVersion !== '0.1.0' || manifest.sha256 !== digest) throw new Error('Bundled Android helper failed verification.')
    const sdk = Number(checked(await this.command(['shell', 'getprop', 'ro.build.version.sdk'])))
    if (!Number.isInteger(sdk) || sdk < 26) throw new Error('These phone actions require Android 8.0 or newer.')
    const userText = checked(await this.command(['shell', 'am', 'get-current-user'])).trim()
    if (!/^\d{1,5}$/.test(userText)) throw new Error('Cannot determine the active Android user.')
    const userId = Number(userText)
    const hash = checked(await this.command(['shell', `if [ -f ${remote} ]; then sha256sum ${remote}; fi`]))
    if (hash.split(/\s+/)[0] !== digest) {
      this.state.job!.message = 'Preparing the Android helper…'; this.publish()
      checked(await this.command(['shell', `mkdir -p ${remoteDirectory} && rm -f ${remote}.new`]))
      checked(await this.command(['push', jar, `${remote}.new`], 30000))
      if (checked(await this.command(['shell', 'sha256sum', `${remote}.new`])).split(/\s+/)[0] !== digest) throw new Error('Android helper upload checksum mismatch.')
      checked(await this.command(['shell', `chmod 444 ${remote}.new && mv -f ${remote}.new ${remote}`]))
    }
    return userId
  }
  private async collect(operation: PhoneDataKind | 'clipboard-read' | 'clipboard-write', userId: number, range: PhoneDateRange, input?: string) {
    const job = this.state.job!
    job.message = operation.startsWith('clipboard-') ? operation === 'clipboard-read' ? 'Reading Android clipboard…' : 'Updating Android clipboard…' : `Reading ${phoneDataLabels[operation as PhoneDataKind]} for Android user ${userId}…`
    this.publish()
    // All command arguments are fixed tokens or validated integers. Clipboard content travels only over stdin.
    const argumentsText = `${operation} ${userId}${operation === 'calls' || operation === 'sms' ? ` ${range.from ?? 0} ${range.to ?? 4102444800000}` : ''}`
    let buffer = '', lastPublish = 0
    const progress = (chunk: string) => {
      buffer += chunk
      for (let newline; (newline = buffer.indexOf('\n')) >= 0;) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1)
        if (!line.includes('"type":"progress"')) continue
        try {
          const message = JSON.parse(line)
          if (message.type !== 'progress' || !Number.isInteger(message.completed) || message.completed < 0 || message.completed > PHONE_RECORD_LIMIT
            || !Number.isInteger(message.total) || message.total < message.completed || message.total > PHONE_RECORD_LIMIT) continue
          job.completed = message.completed; job.total = message.total
          if (Date.now() - lastPublish > 200 || message.completed === message.total) { lastPublish = Date.now(); this.publish() }
        } catch { /* Final parsing rejects an incomplete protocol response. */ }
      }
      if (buffer.length > 2000000) throw new Error('A phone record exceeds the supported size.')
    }
    const result = await this.command(['shell', '-T', `CLASSPATH=${remote} app_process / dev.adbvault.helper.PhoneTools ${argumentsText}`], 300000, input, 64_000_000, progress)
    let parsed
    try { parsed = parsePhoneToolsOutput(result.stdout, operation, userId) }
    catch (error) {
      if (result.code !== 0 && !result.stdout.includes('"type":"error"')) throw new Error('Android could not complete this action. Access may be restricted or the helper could not start.')
      throw error
    }
    if (result.code !== 0) throw new Error('Android helper exited before confirming success.')
    return parsed
  }
  cancel(jobId: string) {
    if (this.state.job?.id !== jobId || !this.busy || this.state.job.status !== 'running') return
    this.controller?.abort(); this.state.job.message = 'Stopping…'; this.publish()
  }
  clear() {
    if (this.busy) throw new Error('Finish or cancel the current phone operation.')
    this.state.data = null; this.state.clipboard = null; this.state.job = null; this.publish()
  }
  savedPath(jobId: string) {
    const job = this.state.job
    if (!job || job.id !== jobId || job.status !== 'success' || !job.output) throw new Error('No saved export is available for this operation.')
    return job.output
  }
  async wait() { await this.work }
  async shutdown() { this.closing = true; this.controller?.abort(); await this.work; this.state.data = null; this.state.clipboard = null }
  private log(text: string, tone: 'info' | 'success' | 'warning') {
    this.emit({ type: 'activity', source: 'connection', device: this.state.job!.target.serial, text: `${this.state.job!.deviceName}: ${text}`, tone })
  }
}
