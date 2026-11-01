import * as fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { createRequire } from 'node:module'
import type { EventEmitter } from 'node:events'
import type { Readable } from 'node:stream'
import { FileIO, validateLocation } from './files.js'
import type { BackendEvent } from './contracts.js'
import type { FileEntry, FileLocation } from './files-protocol.js'
import { defaultSearchQuery, type FileIndexInfo, type FileSearchQuery, type FileSearchResult, type FileSearchState } from './file-search-protocol.js'
import { normalizeSearchFolders, searchFolderPolicy } from './file-search-folders.js'

const MAX_ENTRIES = 100_000, MAX_RESULTS = 2000, TEXT_LIMIT = 2 * 1024 ** 2, ARCHIVE_LIMIT = 64 * 1024 ** 2
const errorText = (e: unknown) => e instanceof Error ? e.message : String(e)
const quote = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'"
const api = (l: FileLocation) => l.kind === 'device' ? path.posix : path
const samePath = (l: FileLocation, a: string, b: string) => l.kind === 'local' && process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b

export function validateSearchQuery(value: unknown): FileSearchQuery {
  if (!value || typeof value !== 'object') throw new Error('Invalid search conditions.')
  const q = value as FileSearchQuery
  if (!['live', 'index'].includes(q.source) || !['contains', 'glob', 'regex'].includes(q.nameMode) || !['any', 'file', 'directory'].includes(q.kind)) throw new Error('Invalid search mode.')
  if (typeof q.name !== 'string' || q.name.length > 200 || typeof q.text !== 'string' || q.text.length > 1000) throw new Error('Search text is too long.')
  for (const v of [q.caseSensitive, q.recursive, q.archives]) if (typeof v !== 'boolean') throw new Error('Invalid search option.')
  for (const v of [q.minSize, q.maxSize, q.after, q.before]) if (v !== undefined && (!Number.isFinite(v) || v < 0 || v > Number.MAX_SAFE_INTEGER)) throw new Error('Enter valid positive size/date limits.')
  if (q.minSize !== undefined && q.maxSize !== undefined && q.minSize > q.maxSize || q.after !== undefined && q.before !== undefined && q.after > q.before) throw new Error('The minimum must not exceed the maximum.')
  if (q.source === 'index' && (q.text || q.archives)) throw new Error('The index contains names, sizes and dates. Use Scan folders for contents or archives.')
  return { ...structuredClone(q), ...(q.folders !== undefined ? { folders: normalizeSearchFolders(q.folders) } : {}) }
}

class Matcher {
  private worker: Worker
  private failure?: Error
  private pending?: (error: Error) => void
  private stopped = false
  private onAbort: () => void
  ready: Promise<void>
  constructor(q: FileSearchQuery, private signal: AbortSignal) {
    this.worker = new Worker(new URL('./file-search-matcher.js', import.meta.url), { workerData: q, resourceLimits: { maxOldGenerationSizeMb: 64 } })
    this.worker.on('error', e => { this.failure = e; this.pending?.(e) })
    this.worker.on('exit', () => { if (!this.stopped) { this.failure = new Error('Search matcher stopped unexpectedly.'); this.pending?.(this.failure) } })
    this.onAbort = () => this.close()
    signal.addEventListener('abort', this.onAbort, { once: true })
    this.ready = this.response<{ ready?: boolean; error?: string }>().then(r => { if (!r.ready) throw new Error('Invalid regular expression: ' + r.error) })
  }
  private response<T>(message?: unknown): Promise<T> {
    this.signal.throwIfAborted()
    if (this.failure) return Promise.reject(this.failure)
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); this.pending = undefined; this.worker.off('message', receive) }
      const fail = (e: Error) => { cleanup(); reject(e) }
      const receive = (r: T) => { cleanup(); resolve(r) }
      const timer = setTimeout(() => { this.failure = new Error('Search pattern took too long. Simplify the regular expression.'); fail(this.failure); this.close() }, 2000)
      this.pending = fail; this.worker.once('message', receive)
      if (message !== undefined) this.worker.postMessage(message)
    })
  }
  get broken() { return this.failure }
  entries(entries: FileEntry[]) { return this.response<boolean[]>({ entries }) }
  text(text: string) { return this.response<boolean>({ text }) }
  close() { if (this.stopped) return; this.stopped = true; this.signal.removeEventListener('abort', this.onAbort); this.pending?.(new Error('Search cancelled.')); void this.worker.terminate() }
}

