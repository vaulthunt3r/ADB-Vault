import { readFile, mkdir, writeFile, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ComponentRecord } from './contracts.js'
import { type DatabaseId } from './database-protocol.js'
import { databaseFiles, parseDatabase, type DatabaseFile, type SignatureDatabase } from './signature-database.js'

const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
const externalBundle = resources && path.join(resources, 'detection-databases')
export const bundledDatabaseDirectory = externalBundle && existsSync(path.join(externalBundle, 'manifest.json')) ? externalBundle : fileURLToPath(new URL('./data/app-manager/', import.meta.url))
import { databaseCatalog, databaseSourceUrl } from './catalog.js'
export type DatabaseManifest = { revision: string; source: string; files: Record<DatabaseFile, { path: string; sha256: string }> }
export async function loadDatabase(directory: string) {
  const manifest: DatabaseManifest = JSON.parse((await readFile(path.join(directory, 'manifest.json'), 'utf8')).replace(/^\uFEFF/, ''))
  const files = {} as Record<DatabaseFile, string>
  for (const name of Object.keys(databaseFiles) as DatabaseFile[]) {
    const buffer = await readFile(path.join(directory, name))
    if (buffer.length > 8_000_000 || createHash('sha256').update(buffer).digest('hex') !== manifest.files?.[name]?.sha256) throw new Error(`Database integrity check failed: ${name}`)
    files[name] = buffer.toString('utf8')
  }
  return parseDatabase(files, manifest.revision)
}
async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'error', headers: { 'User-Agent': 'ADB-Vault', Accept: 'application/vnd.github+json' } })
  if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') throw new Error('GitHub update-check limit reached. Try again later; the active databases remain available.')
  if (!response.ok || Number(response.headers.get('content-length')) > 8_000_000) throw new Error(`Database download failed (${response.status}).`)
  if (!response.body) throw new Error('Empty database response.')
  const chunks: Uint8Array[] = []; let size = 0
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.length
    if (size > 8_000_000) { await response.body.cancel().catch(() => {}); throw new Error('Database exceeds size limit.') }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}
