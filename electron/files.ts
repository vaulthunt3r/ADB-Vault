import * as fs from 'node:fs/promises'
import { createReadStream, createWriteStream, constants } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import path from 'node:path'
import os from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { checked, powershell, run, type Runner, type CommandResult } from './process.js'
import { isNetworkPath, networkPath, fileParentPath } from './file-locations.js'
import { parseFileStorages, profileFileStorages } from './file-storage.js'
import { parseAndroidProfiles } from './app-profiles.js'
import { archiveStreamCommand, finalizeArchiveStream } from './app-data-backup.js'
import type { BackendEvent, ConnectionSnapshot } from './contracts.js'
import { fileTaskActive, fileActionLabel, filePattern, nameProblem, type FileEntry, type FileLocation, type FileListing, type FilePlan, type FileTask, type FilesState } from './files-protocol.js'

const quote = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'"
const message = (e: unknown) => e instanceof Error ? e.message : String(e)
const missing = (e: unknown) => (e as NodeJS.ErrnoException)?.code === 'ENOENT' || /No such file or directory/.test(message(e))
const api = (l: FileLocation) => l.kind === 'device' ? path.posix : path
const sameHost = (a: FileLocation, b: FileLocation) => a.kind === b.kind && (a.kind === 'local' || a.id === b.id)
const key = (l: FileLocation) => l.kind === 'local' && process.platform === 'win32' ? path.normalize(l.path).toLowerCase() : api(l).normalize(l.path)
const inside = (child: FileLocation, parent: FileLocation) => sameHost(child, parent) && (key(child) === key(parent) || key(child).startsWith(key(parent).replace(/[\\/]+$/, '') + api(parent).sep))
const at = (l: FileLocation, p: string): FileLocation => ({ ...l, path: p })
const child = (l: FileLocation, name: string) => at(l, api(l).join(l.path, name))

export function validateLocation(input: unknown, empty = false): FileLocation {
  const l = input as FileLocation
  if (!l || !['local', 'device'].includes(l.kind) || typeof l.path !== 'string' || l.path.length > 4096 || /[\x00-\x1f]/.test(l.path)) throw new Error('Invalid file location.')
  if (l.path === '' && empty && l.kind === 'local') return l
  if (l.kind === 'local') {
    if (isNetworkPath(l.path) && process.platform === 'win32') networkPath(l.path)
    else if (!path.isAbsolute(l.path) || /^[/\\]{2}/.test(l.path) || (process.platform === 'win32' && (!/^[a-z]:[/\\]/i.test(l.path) || /[:]/.test(l.path.slice(2))))) throw new Error('Choose an absolute drive path or a Windows network folder (\\\\server\\share).')
  } else {
    if (!l.path.startsWith('/') || l.path.includes('\\') || !l.id || !l.serial || /[\x00-\x20]/.test(l.serial) || (l.transportId !== undefined && !/^\d+$/.test(l.transportId)) || (l.root !== undefined && typeof l.root !== 'boolean')) throw new Error('Invalid phone file location.')
  }
  if (l.path.split(/[\\/]/).some(segment => segment === '.' || segment === '..')) throw new Error('Use a normalized path without . or .. segments.')
  return l
}
export function validateFilePlan(input: unknown): FilePlan {
  const p = input as FilePlan
  if (!p || !['copy', 'move', 'delete', 'rename', 'mkdir', 'create', 'chmod'].includes(p.action) || p.confirmed !== true || !['ask', 'skip', 'keep-both', 'replace', 'merge'].includes(p.conflict)) throw new Error('Invalid or unconfirmed file operation.')
  validateLocation(p.source)
  if (p.destination) validateLocation(p.destination)
  if (['copy', 'move'].includes(p.action) && !p.destination) throw new Error('Choose a destination folder.')
  if (!Array.isArray(p.items) || !p.items.length || p.items.length > 10000) throw new Error('Select between 1 and 10,000 objects.')
  const paths = new Set<string>(), names = new Set<string>()
  for (const i of p.items) {
    validateLocation(at(p.source, i.path))
    if (!inside(at(p.source, i.path), p.source) || typeof i.fingerprint !== 'string' || i.fingerprint.length > 1000) throw new Error('Selection is outside its source folder.')
    if (!['mkdir', 'create'].includes(p.action) && !i.fingerprint) throw new Error('Properties of this object are unavailable. Check access, then refresh the folder before changing or copying it.')
    if (i.name !== undefined && nameProblem(i.name, p.source.kind === 'local' && process.platform === 'win32')) throw new Error(nameProblem(i.name, true)!)
    if (['rename', 'mkdir', 'create'].includes(p.action) && !i.name) throw new Error('Enter a name.')
    const pk = key(at(p.source, i.path)), nk = key(at(p.source, api(p.source).join(api(p.source).dirname(i.path), i.name || '')))
    if (paths.has(pk)) throw new Error('Duplicate selected path.')
    if (p.action === 'rename' && names.has(nk)) throw new Error('More than one object would have the same name.')
    paths.add(pk); names.add(nk)
    if (!['mkdir', 'create'].includes(p.action) && key(at(p.source, i.path)) === key(p.source)) throw new Error('Select objects inside the folder, not the source folder itself.')
  }
  if (p.action === 'chmod' && (p.source.kind !== 'device' || !/^[0-7]{3}$/.test(p.mode || ''))) throw new Error('Enter three octal permission digits for a phone object.')
  return p
}