interface ZipEntry { fileName: string; uncompressedSize: number; externalFileAttributes: number; generalPurposeBitFlag: number; getLastModDate(): Date }
interface Zip extends EventEmitter { readEntry(): void; close(): void; openReadStream(e: ZipEntry, cb: (error: Error | null, stream: Readable) => void): void }
const yauzl = createRequire(import.meta.url)('yauzl') as { open(p: string, opts: object, cb: (e: Error | null, zip: Zip) => void): void }

async function boundedRead(stream: Readable, limit: number, signal: AbortSignal) {
  if (signal.aborted) { stream.destroy(); signal.throwIfAborted() }
  const abort = () => stream.destroy(new Error('Search cancelled.'))
  signal.addEventListener('abort', abort, { once: true })
  try {
    const chunks: Buffer[] = []; let size = 0
    for await (const chunk of stream) { signal.throwIfAborted(); const b = Buffer.from(chunk); size += b.length; if (size > limit) throw new Error('File exceeds the search read limit.'); chunks.push(b) }
    return Buffer.concat(chunks)
  } finally { signal.removeEventListener('abort', abort); stream.destroy() }
}
function decodeText(b: Buffer): string | null {
  try {
    if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le', { fatal: true }).decode(b)
    if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be', { fatal: true }).decode(b)
    if (b.includes(0)) return null
    return new TextDecoder('utf-8', { fatal: true }).decode(b)
  } catch { return null }
}

