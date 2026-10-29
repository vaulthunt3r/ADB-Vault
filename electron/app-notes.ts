import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { appNotesFile, maxAppNotes, maxAppNotesBytes, parseAppNotes, validateAppNoteDraft, type AppNote, type AppNoteDraft, type AppNoteOrigin, type AppNotesState } from './app-notes-protocol.js'

export class AppNotes {
  state: AppNotesState = { status: 'loading', entries: [], error: null }
  private pending: Promise<unknown> = Promise.resolve()
  constructor(private root: string, private publish: (state: AppNotesState) => void) {}
  async load() {
    try {
      await mkdir(this.root, { recursive: true })
      const file = path.join(this.root, 'app-notes.json')
      const entries = await this.read(file).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error })
      this.state = { status: 'ready', entries, error: null }
    } catch (error) { this.state = { status: 'error', entries: [], error: `Could not read the personal database. The existing file has been kept: ${error instanceof Error ? error.message : String(error)}` } }
    this.publish(this.state)
  }
  private async read(file: string) {
    if ((await stat(file)).size > maxAppNotesBytes) throw new Error('Personal database exceeds 16 MiB.')
    const raw = await readFile(file, 'utf8')
    if (Buffer.byteLength(raw) > maxAppNotesBytes) throw new Error('Personal database exceeds 16 MiB.')
    return parseAppNotes(JSON.parse(raw))
  }
  private ready() { if (this.state.status !== 'ready') throw new Error(this.state.error || 'Personal database is still loading.') }
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const task = this.pending.catch(() => {}).then(work); this.pending = task; return task
  }
  private async write(file: string, entries: AppNote[]) {
    const json = JSON.stringify(appNotesFile(entries), null, 2)
    if (entries.length > maxAppNotes || Buffer.byteLength(json) > maxAppNotesBytes) throw new Error('Personal database limit reached (10,000 records / 16 MiB).')
    const temporary = `${file}.${randomUUID()}.tmp`
    try { await writeFile(temporary, json, { flag: 'wx' }); await rename(temporary, file) }
    finally { await unlink(temporary).catch(() => {}) }
  }
  private async commit(entries: AppNote[]) {
    await this.write(path.join(this.root, 'app-notes.json'), entries)
    this.state = { status: 'ready', entries, error: null }; this.publish(this.state)
  }
  save(draft: AppNoteDraft, origin: AppNoteOrigin | null) {
    validateAppNoteDraft(draft)
    return this.enqueue(async () => {
      this.ready()
      const previous = draft.id ? this.state.entries.find(note => note.id === draft.id) : undefined
      if (draft.id && (!previous || previous.packageName !== draft.packageName || previous.updatedAt !== draft.expectedUpdatedAt)) throw new Error('This record changed or was deleted. Reopen it before editing.')
      const updatedAt = new Date(Math.max(Date.now(), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString()
      const note: AppNote = { id: previous?.id || randomUUID(), packageName: draft.packageName, label: draft.label.trim(), text: draft.text.trim(), color: draft.color.toLowerCase(), createdAt: previous?.createdAt || updatedAt, updatedAt, origin: previous ? previous.origin : origin }
      await this.commit(previous ? this.state.entries.map(entry => entry.id === previous.id ? note : entry) : [...this.state.entries, note])
    })
  }
  delete(id: string, expectedUpdatedAt: string) {
    return this.enqueue(async () => {
      this.ready()
      const note = this.state.entries.find(entry => entry.id === id)
      if (!note || note.updatedAt !== expectedUpdatedAt) throw new Error('This record changed or was deleted. Reopen it before deleting.')
      await this.commit(this.state.entries.filter(entry => entry.id !== id))
    })
  }
  export(file: string) { return this.enqueue(async () => { this.ready(); await this.write(file, this.state.entries) }) }
  import(file: string) {
    return this.enqueue(async () => {
      this.ready()
      const imported = await this.read(file), entries = [...this.state.entries], ids = new Set(entries.map(note => note.id))
      const content = (note: AppNote) => JSON.stringify({ ...note, id: undefined })
      const contents = new Set(entries.map(content)); let added = 0
      for (const note of imported) {
        const key = content(note)
        if (contents.has(key)) continue
        entries.push({ ...note, id: ids.has(note.id) ? randomUUID() : note.id })
        ids.add(entries.at(-1)!.id); contents.add(key); added++
      }
      if (added) await this.commit(entries)
      return { added, skipped: imported.length - added }
    })
  }
  flush() { return this.pending.catch(() => {}) }
}
