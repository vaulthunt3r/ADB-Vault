import { mkdir, readFile, readdir, rename, open, unlink } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { BackendEvent, BackendSnapshot } from './contracts.js'
import { actionOperation, backupOperation, restoreOperation, identifyOperation, operationApplications, type ActivityApplication, type ActivityOperation } from './activity-operation.js'
import { fileTaskActive, fileActionLabel } from './files-protocol.js'
import { historyLimits, type ActivityItem, type HistoryOverview, type HistorySnapshot, type SavedSession } from './history-protocol.js'

const now = () => new Date().toISOString()
const validId = (id: string) => /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM' } }
const interruptedMessage = 'The session ended before a final result was saved. Check the result before retrying; completed changes were not rolled back.'

/** Previous sessions are read-only records, never inputs to the live operation queue. */
export function recoverSession(saved: SavedSession): SavedSession {
  const copy = structuredClone(saved)
  if (copy.session.status !== 'interrupted') return copy
  let id = Math.max(0, ...copy.activity.map(i => i.id))
  for (const item of copy.activity) if (item.operation?.status === 'running') {
    item.interrupted = true; item.tone = 'warning'; item.endedAt = undefined
    item.operation.status = 'interrupted'; item.operation.message += '\n' + interruptedMessage
    for (const result of item.operation.items) if (result.status === 'running') { result.status = 'interrupted'; result.uncertain = true }
  }
  for (const task of copy.tasks) {
    task.undoable = false
    if (!fileTaskActive(task)) continue
    task.previousStatus = task.status; task.status = 'interrupted'; task.stopRequested = false
    for (const item of task.items) if (item.status === 'running') { item.status = 'interrupted'; item.uncertain = true; item.message = [item.message, interruptedMessage].filter(Boolean).join('\n') }
    copy.activity.unshift({ id: ++id, sessionId: copy.session.id, time: task.createdAt, text: `${fileActionLabel[task.action]} · ${task.items.length} selected items · Interrupted`, source: 'files', tone: 'warning', interrupted: true,
      device: task.source.id || task.destination?.id, message: `${interruptedMessage}\nFrom: ${task.source.path}${task.destination ? '\nTo: ' + task.destination.path : ''}\nLast saved: ${task.completed} / ${task.items.length} selected items finished.${task.current ? '\nLast object: ' + task.current : ''}\nOpen Saved file tasks for individual results.` })
  }
  for (const pending of copy.pending) copy.activity.unshift({ id: ++id, sessionId: copy.session.id, time: pending.startedAt,
    text: pending.label, message: interruptedMessage, source: pending.source, device: pending.device, tone: 'warning', interrupted: true })
  copy.activity.sort((a, b) => b.time.localeCompare(a.time))
  copy.pending = []
  return copy
}