interface IndexData { canonical: string; version: 1; info: FileIndexInfo; entries: FileEntry[] }
export class FileSearchService {
  state: FileSearchState = { revision: 0, id: '', status: 'idle', operation: 'search', location: { kind: 'local', path: '' }, query: defaultSearchQuery, scanned: 0, matched: 0, results: [], current: '', warnings: [], message: '' }
  private controller?: AbortController
  private job?: Promise<void>
  private lastPublish = 0
  private readBytes = 0
  constructor(private io: FileIO, private directory: string, private emit: (e: BackendEvent) => void, private deviceBusy: () => boolean = () => false) {}
  get busy() { return this.state.status === 'running' }
  get phoneBusy() { return this.busy && this.state.location.kind === 'device' && this.state.query.source === 'live' }
  private publish(force = false) { if (!force && Date.now() - this.lastPublish < 250) return; this.lastPublish = Date.now(); this.state.revision++; this.emit({ type: 'fileSearch', state: structuredClone(this.state) }) }
  private warning(s: string) { if (this.state.warnings.length < 20 && !this.state.warnings.includes(s)) this.state.warnings.push(s) }
  private result(r: FileSearchResult) { this.state.matched++; if (this.state.results.length < MAX_RESULTS) this.state.results.push(r); else this.warning(`Showing the first ${MAX_RESULTS.toLocaleString('en-US')} matches. Narrow the conditions to see the rest.`) }
  private indexPath(l: FileLocation) {
    validateLocation(l)
    const identity = JSON.stringify([l.kind, l.id, l.serial, !!l.root, l.kind === 'local' && process.platform === 'win32' ? l.path.toLowerCase() : l.path])
    return path.join(this.directory, createHash('sha256').update(identity).digest('hex') + '.json')
  }
  private async readIndex(l: FileLocation): Promise<IndexData | null> {
    const file = this.indexPath(l)
    try {
      if ((await fs.stat(file)).size > 48 * 1024 ** 2) throw new Error('Index is too large. Delete it and index a smaller folder.')
      const d = JSON.parse(await fs.readFile(file, 'utf8')) as IndexData
      if (d.version !== 1 || !d.info || !Array.isArray(d.entries) || d.entries.length > MAX_ENTRIES || d.entries.some(e => !e || typeof e.name !== 'string' || typeof e.path !== 'string' || typeof e.fingerprint !== 'string' || !Number.isFinite(e.size) || e.size < 0 || !Number.isFinite(e.modified) || !['file', 'directory', 'link', 'other'].includes(e.kind))) throw new Error('Index is invalid. Delete it and rebuild.')
      const root = d.info.location
      validateLocation({ ...l, path: d.canonical })
      if (this.indexPath(root) !== file) throw new Error('Index belongs to a different location.')
      for (const e of d.entries) { validateLocation({ ...l, path: e.path }); const relative = api(l).relative(d.canonical, e.path); if (!relative || relative === '..' || relative.startsWith('..' + api(l).sep) || api(l).isAbsolute(relative)) throw new Error('Index contains a path outside its folder.') }
      return d
    } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e }
  }
  async indexInfo(l: FileLocation) { return (await this.readIndex(l))?.info }
  async deleteIndex(l: FileLocation) { if (this.busy) throw new Error('Wait for the current search or index update.'); await fs.rm(this.indexPath(l), { force: true }) }
  start(location: FileLocation, query: FileSearchQuery, operation: 'search' | 'index' = 'search') {
    validateLocation(location); const q = validateSearchQuery(query)
    if (this.busy) throw new Error('Stop the current search before starting another.')
    if (location.kind === 'device' && q.source === 'live') { this.io.device(location); if (this.deviceBusy()) throw new Error('Wait for the current phone operation before scanning files.') }
    this.controller = new AbortController(); this.readBytes = 0
    this.state = { revision: this.state.revision, id: randomUUID(), status: 'running', operation, location: structuredClone(location), query: q, scanned: 0, matched: 0, results: [], current: location.path, message: operation === 'index' ? 'Updating folder index' : 'Searching files', warnings: [] }
    this.publish(true); this.job = this.run(this.controller.signal); return this.state.id
  }
  cancel(id: string) { if (id === this.state.id && this.busy) this.controller?.abort(new Error('Stopped by user.')) }
  connectionChanged() { if (this.phoneBusy) try { this.io.device(this.state.location) } catch (e) { this.controller?.abort(new Error(errorText(e))) } }
  async shutdown() { this.controller?.abort(new Error('Application closing.')); await this.job }
  private async *walk(location: FileLocation, recursive: boolean, signal: AbortSignal): AsyncGenerator<FileEntry[]> {
    const policy = searchFolderPolicy(this.state.query, location.kind === 'local' && process.platform === 'win32')
    const relative = (p: string) => api(location).relative(location.path, p).split(api(location).sep).join('/')
    const queue = policy.roots.map(p => ({ ...location, path: api(location).join(location.path, p) })), visited = new Set<string>(); let count = 0
    for (let i = 0; i < queue.length; i++) {
      signal.throwIfAborted(); const folder = queue[i]; this.state.current = folder.path
      // Kernel pseudo-files are not ordinary storage; reading them may block.
      if (folder.kind === 'device' && /^\/(proc|sys|dev)(\/|$)/.test(folder.path)) { this.warning('Android /proc, /sys and /dev are excluded.'); continue }
      let listing
      try { listing = await this.io.list(folder, signal, false) }
      catch (e) { signal.throwIfAborted(); if (i === 0 && !this.state.query.folders?.include.length) throw e; this.warning(folder.path + ': ' + errorText(e)); continue }
        if (!samePath(folder, listing.location.path, folder.path) || visited.has(listing.location.path)) { this.warning('Skipped a linked or changed folder: ' + folder.path); continue }
        visited.add(listing.location.path)
        if (listing.warning) this.warning(listing.warning)
        for (let n = 0; n < listing.entries.length; n += 128) {
          signal.throwIfAborted(); const batch = listing.entries.slice(n, n + 128); count += batch.length
          if (count > MAX_ENTRIES || this.state.scanned + batch.length > MAX_ENTRIES) throw new Error('The 100,000-object scan limit was reached. Choose a smaller folder.')
          this.state.scanned += batch.length
          const allowed = batch.filter(e => policy.allowed(relative(e.path), e.kind === 'directory'))
          if (recursive) for (const e of allowed) if (e.kind === 'directory') queue.push({ ...location, path: e.path })
          yield allowed; this.publish()
        }
    }
  }
  private async fileOnComputer(l: FileLocation, entry: FileEntry, limit: number, signal: AbortSignal, use: (p: string) => Promise<void>) {
    if (entry.kind !== 'file' || entry.size > limit) throw new Error(`Skipped files larger than ${limit / 1024 ** 2} MiB.`)
    if ((await this.io.stat(l, signal)).fingerprint !== entry.fingerprint) throw new Error('File changed during search: ' + l.path)
    if (l.kind === 'local') { await use(l.path); return }
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'adb-vault-search-'))
    try {
      const target = path.join(temp, 'read-only-copy')
      await this.io.command(l, `head -c ${limit + 1} -- ${quote(l.path)}`, signal, target, undefined, 30_000)
      if ((await fs.stat(target)).size > limit) throw new Error('File grew beyond the search read limit.')
      await use(target)
    } finally { await fs.rm(temp, { recursive: true, force: true }) }
  }
  private budget(bytes: number) { this.readBytes += bytes; if (this.readBytes > 256 * 1024 ** 2) throw new Error('The 256 MiB content-reading limit was reached. Narrow the search folder.') }
  private async textMatches(l: FileLocation, e: FileEntry, matcher: Matcher, signal: AbortSignal) {
    let found = false
    await this.fileOnComputer(l, e, TEXT_LIMIT, signal, async p => {
      const bytes = await boundedRead(createReadStream(p, { end: TEXT_LIMIT }), TEXT_LIMIT, signal); this.budget(bytes.length)
      const text = decodeText(bytes)
      if (text === null) this.warning('Binary files or unsupported text encodings were skipped. Text search supports UTF-8 and UTF-16 with BOM.')
      else found = await matcher.text(text)
    })
    return found
  }
  private async archive(l: FileLocation, file: FileEntry, matcher: Matcher, signal: AbortSignal) {
    if (file.size <= ARCHIVE_LIMIT) this.budget(file.size)
    await this.fileOnComputer(l, file, ARCHIVE_LIMIT, signal, async p => {
      const zip = await new Promise<Zip>((resolve, reject) => yauzl.open(p, { lazyEntries: true, autoClose: false, strictFileNames: true, validateEntrySizes: true }, (e, z) => e ? reject(e) : resolve(z)))
      let entries = 0, bytes = 0, error: Error | undefined
      const failure = (e: Error) => { error = e }; zip.on('error', failure)
      try {
        while (true) {
          signal.throwIfAborted(); if (error) throw error
          const e = await new Promise<ZipEntry | null>((resolve, reject) => {
            const cleanup = () => { zip.off('entry', next); zip.off('end', end); zip.off('error', fail); signal.removeEventListener('abort', abort) }
            const next = (v: ZipEntry) => { cleanup(); resolve(v) }, end = () => { cleanup(); resolve(null) }, fail = (err: Error) => { cleanup(); reject(err) }, abort = () => fail(new Error('Search cancelled.'))
            zip.once('entry', next); zip.once('end', end); zip.once('error', fail); signal.addEventListener('abort', abort, { once: true }); zip.readEntry()
          })
          if (!e) break
          if (++entries > 10000 || ++this.state.scanned > MAX_ENTRIES) throw new Error('Archive search entry limit reached.')
          const parts = e.fileName.replace(/\/$/, '').split('/'), mode = e.externalFileAttributes >>> 16 & 0xf000
          if (e.fileName.length > 1024 || /[\\:\x00-\x1f]/.test(e.fileName) || parts.some(p => !p || p === '.' || p === '..') || mode && mode !== 0x8000 && mode !== 0x4000 || e.generalPurposeBitFlag & 1) { this.warning('Encrypted or unsafe archive members were skipped: ' + file.name); continue }
          const entry: FileEntry = { name: parts.at(-1)!, path: file.path, kind: e.fileName.endsWith('/') ? 'directory' : 'file', size: e.uncompressedSize, modified: e.getLastModDate().getTime(), fingerprint: file.fingerprint }
          if (!(await matcher.entries([entry]))[0]) continue
          if (this.state.query.text) {
            if (entry.kind !== 'file' || e.uncompressedSize > TEXT_LIMIT) { this.warning('Archive text search skips members larger than 2 MiB.'); continue }
            if ((bytes += e.uncompressedSize) > 16 * 1024 ** 2) throw new Error('Archive text-reading limit of 16 MiB reached.')
            const stream = await new Promise<Readable>((resolve, reject) => zip.openReadStream(e, (err, s) => err ? reject(err) : resolve(s)))
            const buffer = await boundedRead(stream, TEXT_LIMIT, signal); this.budget(buffer.length); const text = decodeText(buffer)
            if (text === null) { this.warning('Binary or unsupported text encodings inside archives were skipped.'); continue }
            if (!await matcher.text(text)) continue
          }
          this.result({ entry, archive: file.path, member: e.fileName }); this.publish()
        }
      } finally { zip.close() }
    })
  }
  private async run(signal: AbortSignal) {
    // Metadata scans can legitimately take longer over Wi-Fi/SMB. Individual I/O,
    // matcher and object limits still apply, and the user can stop at any time.
    const timeout = this.state.query.text || this.state.query.archives ? setTimeout(() => this.controller?.abort(new Error('The content scan time limit was reached. Narrow the search folder.')), 5 * 60_000) : undefined
    const s = this.state
    let matcher: Matcher | undefined
    try {
      matcher = new Matcher(s.query, signal)
      await matcher.ready
      if (s.query.source === 'index') {
        const data = await this.readIndex(s.location); if (!data) throw new Error('No index for this folder. Build its index first.')
        s.index = data.info
        const policy = searchFolderPolicy(s.query, s.location.kind === 'local' && process.platform === 'win32')
        for (let n = 0; n < data.entries.length; n += 128) {
          signal.throwIfAborted(); const entries = data.entries.slice(n, n + 128).filter(e => (s.query.recursive || samePath(s.location, api(s.location).dirname(e.path), data.canonical)) && policy.allowed(api(s.location).relative(data.canonical, e.path).split(api(s.location).sep).join('/'), e.kind === 'directory'))
          const matches = await matcher.entries(entries); s.scanned += entries.length
          entries.forEach((entry, i) => { if (matches[i]) this.result({ entry }) }); this.publish()
        }
      } else {
        const requested = s.location, canonical = await this.io.canonical(requested, signal)
        s.canonicalLocation = canonical
        const indexed: FileEntry[] = []
        for await (const batch of this.walk(canonical, s.operation === 'index' || s.query.recursive, signal)) {
          if (s.operation === 'index') { indexed.push(...batch); continue }
          const matches = await matcher.entries(batch)
          for (let i = 0; i < batch.length; i++) {
            signal.throwIfAborted(); const entry = batch[i], location = { ...canonical, path: entry.path }; s.current = entry.path
            if (matches[i]) {
              if (!s.query.text) this.result({ entry })
              else if (entry.kind === 'file') try { if (await this.textMatches(location, entry, matcher, signal)) this.result({ entry }) } catch (e) { signal.throwIfAborted(); if (matcher.broken) throw matcher.broken; this.warning(errorText(e)); if (this.readBytes > 256 * 1024 ** 2) throw e }
            }
            if (s.query.archives && entry.kind === 'file' && /\.(zip|apks)$/i.test(entry.name)) try { await this.archive(location, entry, matcher, signal) } catch (e) { signal.throwIfAborted(); if (matcher.broken) throw matcher.broken; this.warning(entry.name + ': ' + errorText(e)); if (this.readBytes > 256 * 1024 ** 2 || s.scanned > MAX_ENTRIES) throw e }
            this.publish()
          }
        }
        if (s.operation === 'index') {
          if (s.warnings.length) throw new Error('The folder was not completely scanned. The previous index is unchanged; review skipped folders.')
          // Preserve the user-selected alias as the index key; store canonical paths
          // for results and containment validation separately.
          const info: FileIndexInfo = { updatedAt: new Date().toISOString(), count: indexed.length, location: requested }
          const content = JSON.stringify({ version: 1, info, entries: indexed, canonical: canonical.path })
          if (Buffer.byteLength(content) > 48 * 1024 ** 2) throw new Error('Index is too large. Choose a smaller folder.')
          await fs.mkdir(this.directory, { recursive: true }); const target = this.indexPath(requested), temp = target + '.' + randomUUID() + '.tmp'
          try { await fs.writeFile(temp, content, { flag: 'wx', signal }); signal.throwIfAborted(); await fs.rename(temp, target) } finally { await fs.rm(temp, { force: true }) }
          s.index = info
        }
      }
      signal.throwIfAborted(); s.status = 'complete'; s.message = s.operation === 'index' ? `Index updated · ${s.scanned} objects` : `${s.matched} ${s.matched === 1 ? 'match' : 'matches'}${s.warnings.length ? ' · Some items skipped' : ''}`
    } catch (e) { s.status = signal.aborted && ['Stopped by user.', 'Application closing.'].includes(errorText(signal.reason)) ? 'cancelled' : 'error'; s.message = signal.aborted ? errorText(signal.reason) : errorText(e) }
    finally { clearTimeout(timeout); matcher?.close(); s.current = ''; this.publish(true); this.emit({ type: 'activity', source: 'files', device: s.location.id, tone: s.status === 'error' || s.warnings.length ? 'warning' : 'info', text: `${s.operation === 'index' ? 'Folder index' : 'File search'} · ${s.location.path}: ${s.message}${s.warnings.length ? '\n' + s.warnings.join('\n') : ''}` }) }
  }
}
