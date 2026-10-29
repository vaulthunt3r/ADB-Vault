import { mkdir, open, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import type { BackupState } from './app-backup-protocol.js'
import type { ConnectionSnapshot } from './contracts.js'
import type { DiagnosticCommand, DiagnosticObservation, FailureDiagnostic, FailureDiagnosticReport } from './failure-diagnostics-protocol.js'
import { powershell, type Runner, type CommandError } from './process.js'

const now = () => new Date().toISOString()
const validId = (id: string) => /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)
export function diagnosticText(value: string, limit = 6000) {
  let text = value.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
  const home = process.env.USERPROFILE || process.env.HOME
  if (home) text = text.split(home).join('%USERPROFILE%')
  return text.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/((?:password|token|secret|private_key|public_key)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]').slice(-limit)
}
export function failureCause(message: string) {
  if (/no device with transport id|device (?:offline|disconnected|not found)|connection (?:reset|closed|lost|changed)|protocol fault|no devices\/emulators/i.test(message)) return 'ADB connection was lost or changed. The reason is not yet known.'
  if (/permission denied|access (?:is )?denied|not permitted/i.test(message)) return 'Access was denied. The affected file or command is listed below.'
  if (/no space left|disk full|ENOSPC/i.test(message)) return 'The destination has insufficient free space.'
  if (/timed out/i.test(message)) return 'The command did not finish within its time limit. The reason is not yet known.'
  return 'The cause is not yet known. See the recorded error and technical details.'
}
async function processObservation(): Promise<NonNullable<DiagnosticObservation['processes']>> {
  if (process.platform !== 'win32') throw new Error('ADB process observation is currently available on Windows only.')
  const raw = await powershell(`Get-CimInstance Win32_Process -Filter "Name='adb.exe'" | ForEach-Object { [pscustomobject]@{ pid=$_.ProcessId; parentPid=$_.ParentProcessId; startedAt=$_.CreationDate.ToUniversalTime().ToString('o'); server=[bool]($_.CommandLine -match '\\bfork-server\\b|\\bserver\\s+nodaemon\\b|\\bnodaemon\\s+server\\b') } } | ConvertTo-Json -Compress`, undefined, 5000)
  const parsed = raw ? JSON.parse(raw) : []
  return Array.isArray(parsed) ? parsed : [parsed]
}
async function logTail(file: string) {
  const handle = await open(file, 'r')
  try { const size = (await handle.stat()).size, buffer = Buffer.alloc(Math.min(size, 32768)); const { bytesRead } = await handle.read(buffer, 0, buffer.length, Math.max(0, size - buffer.length)); return diagnosticText(buffer.subarray(0, bytesRead).toString('utf8'), 32768) }
  finally { await handle.close() }
}
interface Session {
  state: BackupState; deviceName: string; profileName: string; commands: DiagnosticCommand[]; observations: DiagnosticObservation[]
  id: string; stage: string; packageName?: string; appLabel?: string; signature?: string; failed?: boolean
  sampling?: Promise<void>; writes: Promise<void>; timer?: ReturnType<typeof setInterval>; after?: ReturnType<typeof setTimeout>
  failureContext?: { stage: string; packageName?: string; appLabel?: string }; failedCommands: DiagnosticCommand[]; failedCount?: number
}
export class FailureDiagnosticsService {
  summaries: FailureDiagnostic[] = []
  private session?: Session
  private sessions = new Set<Session>()
  private directory: string
  private closing = false
  constructor(root: string, private connection: () => ConnectionSnapshot, private profile: (id: number) => string,
    private zstd: () => boolean, private publish: (summary: FailureDiagnostic) => void,
    private sampleProcesses = processObservation, private adbLogPath = path.join(os.tmpdir(), 'adb.log'), private appVersion = '0.1.0') {
    this.directory = path.join(root, 'failure-diagnostics')
  }
  async load() {
    await mkdir(this.directory, { recursive: true })
    const summaries: FailureDiagnostic[] = []
    for (const name of await readdir(this.directory)) {
      if (!name.endsWith('.json') || !validId(name.slice(0, -5))) continue
      try {
        const report = await this.read(name.slice(0, -5))
        summaries.push(report.summary.status === 'running' ? { ...report.summary, status: 'error', message: `${report.summary.message}\nThis report was saved during a backup. Its final outcome was not recorded.` } : report.summary)
      } catch { /* A damaged report must not prevent startup. */ }
    }
    this.summaries = summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50)
    await this.prune()
    for (const summary of this.summaries) this.publish(summary)
  }
  private async prune() {
    const keep = new Set(this.summaries.map(s => s.id + '.json'))
    for (const name of await readdir(this.directory)) if (name.endsWith('.json') && validId(name.slice(0, -5)) && !keep.has(name)) await rm(path.join(this.directory, name)).catch(() => {})
  }
  async read(id: string): Promise<FailureDiagnosticReport> {
    if (!validId(id)) throw new Error('Invalid diagnostic report ID.')
    const file = await open(path.join(this.directory, id + '.json'), 'r')
    try {
      if ((await file.stat()).size > 2_000_000) throw new Error('Diagnostic report exceeds the size limit.')
      const report = JSON.parse(await file.readFile('utf8')) as FailureDiagnosticReport
      if (report.format !== 'adb-vault-failure-diagnostic' || report.version !== 1 || report.summary?.id !== id || !Array.isArray(report.commands) || !Array.isArray(report.observations)) throw new Error('Invalid diagnostic report.')
      if (!['operationId', 'createdAt', 'updatedAt', 'title', 'deviceId', 'deviceName', 'profileName', 'message', 'cause', 'stage'].every(key => typeof (report.summary as unknown as Record<string, unknown>)[key] === 'string') || !['running', 'partial', 'error', 'cancelled'].includes(report.summary.status)) throw new Error('Invalid diagnostic summary.')
      return report
    } finally { await file.close() }
  }
  async export(id: string, target: string) {
    const report = await this.read(id)
    await writeFile(target, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
  }
  private observeConnection(session: Session) {
    const snapshot = this.connection(), device = snapshot.devices.find(d => d.id === session.state.id)
    return { activeDeviceId: snapshot.activeDeviceId, status: device?.status, serial: device?.serial, transportId: device?.transportId, method: device?.method }
  }
  private sample(session: Session) {
    if (session.sampling) return session.sampling
    const observation: DiagnosticObservation = { at: now(), connection: this.observeConnection(session) }
    session.observations.push(observation)
    if (session.observations.length > 80) session.observations.splice(1, 1) // Preserve the initial server observation.
    session.sampling = this.sampleProcesses().then(processes => { observation.processes = processes.slice(0, 32) }, error => { observation.processError = diagnosticText(String(error)) }).finally(() => { session.sampling = undefined })
    return session.sampling
  }
  connectionChanged() {
    const session = this.session
    if (!session || session.state.status !== 'running') return
    const connection = this.observeConnection(session), previous = session.observations.at(-1)?.connection
    if (JSON.stringify(connection) !== JSON.stringify(previous)) {
      session.observations.push({ at: now(), connection })
      if (session.observations.length > 80) session.observations.splice(1, 1)
    }
  }
  observe(state: BackupState) {
    if (!state.operationId || state.operation !== 'backup') return
    let session = this.session
    if (session?.state.operationId !== state.operationId) {
      if (session) { clearInterval(session.timer); const previous = session; void session.writes.then(() => { if (!previous.after) this.sessions.delete(previous) }) }
      session = { state, id: randomUUID(), deviceName: this.connection().devices.find(d => d.id === state.id)?.name || state.id,
        profileName: this.profile(state.userId), commands: [], failedCommands: [], observations: [], stage: state.message, writes: Promise.resolve() }
      this.session = session; this.sessions.add(session)
      void this.sample(session)
      const captured = session
      session.timer = setInterval(() => { void this.sample(captured) }, 15000); session.timer.unref()
    }
    session.state = state
    const running = state.items.find(item => item.status === 'running')
    if (running) { session.stage = state.message; session.packageName = running.packageName; session.appLabel = running.label }
    else if (state.status === 'running') session.stage = state.message
    const failed = state.items.filter(item => item.status === 'error')
    const signature = JSON.stringify([state.status, failed.map(item => [item.packageName, item.message])])
    if ((failed.length || state.status === 'error' || state.status === 'partial') && session.signature !== signature) {
      if (failed.length > (session.failedCount || 0) || !session.failureContext) session.failureContext = { stage: session.stage, packageName: session.packageName, appLabel: session.appLabel }
      session.failedCount = failed.length
      session.failed = true; session.signature = signature
      this.save(session)
    } else if (session.failed && state.status !== 'running') this.save(session)
    if (state.status !== 'running') {
      clearInterval(session.timer)
      if (session.failed) {
        clearTimeout(session.after)
        const captured = session
        session.after = setTimeout(() => { captured.after = undefined; void this.sample(captured).then(() => { if (!this.closing) this.save(captured); void captured.writes.then(() => { if (this.session !== captured) this.sessions.delete(captured) }) }) }, 2500)
        session.after.unref()
      } else this.sessions.delete(session)
    }
  }
  wrap(runner: Runner): Runner {
    return async (...args) => {
      const session = this.session
      if (!session || session.state.status !== 'running') return runner(...args)
      const entry: DiagnosticCommand = { startedAt: now(), executable: diagnosticText(args[0], 1024), args: args[1].slice(0, 24).map(arg => diagnosticText(arg, 2048)), stage: diagnosticText(session.stage, 2048), packageName: session.packageName }
      session.commands.push(entry); if (session.commands.length > 60) session.commands.shift()
      const start = performance.now()
      try {
        const result = await runner(...args)
        entry.code = result.code
        if (result.code !== 0) { entry.stdout = diagnosticText(result.stdout); entry.stderr = diagnosticText(result.stderr) }
        return result
      } catch (error) {
        entry.error = diagnosticText(error instanceof Error ? error.message : String(error))
        const output = (error as CommandError)?.commandResult
        if (output) { entry.code = output.code; entry.stdout = diagnosticText(output.stdout); entry.stderr = diagnosticText(output.stderr) }
        throw error
      }
      finally {
        entry.finishedAt = now(); entry.elapsedMs = Math.round(performance.now() - start)
        if (entry.error || entry.code !== 0) { session.failedCommands.push(entry); if (session.failedCommands.length > 20) session.failedCommands.shift() }
      }
    }
  }
  private save(session: Session) {
    // Snapshot immediately, before another application/operation can change the context.
    const state = structuredClone(session.state)
    const failures = state.items.filter(item => item.status === 'error').map(item => ({ packageName: item.packageName, label: item.label, message: diagnosticText(item.message || '') }))
    const summary: FailureDiagnostic = { id: session.id, operationId: state.operationId!, createdAt: state.startedAt || now(), updatedAt: now(), title: `Backup · ${state.total} applications`,
      deviceId: state.id, deviceName: session.deviceName, userId: state.userId, profileName: session.profileName, status: state.status === 'complete' ? 'partial' : state.status,
      message: diagnosticText(state.message), cause: failureCause([state.message, ...failures.map(item => item.message)].join('\n')), packageName: session.failureContext?.packageName || failures[0]?.packageName, appLabel: session.failureContext?.appLabel || failures[0]?.label,
      stage: diagnosticText(session.failureContext?.stage || session.stage), failed: failures.length, total: state.total, saved: false }
    const commands = structuredClone([...new Set([...session.failedCommands, ...session.commands])])
    const zstd = this.zstd()
    session.writes = session.writes.then(async () => {
      // Write an initial report before waiting for optional process/log observations.
      const report: FailureDiagnosticReport = { format: 'adb-vault-failure-diagnostic', version: 1, summary,
        environment: { platform: process.platform, arch: process.arch, electron: process.versions.electron, appVersion: this.appVersion, zstd }, commands,
        observations: structuredClone(session.observations), failures: failures.slice(0, 100), adbLog: { path: diagnosticText(this.adbLogPath, 1024) },
        notes: ['Collected automatically. No reconnect or ADB command is issued by diagnostics.', 'Successful command output, stdin and application data are not recorded.', 'Bounded report: last 60 commands plus up to 20 failed commands; initial and last 79 observations; first 100 failures; last 32 KiB of the ADB log. Command arguments and output are truncated.', 'Missing observations do not establish the cause. A server PID change alone does not explain why the previous process ended.'] }
      const persist = async () => {
        await mkdir(this.directory, { recursive: true })
        const target = path.join(this.directory, session.id + '.json'), temp = target + '.tmp'
        report.summary.saved = true; report.summary.updatedAt = now(); delete report.summary.saveError
        let serialized = JSON.stringify(report, null, 2) + '\n'
        if (Buffer.byteLength(serialized) > 1_800_000) report.notes.push('Older command/failure entries were omitted to keep the report below 2 MB.')
        while (Buffer.byteLength(serialized) > 1_800_000 && (report.commands.length || report.failures.length)) {
          if (report.commands.length) report.commands.shift(); else report.failures.pop()
          serialized = JSON.stringify(report, null, 2) + '\n'
        }
        await writeFile(temp, serialized, { mode: 0o600 }); await rename(temp, target)
        this.remember(report.summary)
      }
      let initialSaved = false
      try {
        await persist()
        initialSaved = true
        if (session.sampling) await session.sampling
        else if (Date.now() - Date.parse(session.observations.at(-1)?.at || '') > 5000) await this.sample(session)
        report.observations = structuredClone(session.observations)
        try { report.adbLog.tail = await logTail(this.adbLogPath) } catch (error) { report.adbLog.error = diagnosticText(String(error)) }
        await persist()
        await this.prune().catch(() => {})
      } catch (error) { this.remember({ ...summary, saved: initialSaved, saveError: diagnosticText(String(error)) }) }
    }).catch(() => {}) // Diagnostics must never fail or cancel the backup itself.
  }
  private remember(summary: FailureDiagnostic) {
    this.summaries = [summary, ...this.summaries.filter(s => s.id !== summary.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50)
    this.publish(structuredClone(summary))
  }
  async flush() { await Promise.all([...this.sessions].map(session => session.writes)) }
  async shutdown() {
    this.closing = true
    for (const session of this.sessions) { clearInterval(session.timer); clearTimeout(session.after) }
    await Promise.all([...this.sessions].map(session => session.sampling))
    await this.flush()
  }
}