export class DatabaseService {
  records = databaseCatalog.map(r => ({ ...r }))
  data?: SignatureDatabase
  private pending = false
  private latest?: string
  private directory: string
  constructor(private root: string, private publish: () => void, private fetcher = fetchText, private bundled = bundledDatabaseDirectory) { this.directory = bundled }
  private update(patch: Partial<ComponentRecord>) { this.records = this.records.map(r => ({ ...r, ...patch })); this.publish() }
  private ready(message: string) {
    const lists = [this.data!.trackers, this.data!.libraries, this.data!.native, this.data!.bloatware]
    const sizes = this.data!.sizes, bytes = [sizes['trackers.xml'], sizes['libs.xml'], sizes['native_libs.xml'], sizes['debloat.json'] + sizes['suggestions.json']]
    this.records = this.records.map((r, i) => ({ ...r, status: this.latest && this.latest !== this.data!.revision ? 'Update available' : 'Installed', version: this.data!.revision.slice(0, 12), targetVersion: this.latest?.slice(0, 12) ?? '—', size: bytes[i] >= 1048576 ? `${(bytes[i] / 1048576).toFixed(1)} MB` : `${Math.ceil(bytes[i] / 1024)} KB`, location: this.directory, message: `${lists[i].length.toLocaleString('en-US')} entries. ${message} Revision: ${this.data!.revision}. Licence: ${i === 3 ? 'AGPL-3.0-or-later' : 'GPL-3.0-or-later'}. All four databases are updated together to keep a consistent snapshot.`, progress: 0, sourceUrl: databaseSourceUrl(r.id as DatabaseId, this.data!.revision) }))
    this.publish()
  }
  async initialize() {
    let warning = ''
    try {
      const active = JSON.parse(await readFile(path.join(this.root, 'databases', 'active.json'), 'utf8'))
      if (active.directory === 'bundled') { this.directory = this.bundled; this.data = await loadDatabase(this.bundled); this.ready('Bundled snapshot.'); return }
      if (!/^[a-f0-9-]{36}$/.test(active.directory)) throw new Error('Invalid database location.')
      this.directory = path.join(this.root, 'databases', active.directory)
      this.data = await loadDatabase(this.directory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') warning = 'Saved database could not be verified; bundled snapshot restored. '
      this.directory = this.bundled
      try { this.data = await loadDatabase(this.bundled) }
      catch (error) { this.update({ status: 'Repair needed', message: `No verified database available. ${String(error)}` }); return }
    }
    this.ready(`${warning}${this.directory === this.bundled ? 'Bundled snapshot.' : 'Downloaded snapshot.'}`)
  }
  async action(_id: DatabaseId, action: 'detect' | 'install' | 'repair') {
    if (this.pending) throw new Error('A database operation is already running.')
    this.pending = true
    try {
      this.update({ status: action === 'install' ? 'Downloading' : 'Checking', message: action === 'repair' ? 'Restoring bundled databases…' : 'Checking official App Manager datasets…' })
      if (action === 'repair') {
        const data = await loadDatabase(this.bundled)
        await this.savePointer(null)
        this.data = data; this.directory = this.bundled
        this.ready('Bundled snapshot restored.'); return
      }
      const commit = JSON.parse(await this.fetcher('https://api.github.com/repos/MuntashirAkon/AppManager/commits/master'))
      if (!/^[a-f0-9]{40}$/.test(commit.sha)) throw new Error('Invalid upstream revision.')
      const revision: string = commit.sha
      if (this.data?.revision === revision) { this.latest = revision; this.ready('Already up to date.'); return }
      const files = {} as Record<DatabaseFile, string>
      const manifest: DatabaseManifest = { revision, source: 'https://github.com/MuntashirAkon/AppManager', files: {} as DatabaseManifest['files'] }
      for (const name of Object.keys(databaseFiles) as DatabaseFile[]) {
        files[name] = await this.fetcher(`https://raw.githubusercontent.com/MuntashirAkon/AppManager/${revision}/${databaseFiles[name]}`)
        manifest.files[name] = { path: databaseFiles[name], sha256: createHash('sha256').update(files[name]).digest('hex') }
      }
      const data = parseDatabase(files, revision) // Validate the entire set before making any of it active.
      if (this.data) {
        const active: DatabaseManifest = JSON.parse((await readFile(path.join(this.directory, 'manifest.json'), 'utf8')).replace(/^\uFEFF/, ''))
        const changed = (Object.keys(databaseFiles) as DatabaseFile[]).some(name => active.files[name].sha256 !== manifest.files[name].sha256)
        if (!changed) { this.latest = this.data.revision; this.ready('Databases are up to date; upstream code changes do not change this dataset.'); return }
        this.latest = revision
        if (action === 'detect') { this.ready('A verified database update is available.'); return }
      }
      this.latest = revision
      const id = randomUUID(), directory = path.join(this.root, 'databases', id)
      await mkdir(directory, { recursive: true })
      for (const name of Object.keys(databaseFiles) as DatabaseFile[]) await writeFile(path.join(directory, name), files[name], 'utf8')
      await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest), 'utf8')
      for (const name of ['NOTICE.md', 'GPL-3.0.txt', 'AGPL-3.0.txt']) await writeFile(path.join(directory, name), await readFile(path.join(this.bundled, name)))
      await loadDatabase(directory)
      await this.savePointer(id)
      this.data = data; this.directory = directory; this.ready('Updated from official App Manager sources.')
    } catch (error) {
      this.update({ status: this.data ? this.latest && this.latest !== this.data.revision ? 'Update available' : 'Installed' : 'Download failed', message: `${String(error)} ${this.data ? 'The previous verified database remains active.' : 'No verified database is available.'}` })
      throw error
    } finally { this.pending = false }
  }
  private async savePointer(directory: string | null) {
    const folder = path.join(this.root, 'databases'); await mkdir(folder, { recursive: true })
    const target = path.join(folder, 'active.json')
    await writeFile(`${target}.tmp`, JSON.stringify({ directory: directory ?? 'bundled' }))
    await rename(`${target}.tmp`, target)
  }
}
