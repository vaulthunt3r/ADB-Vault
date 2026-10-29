import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import { FilesService, validateFilePlan, validateLocation } from './files.js'
import { WindowsFileClipboard, type FileClipboardPort } from './file-clipboard-native.js'
import { fileTaskActive, type FileClipboardSelection, type FileEntry, type FileInstallSelection, type FileLocation } from './files-protocol.js'
import type { BackendEvent } from './contracts.js'

interface Captured extends FileClipboardSelection { sequence: number; marker?: string; expires: number }
export class FileClipboardService {
  private owned?: { marker: string; groups: FileClipboardSelection['groups']; mode: 'copy' | 'move'; preparationTaskId?: string; preparationError?: string }
  private captures = new Map<string, Captured>()
  private pending = new Set<Promise<unknown>>()
  private closing = false
  constructor(private files: FilesService, private emit: (e: BackendEvent) => void, private port: FileClipboardPort = new WindowsFileClipboard(), private cacheRoot = path.join(os.tmpdir(), 'adb-vault-clipboard')) {}
  warmup() { return this.port.start?.() || Promise.resolve() }
  private capture(groups: FileClipboardSelection['groups'], mode: 'copy' | 'move', sequence: number, marker?: string) {
    if (this.closing) throw new Error('Files is shutting down.')
    const entry = { token: randomUUID(), groups, mode, sequence, marker, expires: Date.now() + 5 * 60_000 }
    this.captures.set(entry.token, entry)
    while (this.captures.size > 12) this.captures.delete(this.captures.keys().next().value!)
    return this.public(entry)
  }
  private public(e: Captured): FileClipboardSelection { return { token: e.token, groups: structuredClone(e.groups), mode: e.mode, ...(e.marker && e.marker === this.owned?.marker ? { preparationTaskId: this.owned.preparationTaskId, preparationError: this.owned.preparationError } : {}) } }
  private assertOpen() { if (this.closing) throw new Error('Files is shutting down.') }
  private async selection(selection: FileInstallSelection) {
    this.assertOpen()
    validateFilePlan({ action: 'copy', source: selection.source, destination: selection.source, items: selection.items, conflict: 'ask', confirmed: true })
    const entries: FileEntry[] = []
    for (const item of selection.items) {
      const current = await this.files.io.stat({ ...selection.source, path: item.path })
      if (!['file', 'directory'].includes(current.kind) || current.fingerprint !== item.fingerprint) throw new Error('A selected object changed or is unavailable. Refresh and select it again.')
      entries.push(current)
    }
    return [{ source: structuredClone(selection.source), entries }]
  }
  async write(selection: FileInstallSelection, mode: 'copy' | 'move') {
    const groups = await this.selection(selection), marker = randomUUID()
    const paths = selection.source.kind === 'local' ? groups[0].entries.map(e => e.path) : []
    this.assertOpen()
    const previous = this.owned?.preparationTaskId
    if (previous && this.files.state.tasks.some(t => t.id === previous && fileTaskActive(t))) await this.files.control(previous, 'cancel')
    const sequence = await this.port.write(paths, mode, marker)
    this.owned = { marker, groups, mode }
    if (selection.source.kind === 'device' && mode === 'copy') {
      try { this.owned.preparationTaskId = await this.prepare(groups, marker, sequence) }
      catch (error) { this.owned.preparationError = error instanceof Error ? error.message : String(error) }
    }
    return this.capture(groups, mode, sequence, marker)
  }
  async read(): Promise<FileClipboardSelection | undefined> {
    this.assertOpen()
    const native = await this.port.read()
    if (native.marker && native.marker === this.owned?.marker) return this.capture(this.owned.groups, this.owned.mode, native.sequence, native.marker)
    this.owned = undefined
    if (!native.paths.length) return undefined
    const groups = new Map<string, FileClipboardSelection['groups'][number]>()
    const seen = new Set<string>()
    for (const name of native.paths) {
      const location = validateLocation({ kind: 'local', path: name }), key = path.normalize(name).toLowerCase()
      if (seen.has(key)) continue; seen.add(key)
      const parent = path.dirname(location.path)
      if (parent === location.path) throw new Error('Copy files or folders inside a drive, not the drive itself.')
      const entry = await this.files.io.stat(location)
      if (!['file', 'directory'].includes(entry.kind)) throw new Error('Clipboard links and special files are not supported: ' + name)
      const group = groups.get(parent.toLowerCase()) || { source: { kind: 'local' as const, path: parent }, entries: [] }
      group.entries.push(entry); groups.set(parent.toLowerCase(), group)
    }
    return this.capture([...groups.values()], native.mode, native.sequence)
  }
  async paste(token: string, destination: FileLocation) {
    const captured = this.captures.get(token)
    if (!captured || captured.expires < Date.now()) throw new Error('Clipboard selection expired. Paste again to read the current selection.')
    validateLocation(destination)
    this.assertOpen()
    const native = await this.port.read()
    const sameSelection = !!captured.marker && captured.marker === native.marker && captured.marker === this.owned?.marker
    if (native.sequence !== captured.sequence && !sameSelection) throw new Error('The clipboard changed. Paste again to review the new selection.')
    const owned = sameSelection ? this.owned : undefined
    if (owned?.preparationError) throw new Error('Copy preparation failed: ' + owned.preparationError + ' Copy the files again.')
    if (owned?.preparationTaskId) {
      const task = this.files.state.tasks.find(t => t.id === owned.preparationTaskId)
      throw new Error(task && fileTaskActive(task) ? 'Files are still being prepared. Follow progress or stop in Tasks.' : 'Copy preparation did not finish. Copy the files again.')
    }
    const plans = (owned?.groups || captured.groups).map(group => validateFilePlan({ action: captured.mode, source: group.source, destination, items: group.entries.map(e => ({ path: e.path, fingerprint: e.fingerprint })), conflict: 'ask', confirmed: true }))
    if (this.files.state.tasks.filter(t => ['queued', 'running', 'paused', 'conflict'].includes(t.status)).length + plans.length > 64) throw new Error('The file task queue is full.')
    // Validate every group before any job is submitted; enqueue itself is synchronous.
    for (const p of plans) this.files.validateEnqueue(p)
    const ids = plans.map(p => this.files.enqueue(p))
    this.captures.delete(token)
    // Consume a cut on submission, preventing duplicate moves. Retry remains in Tasks.
    // Conditional clearing cannot discard a newer clipboard copied in another application.
    if (captured.mode === 'move') {
      await this.port.clear(native.sequence).catch(() => {})
      this.owned = undefined
      for (const [key, e] of this.captures) if (e.sequence === captured.sequence) this.captures.delete(key)
    }
    return ids
  }
  private async prepare(groups: FileClipboardSelection['groups'], marker: string, sequence: number) {
    let directory: string | undefined
    try {
      await fs.mkdir(this.cacheRoot, { recursive: true })
      directory = await fs.mkdtemp(path.join(this.cacheRoot, 'copy-'))
      const plan = { action: 'copy' as const, source: groups[0].source, destination: { kind: 'local' as const, path: directory }, items: groups[0].entries.map(e => ({ path: e.path, fingerprint: e.fingerprint })), conflict: 'ask' as const, confirmed: true as const }
      const id = this.files.enqueue(plan), savedDirectory = directory
      this.emit({ type: 'notice', text: 'Preparing files for pasting… Follow progress or stop in Tasks.' })
      const work = this.files.waitForTask(id).then(async task => {
        if (task.status !== 'success' || task.items.some(i => i.status !== 'success' || !i.target)) return
        if (this.closing || this.owned?.marker !== marker) return
        const prepared = { source: plan.destination, entries: await Promise.all(task.items.map(i => this.files.io.stat({ kind: 'local', path: i.target! }))) }
        if (this.closing || this.owned?.marker !== marker) return
        // Same logical selection: an open Paste confirmation remains valid after
        // preparation, but user clipboard changes still fail the atomic check.
        await this.port.write(prepared.entries.map(e => e.path), 'copy', marker, sequence)
        if (this.owned?.marker === marker) this.owned = { marker, groups: [prepared], mode: 'copy' }
        this.emit({ type: 'activity', source: 'files', tone: 'success', text: 'Files are ready to paste in ADB Vault or File Explorer. Cached copies: ' + savedDirectory })
        this.emit({ type: 'notice', text: 'Files are ready. Paste in ADB Vault or File Explorer.' })
      }).catch(error => {
        this.emit({ type: 'activity', source: 'files', tone: 'warning', text: 'Files were prepared but the clipboard could not be updated. Cached copies: ' + savedDirectory + '\n' + (error instanceof Error ? error.message : String(error)) })
        this.emit({ type: 'notice', text: 'Prepared copies were kept. The clipboard changed or is unavailable; see Activity.' })
      })
      this.pending.add(work); void work.finally(() => this.pending.delete(work))
      return id
    } catch (error) {
      if (directory) await fs.rmdir(directory).catch(() => {})
      throw error
    }
  }
  async shutdown() { this.closing = true; await Promise.allSettled([...this.pending]); await this.port.shutdown?.() }
}