export class OperationHistory {
  private directory: string
  private data: SavedSession
  private sequence = 0
  private loaded?: Promise<void>
  private pendingWrite = Promise.resolve()
  private writing = false
  private timer?: ReturnType<typeof setTimeout>
  private publishTimer?: ReturnType<typeof setTimeout>
  private applications = new Map<string, Map<string, ActivityApplication>>()
  private dirty = false
  private closed = false
  private error?: string
  private sessions: SavedSession['session'][] = []
  private dismissed = new Set<string>()
  constructor(root: string, private changed: (overview: HistoryOverview) => void = () => {}) {
    this.directory = path.join(root, 'operation-history')
    const time = now()
    this.data = { version: 1, session: { id: randomUUID(), startedAt: time, updatedAt: time, status: 'open', pid: process.pid, activityCount: 0, taskCount: 0, unfinished: 0 }, activity: [], tasks: [], pending: [] }
  }
  initialize() { return this.loaded ??= this.load() }
  private async load() {
    try {
      await mkdir(this.directory, { recursive: true })
      await this.refresh()
      this.dirty = true; await this.flush()
    } catch (error) { this.failed(error) }
  }
  private failed(error: unknown) {
    this.error = `Operation history could not be saved or read: ${error instanceof Error ? error.message : String(error)}. Current operations remain available in this session.`
    this.changed(this.overview())
  }
  overview(): HistoryOverview { return { current: { ...this.data.session }, sessions: this.sessions.map(s => ({ ...s })), error: this.error } }
  snapshot(): HistorySnapshot { return { ...this.overview(), activity: this.data.activity } }
  private filename(id: string) { if (!validId(id)) throw new Error('Invalid history session.'); return path.join(this.directory, id + '.json') }
  private async readSaved(id: string) {
    const value = JSON.parse(await readFile(this.filename(id), 'utf8')) as SavedSession
    if (value.version !== 1 || value.session?.id !== id || !Array.isArray(value.activity) || !Array.isArray(value.tasks) || !Array.isArray(value.pending)
      || !['open', 'closed'].includes(value.session.status) || !Number.isInteger(value.session.pid) || value.session.pid < 1
      || !Number.isFinite(Date.parse(value.session.startedAt))) throw new Error('Unsupported or damaged history session.')
    if (value.session.status === 'open' && !alive(value.session.pid)) value.session.status = 'interrupted'
    return value
  }
  async refresh() {
    const files = (await readdir(this.directory)).filter(name => name.endsWith('.json') && validId(name.slice(0, -5)))
    const sessions: SavedSession['session'][] = []
    let damaged = 0
    for (const file of files) {
      if (file === this.data.session.id + '.json') continue
      try { sessions.push((await this.readSaved(file.slice(0, -5))).session) } catch { damaged++ }
    }
    sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    this.sessions = sessions.slice(0, historyLimits.sessions - 1)
    // Never remove a concurrently running instance's journal.
    for (const session of sessions.slice(historyLimits.sessions - 1)) {
      if (session.status === 'open') { this.sessions.push(session); continue }
      await unlink(this.filename(session.id)).catch(() => {})
    }
    if (damaged) this.error = `${damaged} damaged history file(s) could not be read. They have been kept on disk.`
    this.changed(this.overview())
  }
  async read(id: string) {
    await this.initialize()
    if (id === this.data.session.id) return structuredClone(this.data)
    return recoverSession(await this.readSaved(id))
  }
  private mark() {
    if (this.closed) return
    this.data.session.updatedAt = now()
    this.data.session.activityCount = this.data.activity.length
    this.data.session.taskCount = this.data.tasks.length
    this.data.session.unfinished = this.data.tasks.filter(fileTaskActive).length + this.data.activity.filter(a => a.operation?.status === 'running').length + this.data.pending.length
    this.dirty = true
    if (!this.timer) { this.timer = setTimeout(() => { this.timer = undefined; void this.flush() }, 150); this.timer.unref() }
  }
  private add(item: Omit<ActivityItem, 'id' | 'sessionId'>, key?: string) {
    if (key && this.dismissed.has(key)) return
    const index = key ? this.data.activity.findIndex(i => i.operation?.key === key || i.diagnostic?.operationId === key) : -1
    const previous = this.data.activity[index]
    if (previous && item.operation) item.operation = { ...item.operation, deviceName: previous.operation?.deviceName || item.operation.deviceName, profileName: previous.operation?.profileName || item.operation.profileName }
    if (previous && JSON.stringify(previous.operation) === JSON.stringify(item.operation) && JSON.stringify(previous.diagnostic) === JSON.stringify(item.diagnostic || previous.diagnostic)) return
    const entry = structuredClone({ ...previous, ...item, id: previous?.id ?? ++this.sequence, sessionId: this.data.session.id })
    if (index >= 0) this.data.activity[index] = entry; else this.data.activity.unshift(entry)
    while (this.data.activity.length > historyLimits.activity) {
      let n = this.data.activity.length - 1
      while (n >= 0 && this.data.activity[n].operation?.status === 'running') n--
      if (n < 0) break
      const [removed] = this.data.activity.splice(n, 1)
      if (removed.operation) this.dismissed.add(removed.operation.key)
      if (removed.diagnostic) this.dismissed.add(removed.diagnostic.operationId)
    }
    this.mark()
    // Progress updates must not serialize and send the full journal for every split.
    // Start, final results and newly failed apps remain immediate.
    const urgent = !previous || item.operation?.status !== 'running' || item.operation.items.some(i => ['error', 'partial'].includes(i.status) && !previous.operation?.items.some(p => p.packageName === i.packageName && p.status === i.status))
    if (urgent) this.publish()
    else if (!this.publishTimer) { this.publishTimer = setTimeout(() => this.publish(), 250); this.publishTimer.unref() }
  }
  private publish() {
    if (this.publishTimer) { clearTimeout(this.publishTimer); this.publishTimer = undefined }
    this.changed(this.snapshot())
  }
  private operation(op: ActivityOperation | null, apps?: BackendSnapshot['apps']) {
    if (!op) return
    const key = op.key
    const previous = this.data.activity.find(i => i.operation?.key === key)
    const identities = this.applications.get(op.key) || operationApplications(op, apps)
    if (op.status === 'running') this.applications.set(op.key, identities); else this.applications.delete(op.key)
    op = identifyOperation(op, identities, previous?.operation)
    this.add({ time: op.startedAt || now(), text: `${op.title} · ${op.items.length} applications`, source: 'apps',
      device: op.deviceId, deviceName: op.deviceName, operation: op, tone: op.status === 'running' ? 'info' : op.status === 'success' ? 'success' : 'warning',
      endedAt: op.status === 'running' ? undefined : previous?.endedAt || now() }, op.key)
  }
  capture(event: BackendEvent, context: Pick<BackendSnapshot, 'connection' | 'apps'>) {
    if (this.closed || event.type === 'history') return
    const device = (id: string) => context.connection?.devices.find(d => [d.id, d.serial, d.endpoint, ...(d.aliases || [])].includes(id))?.name || id
    const profile = (id: number) => context.apps?.profiles.find(p => p.id === id)?.name || `Profile ${id}`
    if (event.type === 'activity') this.add({ ...event, time: now(), source: event.source || 'system', deviceName: event.device ? device(event.device) : undefined })
    else if (event.type === 'appAction') this.operation(actionOperation(event.state, device(event.state.id), profile(event.state.userId)), context.apps)
    else if (event.type === 'backup') this.operation(backupOperation(event.state, device(event.state.id), profile(event.state.userId)), context.apps)
    else if (event.type === 'restore') this.operation(restoreOperation(event.state), context.apps)
    else if (event.type === 'failureDiagnostic') {
      const d = event.diagnostic, previous = this.data.activity.find(i => i.operation?.key === d.operationId)
      this.add({ ...(previous || { time: d.createdAt, text: d.title, tone: 'warning' as const, source: 'apps' as const, device: d.deviceId, deviceName: d.deviceName }), diagnostic: d }, d.operationId)
    } else if (event.type === 'files') {
      const active = event.state.tasks.filter(fileTaskActive)
      this.data.tasks = structuredClone([...active, ...event.state.tasks.filter(t => !fileTaskActive(t)).slice(-(historyLimits.tasks - active.length))].sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
      this.mark()
    }
  }
  startRequest(label: string, source: ActivityItem['source'], device?: string) {
    const id = randomUUID()
    this.data.pending.push({ id, label, source, device, startedAt: now() }); this.mark(); return id
  }
  finishRequest(id: string) { this.data.pending = this.data.pending.filter(p => p.id !== id); this.mark() }
  async clear() {
    if (this.data.activity.some(i => i.operation?.status === 'running')) throw new Error('Wait for running operations before clearing this session.')
    for (const item of this.data.activity) { if (item.operation) this.dismissed.add(item.operation.key); if (item.diagnostic) this.dismissed.add(item.diagnostic.operationId) }
    this.data.activity = []; this.applications.clear(); this.mark(); this.publish(); await this.flush()
  }
  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined }
    if (!this.dirty || this.writing) return this.pendingWrite
    this.writing = true
    this.pendingWrite = (async () => {
      try {
        // Slow disks keep just the newest pending state, not a queue of old JSON copies.
        do {
          this.dirty = false
          const json = JSON.stringify(this.data), file = this.filename(this.data.session.id)
          await mkdir(this.directory, { recursive: true })
          const handle = await open(file + '.tmp', 'w')
          try { await handle.writeFile(json, 'utf8'); await handle.sync() } finally { await handle.close() }
          await rename(file + '.tmp', file)
        } while (this.dirty)
      } catch (error) { this.dirty = true; this.failed(error) }
      finally { this.writing = false }
    })()
    return this.pendingWrite
  }
  async close(clean: boolean) {
    await this.initialize()
    this.data.session.status = clean ? 'closed' : 'open'
    if (clean) this.data.session.endedAt = now()
    this.mark(); this.closed = true; this.publish(); this.applications.clear(); await this.flush()
  }
}