/** All device commands share the existing lifecycle runner. No server restart, scan, or reconnect. */
export class FileIO {
  private deviceChains = new Map<string, Promise<unknown>>()
  constructor(private adb: () => string | null, private connection: () => ConnectionSnapshot, private runner: Runner = run) {}
  device(l: FileLocation) {
    const d = this.connection().devices.find(d => d.id === l.id)
    if (!d || !['connected', 'recovery'].includes(d.status) || d.serial !== l.serial || d.transportId !== l.transportId) throw new Error('The phone connection changed. Select its source again; this operation was not redirected.')
    if (l.root && d.root?.status !== 'available') throw new Error('Root access for Shell is required. Check access in Connection first.')
    if (!this.adb()) throw new Error('ADB is unavailable. Check Components.')
    return d
  }
  private async adbRun(l: FileLocation, args: string[], options: { signal?: AbortSignal; stdoutFile?: string; onStdoutBytes?: (bytes: number) => void; onStdout?: (text: string) => void; timeout?: number } = {}) {
    const task = async () => {
      const d = this.device(l)
      return this.runner(this.adb()!, [...(d.transportId ? ['-t', d.transportId] : ['-s', d.serial]), ...args], options.timeout ?? 30 * 60_000, undefined, undefined, { ...options, maxOutputBytes: 32_000_000 })
    }
    const previous = this.deviceChains.get(l.id!) || Promise.resolve()
    const next = previous.catch(() => {}).then(task); this.deviceChains.set(l.id!, next)
    try { return await next } finally { if (this.deviceChains.get(l.id!) === next) this.deviceChains.delete(l.id!) }
  }
  async command(l: FileLocation, command: string, signal?: AbortSignal, stdoutFile?: string, onStdoutBytes?: (bytes: number) => void, timeout?: number) {
    return checked(await this.commandResult(l, command, signal, stdoutFile, onStdoutBytes, timeout))
  }
  private async commandResult(l: FileLocation, command: string, signal?: AbortSignal, stdoutFile?: string, onStdoutBytes?: (bytes: number) => void, timeout?: number) {
    const d = this.device(l), script = l.root && d.root?.method !== 'adb' ? 'su -c ' + quote(command) : command
    if (stdoutFile) {
      const token = randomUUID()
      const result = await this.adbRun(l, ['exec-out', archiveStreamCommand(script, token)], { signal, stdoutFile, onStdoutBytes, timeout: timeout ?? 30 * 60_000 })
      checked(result)
      await finalizeArchiveStream(stdoutFile, token)
      if (result.stderr.trim()) throw new Error('File transfer was not complete: ' + result.stderr.slice(0, 1000))
      return result
    }
    return this.adbRun(l, ['shell', '-T', script], { signal, stdoutFile, onStdoutBytes, timeout: timeout ?? (stdoutFile ? 30 * 60_000 : 30000) })
  }
  async canonical(l: FileLocation, signal?: AbortSignal): Promise<FileLocation> {
    validateLocation(l)
    const resolved = l.kind === 'local' ? await fs.realpath(l.path) : (await this.command(l, 'readlink -f -- ' + quote(l.path) + ' && test -e ' + quote(l.path), signal)).trim()
    return at(l, resolved)
  }
  private decode(raw: string): FileEntry[] {
    const records = raw.split('\0'); if (records.at(-1) === '') records.pop()
    const out: FileEntry[] = []
    for (const record of records) {
      // Android stat can end its metadata line with CRLF. CR is framing, not
      // part of %y/the fingerprint. Do not trim the separately framed filename.
      const newline = record.indexOf('\n'), fields = record.slice(0, newline).replace(/\r$/, '').split('\t'), full = record.slice(newline + 1)
      if (newline < 0 || ![8, 9].includes(fields.length)) throw new Error('This Android version did not return supported file metadata.')
      const [hex, size, time, uid, gid, ino, ctime, rawPreciseTime, access] = fields, mode = parseInt(hex, 16), type = mode & 0xf000
      const preciseTime = rawPreciseTime.replace(/\r$/, '')
      if (access !== undefined && access !== '' && access !== 'restricted') throw new Error('Invalid file access metadata received from Android.')
      if (!Number.isFinite(mode) || !Number.isFinite(Number(size)) || !full.startsWith('/')) throw new Error('Invalid file metadata received from Android.')
      out.push({ name: path.posix.basename(full), path: full, kind: type === 0x4000 ? 'directory' : type === 0x8000 ? 'file' : type === 0xa000 ? 'link' : 'other', size: Number(size), modified: Number(time) * 1000, mode: (mode & 0o7777).toString(8), uid, gid, fingerprint: [hex, size, ino, ctime, preciseTime].join(':'), ...(access === 'restricted' ? { access } : {}) })
    }
    return out
  }
  private format = quote('%f\t%s\t%Y\t%u\t%g\t%i\t%Z\t%y')
  private statScript = () => `for f do stat -c ${this.format} -- "$f" || exit; printf '%s\\0' "$f"; done`
  // Keep records atomic and continue after a denied child within find's batch.
  // Ordinary stat and every mutation still propagate nonzero command exits.
  private listStatScript = () => `failed=0; for f do if metadata=$(stat -c ${this.format} -- "$f"); then access=; if [ -d "$f" ]; then if [ ! -r "$f" ] || [ ! -x "$f" ]; then access=restricted; fi; fi; printf '%s\\t%s\\n%s\\0' "$metadata" "$access" "$f"; else failed=1; fi; done; exit "$failed"`
  private deviceListing(l: FileLocation, result: CommandResult): { entries: FileEntry[]; warning?: string } {
    const lines = result.stderr.split(/\r?\n/).map(line => line.trim()).filter(Boolean), denied = new Set<string>()
    for (const line of lines) {
      const match = line.match(/^(?:find|stat): (?:cannot stat(?:x)? )?(['"])(.+)\1: (?:Permission denied|Operation not permitted)$/)
      if (!match || path.posix.dirname(match[2]) !== l.path || match[2] === l.path) {
        if (match?.[2] === l.path) throw new Error('Android does not allow reading this folder with the current access: ' + l.path)
        throw new Error((result.stderr || 'Unable to read the phone folder.').slice(0, 1200))
      }
      denied.add(match[2])
    }
    if (result.code !== 0 && (result.code !== 1 || !denied.size)) checked(result)
    const entries = this.decode(result.stdout)
    for (const name of denied) {
      const known = entries.find(e => e.path === name)
      if (known) known.access = 'restricted'
      else entries.push({ name: path.posix.basename(name), path: name, kind: 'other', size: 0, modified: 0, fingerprint: '', access: 'restricted' })
    }
    return { entries, ...(denied.size ? { warning: `${denied.size} restricted item${denied.size === 1 ? '' : 's'} shown with a lock. Some properties or contents are unavailable${l.root ? ' even with the requested root access' : '; root may help'}.` } : {}) }
  }
  async stat(l: FileLocation, signal?: AbortSignal): Promise<FileEntry> {
    if (l.kind === 'device') return this.decode(await this.command(l, `sh -c ${quote(this.statScript())} sh ${quote(l.path)}`, signal))[0]
    const s = await fs.lstat(l.path)
    return { name: path.basename(l.path), path: l.path, kind: s.isSymbolicLink() ? 'link' : s.isDirectory() ? 'directory' : s.isFile() ? 'file' : 'other', size: s.size, modified: s.mtimeMs, mode: (s.mode & 0o7777).toString(8), fingerprint: [s.dev, s.ino, s.mode, s.size, s.mtimeMs, s.ctimeMs].join(':') }
  }
  async exists(l: FileLocation, signal?: AbortSignal) { try { return await this.stat(l, signal) } catch (e) { if (missing(e)) return null; throw e } }
  async list(location: FileLocation, signal?: AbortSignal, attributes = true): Promise<FileListing> {
    validateLocation(location, true)
    if (location.kind === 'local' && !location.path) {
      const roots = [os.homedir(), ...(process.platform === 'win32' ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(c => c + ':\\') : ['/'])]
      const entries: FileEntry[] = []
      for (const p of roots) { try { entries.push({ ...await this.stat(at(location, p)), name: p === os.homedir() ? 'Home · ' + os.userInfo().username : p }) } catch { /* Drive is not mounted. */ } }
      return { location, parent: '', entries }
    }
    const l = await this.canonical(location, signal), s = await this.stat(l, signal)
    if (s.kind !== 'directory') throw new Error('This location is not a folder.')
    let entries: FileEntry[], warning: string | undefined
    if (l.kind === 'device') {
      const result = this.deviceListing(l, await this.commandResult(l, `find ${quote(l.path)} -mindepth 1 -maxdepth 1 -exec sh -c ${quote(this.listStatScript())} sh {} +`, signal))
      entries = result.entries; warning = result.warning
    }
    else {
      entries = []
      for (const name of await fs.readdir(l.path)) { signal?.throwIfAborted(); try { entries.push(await this.stat(child(l, name), signal)) } catch (e) { if (!missing(e)) { entries.push({ name, path: child(l, name).path, kind: 'other', size: 0, modified: 0, fingerprint: '' }); warning = 'Some objects could not be inspected: ' + message(e) } } }
      if (attributes && process.platform === 'win32') try {
        const raw = await powershell("$items=[Collections.Generic.List[string]]::new(); foreach($p in [IO.Directory]::EnumerateFileSystemEntries($env:ADB_VAULT_FILES_PATH)){ try { if(([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::Hidden) -ne 0){ $items.Add([IO.Path]::GetFileName($p)) } } catch {} }; ConvertTo-Json -InputObject @($items.ToArray()) -Compress", { ADB_VAULT_FILES_PATH: l.path }, 10000, this.runner)
        const hidden = new Set<string>(JSON.parse(raw)); entries = entries.map(e => ({ ...e, hidden: hidden.has(e.name) }))
      } catch { warning = 'Windows hidden attributes could not be read; dot-file filtering is still available.' }
    }
    if (entries.length > 50000) throw new Error('Folder exceeds the 50,000-object listing limit.')
    let free: number | undefined
    if (l.kind === 'local') try { const s = await fs.statfs(l.path); free = s.bavail * s.bsize } catch { /* Optional filesystem metric. */ }
    return { location: l, parent: fileParentPath(l), entries, free, warning }
  }
  async listComplete(l: FileLocation, signal?: AbortSignal) {
    const listing = await this.list(l, signal, false)
    if (listing.warning) throw new Error('Cannot read every item in ' + l.path + '. ' + listing.warning)
    return listing
  }
  async storages(location: FileLocation) {
    validateLocation(location)
    if (location.kind !== 'device') throw new Error('Choose a phone to read its storage list.')
    const l = { ...location, path: '/sdcard', root: false }
    const primary = await this.canonical(l)
    const storages = parseFileStorages(await this.command(l, 'dumpsys mount', undefined, undefined, undefined, 10000), primary.path)
    this.device(l)
    if (this.device(l).status === 'recovery' || !/^\/storage\/emulated\/\d+$/.test(primary.path)) return storages
    try {
      const profiles = parseAndroidProfiles(await this.command(l, 'pm list users', undefined, undefined, undefined, 8000))
      this.device(l)
      return profileFileStorages(storages, profiles, primary.path)
    } catch {
      this.device(l)
      // Storage access remains useful when Android does not expose its profile list.
      return profileFileStorages(storages, [], primary.path)
    }
  }
  async mkdir(l: FileLocation, signal?: AbortSignal) { if (l.kind === 'local') await fs.mkdir(l.path); else await this.command(l, 'mkdir -- ' + quote(l.path), signal) }
  async create(l: FileLocation, signal?: AbortSignal) { if (l.kind === 'local') { const f = await fs.open(l.path, 'wx'); await f.close() } else await this.command(l, '( set -C; : > ' + quote(l.path) + ' )', signal) }
  async remove(l: FileLocation, recursive: boolean, signal?: AbortSignal) {
    if (key(l).replace(/[\\/]+$/, '') === key(at(l, api(l).parse(l.path).root)).replace(/[\\/]+$/, '') || /^\/(sdcard|storage|data|system|vendor|proc|sys|dev)$/.test(l.path)) throw new Error('Removing a storage or system root is not allowed.')
    if (l.kind === 'local') await fs.rm(l.path, { recursive, force: false }); else await this.command(l, `rm ${recursive ? '-r ' : ''}-- ${quote(l.path)}`, signal)
  }
  async removeEmptyDirectory(l: FileLocation, signal?: AbortSignal) {
    if (l.kind === 'local') await fs.rmdir(l.path); else await this.command(l, 'rmdir -- ' + quote(l.path), signal)
  }
  async rename(from: FileLocation, to: FileLocation, replace = false, signal?: AbortSignal) {
    if (!sameHost(from, to)) throw new Error('Rename requires the same source.')
    if (!replace && await this.exists(to, signal)) throw new Error('Destination already exists.')
    if (from.kind === 'local') {
      if (!replace && (await fs.lstat(from.path)).isFile()) {
        try { await fs.link(from.path, to.path) }
        catch (e) { if (!['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'EXDEV'].includes((e as NodeJS.ErrnoException).code || '')) throw e; await fs.copyFile(from.path, to.path, constants.COPYFILE_EXCL) }
        await fs.unlink(from.path)
      }
      else await fs.rename(from.path, to.path)
    }
    else {
      await this.command(from, `mv -T ${replace ? '-f' : '-n'} -- ${quote(from.path)} ${quote(to.path)}`, signal)
      if (await this.exists(from, signal)) throw new Error('Move was not completed; the destination may already exist.')
    }
  }
  async hash(l: FileLocation, signal?: AbortSignal) {
    if (l.kind === 'device') { const result = await this.command(l, 'sha256sum -- ' + quote(l.path), signal, undefined, undefined, 30 * 60_000); const match = result.match(/^[a-f0-9]{64}/i); if (!match) throw new Error('Unable to verify the transferred file.'); return match[0].toLowerCase() }
    const hash = createHash('sha256'); for await (const data of createReadStream(l.path, { signal })) hash.update(data); return hash.digest('hex')
  }
  async transfer(from: FileLocation, to: FileLocation, signal: AbortSignal, progress: (bytes: number) => void) {
    if (from.kind === 'local' && to.kind === 'local') {
      await pipeline(createReadStream(from.path), new Transform({ transform(chunk, _enc, cb) { progress(chunk.length); cb(null, chunk) } }), createWriteStream(to.path, { flags: 'wx' }), { signal }); return
    }
    if (sameHost(from, to)) { await this.command(from, `cp -- ${quote(from.path)} ${quote(to.path)}`, signal, undefined, undefined, 30 * 60_000); progress((await this.stat(to, signal)).size); return }
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'adb-vault-files-'))
    let reported = 0
    const count = (bytes: number) => { reported += bytes; progress(bytes) }
    try {
      const local = from.kind === 'local' ? from.path : path.join(temp, 'transfer')
      if (from.kind === 'device') await this.command(from, 'cat -- ' + quote(from.path), signal, local, count)
      const size = (await fs.stat(local)).size
      const onStdout = (text: string) => { if (from.kind !== 'local') return; const percent = [...text.matchAll(/\[\s*(\d+)%\]/g)].at(-1); if (percent) { const bytes = Math.min(size, Math.floor(size * Number(percent[1]) / 100)); if (bytes > reported) count(bytes - reported) } }
      if (to.kind === 'local') {
        await pipeline(createReadStream(local), createWriteStream(to.path, { flags: 'wx' }), { signal })
      } else if (!to.root || this.device(to).root?.method === 'adb') {
        checked(await this.adbRun(to, ['push', local, to.path], { signal, onStdout }))
      } else {
        const staging = '/data/local/tmp/adb-vault-file-' + randomUUID()
        try { checked(await this.adbRun({ ...to, root: false }, ['push', local, staging], { signal, onStdout })); await this.command(to, `cp -- ${quote(staging)} ${quote(to.path)}`, signal, undefined, undefined, 30 * 60_000) }
        finally { await this.command({ ...to, root: false }, 'rm -f -- ' + quote(staging), AbortSignal.timeout(8000)).catch(() => {}) }
      }
      if (size > reported) count(size - reported)
    } finally { await fs.rm(temp, { recursive: true, force: true }) }
  }
}

interface PreparedEntry { files: number; folders: number; bytes: number; children?: FileEntry[] }
interface Runtime { prepared?: Map<string, PreparedEntry>; rules?: Partial<Record<'folder' | 'file' | 'mixed', FilePlan['conflict']>>; committed?: number; plan: FilePlan; task: FileTask; controller: AbortController; failure?: string; promise?: Promise<void>; wake?: () => void; decision?: (choice: FilePlan['conflict']) => void; undo: { from: FileLocation; to: FileLocation; fingerprint: string }[] }
export class FilesService {
  state: FilesState = { tasks: [], revision: 0 }
  private jobs = new Map<string, Runtime>()
  private closing = false
  private lastProgress = 0
  private waiters = new Map<string, Set<(task: FileTask) => void>>()
  constructor(readonly io: FileIO, private emit: (event: BackendEvent) => void, private externallyBusy: () => boolean = () => false, private persistCheckpoint: () => Promise<void> = async () => {}) {}
  get busy() { return this.state.tasks.some(fileTaskActive) }
  get deviceBusy() { return this.state.tasks.some(t => fileTaskActive(t) && (t.source.kind === 'device' || t.destination?.kind === 'device')) }
  connectionChanged(connection: ConnectionSnapshot) {
    let changed = false
    for (const r of this.jobs.values()) {
      if (!fileTaskActive(r.task)) continue
      const lost = [r.plan.source, r.plan.destination].find(l => l?.kind === 'device' && !connection.devices.some(d => d.id === l.id && d.serial === l.serial && d.transportId === l.transportId && ['connected', 'recovery'].includes(d.status)))
      if (!lost) continue
      changed = true; r.failure = 'Phone connection changed or was lost. Refresh its panel before starting another task.'
      r.controller.abort(); r.wake?.(); r.decision?.('skip')
      if (r.task.status === 'queued') {
        r.task.status = 'error'; r.task.endedAt = new Date().toISOString(); r.task.completed = r.task.items.length
        r.task.items.forEach(i => { i.status = 'error'; i.message = r.failure })
        this.emit({ type: 'activity', source: 'files', device: lost.id, tone: 'warning', text: `${fileActionLabel[r.plan.action]} · ${r.task.items.length} objects · Not started. ${r.failure}` })
      }
    }
    if (changed) { this.publish(); this.pump() }
  }
  private publish() {
    this.state = { ...this.state, revision: this.state.revision + 1 }; this.emit({ type: 'files', state: structuredClone(this.state) })
    for (const t of this.state.tasks) if (!fileTaskActive(t)) { for (const resolve of this.waiters.get(t.id) || []) resolve(t); this.waiters.delete(t.id) }
  }
  async waitForTask(id: string): Promise<FileTask> {
    const task = this.state.tasks.find(t => t.id === id); if (!task) throw new Error('File task is no longer available.')
    if (!fileTaskActive(task)) return task
    return new Promise(resolve => { const waiters = this.waiters.get(id) || new Set(); waiters.add(resolve); this.waiters.set(id, waiters) })
  }
  async list(l: FileLocation, recursive = false, pattern = '*'): Promise<FileListing> {
    if (l.kind === 'device' && this.externallyBusy()) throw new Error('Wait for the current device operation before reading files.')
    const listing = await this.io.list(l)
    if (!recursive) return listing
    const matcher = filePattern(pattern), found: FileEntry[] = [], queue = [...listing.entries], start = Date.now(); let visited = 0
    while (queue.length) {
      const e = queue.shift()!
      if (++visited > 20000 || Date.now() - start > 60000) { listing.warning = 'Search stopped at the 20,000-object / 60-second limit. Narrow the folder or pattern.'; break }
      if (matcher.test(e.name)) found.push(e)
      if (e.kind === 'directory') { try { const nested = await this.io.list(at(listing.location, e.path)); queue.push(...nested.entries); if (nested.warning) listing.warning = nested.warning } catch (error) { listing.warning = 'Some folders could not be read: ' + message(error) } }
    }
    return { ...listing, entries: found }
  }
  async storages(l: FileLocation) {
    if (this.externallyBusy() || this.deviceBusy) throw new Error('Wait for the current device operation, then refresh the storage list.')
    return this.io.storages(l)
  }
  async properties(l: FileLocation, calculate: boolean) {
    validateLocation(l); const entry = await this.io.stat(l)
    if (!calculate || entry.kind !== 'directory') return { entry }
    let bytes = 0, count = 0; const folders = [l]; const start = Date.now()
    while (folders.length) {
      for (const e of (await this.io.listComplete(folders.shift()!)).entries) {
        if (++count > 100000 || Date.now() - start > 60000) throw new Error('Size calculation exceeded 100,000 objects / 60 seconds.')
        if (e.kind === 'directory') folders.push(at(l, e.path)); else if (e.kind === 'file') bytes += e.size
      }
    }
    return { entry, bytes, count }
  }
  validateEnqueue(input: FilePlan) {
    if (this.closing) throw new Error('Files is shutting down.')
    if (this.state.tasks.filter(fileTaskActive).length >= 64) throw new Error('The queue is full (64 active tasks). Finish or stop a task first.')
    const plan = structuredClone(validateFilePlan(input))
    if ((plan.source.kind === 'device' || plan.destination?.kind === 'device') && this.externallyBusy()) throw new Error('Wait for the current device operation before starting a file task.')
    for (const l of [plan.source, plan.destination]) if (l?.kind === 'device') this.io.device(l)
    return plan
  }
  enqueue(input: FilePlan) {
    const plan = this.validateEnqueue(input)
    // Selecting a folder and its descendants must not execute the same changes twice.
    plan.items = plan.items.filter(i => !plan.items.some(p => p.path !== i.path && inside(at(plan.source, i.path), at(plan.source, p.path))))
    const task: FileTask = { id: randomUUID(), action: plan.action, source: plan.source, destination: plan.destination, status: 'queued', createdAt: new Date().toISOString(), items: plan.items.map(i => ({ path: i.path, status: 'pending' })), completed: 0, bytes: 0, ...(['copy', 'move'].includes(plan.action) ? { processedContents: { files: 0, folders: 0 } } : {}), current: '', pauseRequested: false, stopRequested: false }
    this.state.tasks = [...this.state.tasks.filter(fileTaskActive), ...this.state.tasks.filter(t => !fileTaskActive(t)).slice(-99), task].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    for (const [id, job] of this.jobs) if (!job.promise && !this.state.tasks.some(t => t.id === id)) this.jobs.delete(id)
    this.jobs.set(task.id, { plan, task, controller: new AbortController(), undo: [] }); this.publish(); this.pump(); return task.id
  }
  private conflicts(a: FileTask, b: FileTask) {
    return [a.source, a.destination].filter(Boolean).some(x => [b.source, b.destination].filter(Boolean).some(y => x!.kind === 'device' && y!.kind === 'device' && x!.id === y!.id || inside(x!, y!) || inside(y!, x!)))
  }
  private pump() {
    if (this.closing) return
    const running = this.state.tasks.filter(t => ['running', 'paused', 'conflict'].includes(t.status))
    for (const t of this.state.tasks.filter(t => t.status === 'queued')) {
      if (running.length >= 2) break
      if (running.some(r => this.conflicts(t, r))) continue
      const runtime = this.jobs.get(t.id)!; t.status = 'running'; running.push(t)
      runtime.promise = this.execute(runtime).finally(() => { runtime.promise = undefined; this.publish(); this.pump() })
    }
  }
  private async checkpoint(r: Runtime) {
    if (r.controller.signal.aborted || r.task.stopRequested) throw new Error(r.failure || 'Task stopped.')
    if (r.task.pauseRequested) {
      r.task.status = 'paused'; this.publish()
      await new Promise<void>(resolve => { r.wake = resolve })
      r.wake = undefined
      if (r.task.stopRequested || r.controller.signal.aborted) throw new Error(r.failure || 'Task stopped.')
      r.task.status = 'running'; this.publish()
    }
  }
  private async choice(r: Runtime, from: FileLocation, to: FileLocation, directory: boolean, mergeable: boolean) {
    const kind = mergeable ? 'folder' : directory ? 'mixed' : 'file'
    const rule = r.rules?.[kind] || r.plan.conflict
    if (rule !== 'ask' && (rule !== 'merge' || mergeable)) return rule
    r.task.status = 'conflict'; r.task.conflict = { source: from.path, destination: to.path, directory, mergeable }; this.publish()
    const choice = await new Promise<FilePlan['conflict']>(resolve => { r.decision = resolve })
    r.decision = undefined; r.task.conflict = undefined; r.task.status = 'running'; await this.checkpoint(r); return choice
  }
  private async destination(r: Runtime, from: FileLocation, desired: FileLocation, entry: FileEntry): Promise<{ location: FileLocation; replace?: FileEntry; merge?: FileEntry } | null> {
    const existing = await this.io.exists(desired, r.controller.signal)
    if (!existing) return { location: desired }
    const mergeable = existing.kind === 'directory' && entry.kind === 'directory'
    const decision = await this.choice(r, from, desired, existing.kind === 'directory' || entry.kind === 'directory', mergeable)
    if (decision === 'skip') return null
    if (decision === 'merge') {
      if (!mergeable) throw new Error('Merge is available only for two folders.')
      return { location: desired, merge: existing }
    }
    if (decision === 'replace') {
      if (entry.kind !== 'file' || existing.kind !== 'file') throw new Error('Folder and link replacement is not supported. Choose Merge for two folders, Skip or Keep both.')
      return { location: desired, replace: existing }
    }
    const ext = entry.kind === 'directory' ? '' : api(desired).extname(desired.path), stem = desired.path.slice(0, desired.path.length - ext.length)
    for (let n = 2; n < 10000; n++) { const location = at(desired, `${stem} (${n})${ext}`); if (!await this.io.exists(location, r.controller.signal)) return { location } }
    throw new Error('Unable to choose a unique destination name.')
  }
  private async unchanged(l: FileLocation, fingerprint: string, signal?: AbortSignal) {
    const current = await this.io.stat(l, signal)
    if (current.fingerprint !== fingerprint) throw new Error('Object changed since selection. Refresh and select it again.')
    if (!['file', 'directory'].includes(current.kind)) throw new Error('Links and special files are not changed or followed by file tasks.')
    return current
  }
  private async assertNoLinks(l: FileLocation, signal: AbortSignal, counter = { n: 0 }) {
    const s = await this.io.stat(l, signal)
    if (!['file', 'directory'].includes(s.kind)) throw new Error('The folder contains a link or special file. It was not changed.')
    if (++counter.n > 100000) throw new Error('Operation exceeds the 100,000-object safety limit.')
    if (s.kind === 'directory') for (const e of (await this.io.listComplete(l, signal)).entries) await this.assertNoLinks(at(l, e.path), signal, counter)
  }
  private async prepareTransfer(r: Runtime, source: FileLocation) {
    const t = r.task, signal = r.controller.signal
    t.phase = 'scanning'; t.scan = { files: 0, folders: 0, bytes: 0 }; r.prepared = new Map(); this.publish()
    let lastPublished = 0
    const scan = async (from: FileLocation, entry: FileEntry): Promise<PreparedEntry> => {
      await this.checkpoint(r)
      if (!['file', 'directory'].includes(entry.kind)) throw new Error('A link or special file cannot be included in the total.')
      if (t.scan!.files + t.scan!.folders >= 100000) throw new Error('Counting reached the 100,000-object limit.')
      const result: PreparedEntry = { files: entry.kind === 'file' ? 1 : 0, folders: entry.kind === 'directory' ? 1 : 0, bytes: entry.kind === 'file' ? entry.size : 0 }
      t.scan!.files += result.files; t.scan!.folders += result.folders; t.scan!.bytes += result.bytes; t.current = from.path
      if (Date.now() - lastPublished > 200) { lastPublished = Date.now(); this.publish() }
      if (entry.kind === 'directory') {
        result.children = (await this.io.listComplete(from, signal)).entries
        for (const childEntry of result.children) {
          const contents = await scan(at(from, childEntry.path), childEntry)
          result.files += contents.files; result.folders += contents.folders; result.bytes += contents.bytes
        }
        await this.unchanged(from, entry.fingerprint, signal)
      }
      r.prepared!.set(key(from), result)
      return result
    }
    try {
      for (const input of r.plan.items) {
        await this.checkpoint(r)
        const from = child(source, api(r.plan.source).relative(r.plan.source.path, input.path))
        const parent = await this.io.canonical(at(from, api(from).dirname(from.path)), signal)
        if (!inside(parent, source)) throw new Error('Selected path traverses a link outside its source folder.')
        await scan(from, await this.unchanged(from, input.fingerprint, signal))
      }
      t.totalBytes = t.scan.bytes; t.totalContents = { files: t.scan.files, folders: t.scan.folders }
    } catch (error) {
      // Counting is advisory. Ordinary transfer checks still report individual failures;
      // an unreadable tree must not stop unrelated selected files from being copied.
      r.prepared = undefined
      if (signal.aborted || t.stopRequested) throw error
      t.progressNote = 'Overall total unavailable. Showing transferred data only. ' + message(error)
    }
    t.phase = 'preparing'; this.publish(); await this.persistCheckpoint()
  }
  private async transferChildren(r: Runtime, from: FileLocation) {
    // Reuse the counted listing, but keep all fingerprint, size, hash and parent
    // checks during copying. New/changed children cannot silently enter the plan.
    return r.prepared?.get(key(from))?.children ?? (await this.io.listComplete(from, r.controller.signal)).entries
  }
  private async copyTree(r: Runtime, from: FileLocation, to: FileLocation, original: FileEntry, verify: boolean, counter = { n: 0 }, captured: { location: FileLocation; fingerprint: string }[] = []) {
    await this.checkpoint(r); const signal = r.controller.signal
    if (++counter.n > 100000) throw new Error('Operation exceeds the 100,000-object limit.')
    await this.unchanged(from, original.fingerprint, signal)
    if (to.kind === 'local' && nameProblem(original.name, process.platform === 'win32')) throw new Error('A source name is not supported by the destination filesystem: ' + original.name)
    captured.push({ location: from, fingerprint: original.fingerprint })
    r.task.current = from.path
    r.task.phase = original.kind === 'directory' ? 'preparing' : 'transferring'
    r.task.fileProgress = original.kind === 'file' ? { bytes: 0, totalBytes: original.size } : undefined
    this.publish()
    if (original.kind === 'directory') {
      await this.io.mkdir(to, signal)
      for (const e of await this.transferChildren(r, from)) await this.copyTree(r, at(from, e.path), child(to, e.name), e, verify, counter, captured)
      await this.unchanged(from, original.fingerprint, signal)
    } else {
      await this.io.transfer(from, to, signal, bytes => { r.task.bytes += bytes; r.task.fileProgress!.bytes += bytes; if (Date.now() - this.lastProgress > 200) { this.lastProgress = Date.now(); this.publish() } })
      r.task.phase = 'verifying'; this.publish()
      if ((await this.io.stat(to, signal)).size !== original.size) throw new Error('Transferred size does not match the source.')
      if (verify && await this.io.hash(from, signal) !== await this.io.hash(to, signal)) throw new Error('Verification failed. The original was kept.')
      await this.unchanged(from, original.fingerprint, signal)
    }
    if (r.task.processedContents) {
      if (original.kind === 'directory') r.task.processedContents.folders++
      else r.task.processedContents.files++
    }
    this.publish(); await this.persistCheckpoint()
  }
  // Merge publishes complete children separately. It never replaces the existing folder,
  // and a move only removes verified children, then removes the source with nonrecursive rmdir.
  private async transferObject(r: Runtime, from: FileLocation, desired: FileLocation, entry: FileEntry, item: FileTask['items'][number], mutate: () => void, counter = { n: 0 }, guard: () => Promise<void> = async () => {}, nested = false): Promise<boolean> {
    await this.checkpoint(r); await guard()
    const signal = r.controller.signal, t = r.task
    await this.unchanged(from, entry.fingerprint, signal)
    if (nameProblem(entry.name, desired.kind === 'local' && process.platform === 'win32')) throw new Error('Name is not supported by the destination filesystem: ' + entry.name)
    const target = await this.destination(r, from, desired, entry)
    if (!target) {
      const skipped = r.prepared?.get(key(from))
      if (skipped && t.totalContents && t.totalBytes !== undefined) {
        t.totalBytes -= skipped.bytes; t.totalContents.files -= skipped.files; t.totalContents.folders -= skipped.folders
        t.skippedContents ??= { files: 0, folders: 0 }
        t.skippedContents.files += skipped.files; t.skippedContents.folders += skipped.folders
        this.publish()
      }
      item.skipped = (item.skipped || 0) + 1
      if (item.skipped <= 20) item.message = (item.message ? item.message + '\n' : '') + 'Skipped: ' + from.path
      return false
    }
    await guard()
    const to = target.location
    if (!nested) item.target = to.path
    if (target.merge) {
      item.merged = true
      if (++counter.n > 100000) throw new Error('Operation exceeds the 100,000-object limit.')
      await this.unchanged(to, target.merge.fingerprint, signal)
      const identity = (l: FileLocation, e: FileEntry) => { const parts = e.fingerprint.split(':'); return l.kind === 'local' ? parts.slice(0, 3).join(':') : [parts[0], parts[2]].join(':') }
      const checkParents = async () => {
        await guard()
        for (const [location, original] of [[from, entry], [to, target.merge!]] as const) {
          const now = await this.io.stat(location, signal)
          if (now.kind !== 'directory' || identity(location, now) !== identity(location, original)) throw new Error('A merge folder changed. Refresh both folders before continuing: ' + location.path)
        }
      }
      await checkParents()
      const children = await this.transferChildren(r, from)
      let complete = true
      for (const e of children) {
        try { if (!await this.transferObject(r, at(from, e.path), child(to, e.name), e, item, mutate, counter, checkParents, true)) complete = false }
        catch (error) { throw new Error('While merging ' + e.path + ': ' + message(error)) }
      }
      await this.checkpoint(r); await checkParents()
      if (r.plan.action === 'move') {
        if (complete) { mutate(); await this.io.removeEmptyDirectory(from, signal); r.committed = (r.committed || 0) + 1 }
      } else await this.unchanged(from, entry.fingerprint, signal)
      if (complete && t.processedContents) t.processedContents.folders++
      return complete
    }
    const staging = child(at(to, api(to).dirname(to.path)), '.adb-vault-' + randomUUID() + '.partial')
    try {
      const captured: { location: FileLocation; fingerprint: string }[] = []
      await this.copyTree(r, from, staging, entry, r.plan.action === 'move', counter, captured)
      await this.checkpoint(r); await guard()
      t.phase = 'finishing'; t.current = from.path; t.fileProgress = undefined; this.publish()
      if (target.replace) await this.unchanged(to, target.replace.fingerprint, signal)
      else if (await this.io.exists(to, signal)) throw new Error('Destination appeared during copying. Nothing was replaced.')
      mutate(); await this.io.rename(staging, to, !!target.replace, signal); r.committed = (r.committed || 0) + 1
      if (r.plan.action === 'move') {
        for (const object of captured) await this.unchanged(object.location, object.fingerprint, signal)
        await guard(); await this.io.remove(from, entry.kind === 'directory', signal)
        if (!nested && !item.merged && sameHost(from, to) && !target.replace && api(from).basename(from.path) === api(to).basename(to.path)) r.undo.push({ from: to, to: from, fingerprint: (await this.io.stat(to, signal)).fingerprint })
      }
    } finally { try { const cleanup = AbortSignal.timeout(8000); if (await this.io.exists(staging, cleanup)) await this.io.remove(staging, true, cleanup) } catch { item.message = (item.message ? item.message + '\n' : '') + 'A temporary .adb-vault-*.partial object may remain in the destination.' } }
    return true
  }
  private async execute(r: Runtime) {
    const t = r.task, p = r.plan, signal = r.controller.signal; this.publish()
    try {
      await this.persistCheckpoint()
      // Canonical parents make aliases such as /sdcard safe for overlap checks.
      const source = await this.io.canonical(p.source), destination = p.destination ? await this.io.canonical(p.destination) : undefined
      const mapped = (name: string) => child(source, api(p.source).relative(p.source.path, name))
      if (destination && (await this.io.stat(destination, signal)).kind !== 'directory') throw new Error('Destination is not a folder.')
      if (p.action === 'copy' || p.action === 'move') await this.prepareTransfer(r, source)
      if (p.action === 'rename') for (const i of p.items) {
        const from = mapped(i.path), to = at(from, api(from).join(api(from).dirname(from.path), i.name!))
        if (key(from) !== key(to) && await this.io.exists(to, signal)) throw new Error('Rename preview has an existing destination: ' + to.path)
      }
      for (let n = 0; n < p.items.length; n++) {
        const item = t.items[n], input = p.items[n]; await this.checkpoint(r)
        item.status = 'running'; t.current = input.path; t.phase = ['copy', 'move'].includes(p.action) ? 'preparing' : undefined; t.fileProgress = undefined; this.publish()
        await this.persistCheckpoint()
        let mutation = false
        try {
          const from = mapped(input.path)
          const parent = await this.io.canonical(at(from, api(from).dirname(from.path)))
          if (!inside(parent, source) && !['mkdir', 'create'].includes(p.action)) throw new Error('Selected path traverses a link outside its source folder.')
          if (p.action === 'mkdir' || p.action === 'create') {
            const target = child(source, input.name!); mutation = true
            if (p.action === 'mkdir') await this.io.mkdir(target, signal); else await this.io.create(target, signal)
            item.target = target.path
          } else {
            const entry = await this.unchanged(from, input.fingerprint, signal)
            if (p.action === 'delete') { await this.assertNoLinks(from, signal); await this.unchanged(from, input.fingerprint, signal); mutation = true; await this.io.remove(from, entry.kind === 'directory', signal) }
            else if (p.action === 'chmod') { mutation = true; await this.io.command(from, `chmod ${p.mode} -- ${quote(from.path)}`, signal) }
            else if (p.action === 'rename') {
              const to = at(from, api(from).join(api(from).dirname(from.path), input.name!)); item.target = to.path
              if (key(from) !== key(to)) { mutation = true; await this.io.rename(from, to, false, signal); r.undo.push({ from: to, to: from, fingerprint: (await this.io.stat(to, signal)).fingerprint }) }
              else { item.status = 'skipped'; item.message = 'Name unchanged (case-only rename is not supported).' }
            } else {
              const desired = child(destination!, entry.name)
              if (inside(destination!, from) || inside(from, desired)) throw new Error('Cannot copy or move an object onto itself or into its own folder.')
              const complete = await this.transferObject(r, from, desired, entry, item, () => { mutation = true })
              if (!complete) item.status = item.merged ? 'partial' : 'skipped'
            }
          }
          if (item.status === 'running') item.status = 'success'
        } catch (error) {
          item.status = r.task.stopRequested ? 'cancelled' : 'error'; item.message = (r.failure || message(error)) + (item.message ? '\n' + item.message : '')
          item.uncertain = mutation && /offline|disconnect|connection|timed out|cancelled|Task stopped|transport/i.test(message(error))
          // Never automatically continue destructive work after losing the target device.
          if (item.uncertain || /phone connection changed|device .*offline|device .*not found/i.test(message(error))) { for (const later of t.items.slice(n + 1)) { later.status = 'cancelled'; later.message = 'Stopped after a connection error.' } break }
        }
        t.completed++; this.publish(); await this.persistCheckpoint()
      }
    } catch (error) { for (const item of t.items.filter(i => ['pending', 'running'].includes(i.status))) { item.status = t.stopRequested ? 'cancelled' : 'error'; item.message = r.failure || message(error) } }
    r.prepared = undefined
    for (const item of t.items.filter(i => i.status === 'pending')) item.status = 'cancelled'
    for (const item of t.items.filter(i => i.merged)) item.message = (item.message ? item.message + '\n' : '') + 'Folders merged. Completed changes are kept; existing destination-only files are untouched.' + (item.status !== 'success' ? ' Refresh the source and select remaining items to continue.' : '')
    const success = !!r.committed || t.items.some(i => i.status === 'success'), failed = t.items.some(i => ['error', 'cancelled'].includes(i.status))
    t.status = t.stopRequested ? 'cancelled' : failed ? success ? 'partial' : 'error' : t.items.some(i => i.status === 'partial') ? 'partial' : 'success'
    t.completed = t.items.filter(i => !['pending', 'running'].includes(i.status)).length; t.endedAt = new Date().toISOString(); t.current = ''; t.phase = undefined; t.fileProgress = undefined; t.undoable = !t.items.some(i => i.merged) && r.undo.length > 0 && r.undo.length === t.items.filter(i => i.status === 'success').length && ['move', 'rename'].includes(p.action)
    this.emit({ type: 'activity', source: 'files', tone: t.status === 'success' ? 'success' : 'warning', device: p.source.kind === 'device' ? p.source.id : p.destination?.id, text: `${fileActionLabel[p.action]} · ${t.items.length} objects · ${t.status}\nFrom: ${p.source.path}${p.destination ? '\nTo: ' + p.destination.path : ''}\n` + t.items.map(i => `${i.status}: ${i.path}${i.target ? ' → ' + i.target : ''}${i.message ? '\n' + i.message : ''}${i.uncertain ? '\nOutcome uncertain. Inspect both locations before retrying.' : ''}`).join('\n') })
  }
  async control(id: string, action: string) {
    const r = this.jobs.get(id); if (!r) throw new Error('File task is no longer available.')
    if (action === 'undo') {
      if (!r.task.undoable || this.busy) throw new Error('Undo is unavailable while another file task is active.')
      for (const u of r.undo) { await this.unchanged(u.from, u.fingerprint); if (await this.io.exists(u.to)) throw new Error('The original path is occupied; undo was not started.') }
      const groups = new Map<string, typeof r.undo>()
      for (const u of r.undo) { const groupKey = JSON.stringify([api(u.from).dirname(u.from.path), api(u.to).dirname(u.to.path)]), values = groups.get(groupKey) || []; values.push(u); groups.set(groupKey, values) }
      // Renames can be undone in place. Moves to another directory use a verified move task.
      for (const group of groups.values()) {
        const parent = api(group[0].from).dirname(group[0].from.path)
        const source = at(group[0].from, parent), dest = at(group[0].to, api(group[0].to).dirname(group[0].to.path))
        const renaming = group.every(u => api(u.to).dirname(u.to.path) === parent)
        this.enqueue({ action: renaming ? 'rename' : 'move', source, destination: renaming ? undefined : dest, conflict: 'ask', confirmed: true, items: group.map(u => ({ path: u.from.path, fingerprint: u.fingerprint, ...(renaming ? { name: api(u.to).basename(u.to.path) } : {}) })) })
      }
      r.task.undoable = false
    } else if (action === 'retry') {
      if (fileTaskActive(r.task)) throw new Error('Wait for the task to finish.')
      const items = r.plan.items.filter((_i, n) => ['error', 'cancelled'].includes(r.task.items[n].status) && !r.task.items[n].uncertain && !r.task.items[n].merged)
      if (!items.length) throw new Error('No safe unfinished objects to retry.')
      this.enqueue({ ...r.plan, items, conflict: 'ask' })
    } else if (fileTaskActive(r.task)) {
      if (action === 'cancel') {
        r.task.stopRequested = true; r.controller.abort(); r.wake?.(); r.decision?.('skip')
        if (r.task.status === 'queued') { r.task.status = 'cancelled'; r.task.endedAt = new Date().toISOString(); r.task.items.forEach(i => { i.status = 'cancelled' }); this.emit({ type: 'activity', source: 'files', tone: 'info', device: r.plan.source.id || r.plan.destination?.id, text: `${fileActionLabel[r.plan.action]} · ${r.task.items.length} objects · Cancelled before starting. No objects were changed.\n${r.plan.source.path}` }); this.pump() }
      } else if (action === 'pause') r.task.pauseRequested = true
      else if (action === 'resume') { r.task.pauseRequested = false; r.wake?.() }
    }
    this.publish()
  }
  resolve(id: string, choice: FilePlan['conflict'], all: boolean) {
    const r = this.jobs.get(id); if (!r?.decision || !['skip', 'keep-both', 'replace', 'merge'].includes(choice)) throw new Error('No matching conflict to resolve.')
    if (choice === 'replace' && r.task.conflict?.directory) throw new Error('Directory replacement is not supported.')
    if (choice === 'merge' && !r.task.conflict?.mergeable) throw new Error('Merge is available only for two folders.')
    if (all) { r.rules ||= {}; r.rules[r.task.conflict?.mergeable ? 'folder' : r.task.conflict?.directory ? 'mixed' : 'file'] = choice }
    r.decision(choice)
  }
  async shutdown() { this.closing = true; for (const r of this.jobs.values()) if (fileTaskActive(r.task)) await this.control(r.task.id, 'cancel'); await Promise.allSettled([...this.jobs.values()].map(r => r.promise)) }
}
