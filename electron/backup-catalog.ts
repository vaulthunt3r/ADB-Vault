import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { BackupPart } from './app-backup-protocol.js'
import type { AndroidApp } from './apps-protocol.js'
import type { BadgeCheck } from './app-details-protocol.js'
import type { DeviceRecord } from './contracts.js'

export interface BackupCopy {
  identity: string; userId: number; packageName: string; versionName: string | null; versionCode: number
  createdAt: string; file: string; entry?: string; format: 'apk' | 'apks' | 'tar'; component?: BackupPart
}
interface SavedCopy extends BackupCopy { bytes: number; mtimeMs: number }
// Wi-Fi endpoints are reusable addresses, not physical device identities.
export function backupIdentity(device: DeviceRecord) {
  return device.hardwareId || (device.method === 'USB' ? device.serial : null)
}
export class BackupCatalog {
  private copies: SavedCopy[] = []
  private available = new Set<SavedCopy>()
  private loaded = false
  private pending = Promise.resolve()
  private refreshing?: Promise<void>
  constructor(private root: string) {}
  async load() {
    try {
      const file = path.join(this.root, 'backup-catalog.json')
      if ((await lstat(file)).size > 16_000_000) throw new Error('Oversized backup catalogue.')
      const data = JSON.parse(await readFile(file, 'utf8'))
      if (data.version !== 1 || !Array.isArray(data.copies)) throw new Error('Invalid backup catalogue.')
      this.copies = data.copies.filter((c: SavedCopy) => c && typeof c.identity === 'string' && c.identity.length <= 512
        && Number.isInteger(c.userId) && c.userId >= 0 && c.userId <= 99999
        && typeof c.packageName === 'string' && /^[\w]+(?:\.[\w]+)*$/.test(c.packageName)
        && Number.isSafeInteger(c.versionCode) && c.versionCode >= 0 && (c.versionName === null || typeof c.versionName === 'string')
        && typeof c.createdAt === 'string' && Number.isFinite(Date.parse(c.createdAt))
        && typeof c.file === 'string' && c.file.length <= 4096 && path.isAbsolute(c.file)
        && ['apk', 'apks', 'tar'].includes(c.format) && (c.component === undefined || ['apk', 'data', 'cache', 'obb', 'media'].includes(c.component)) && Number.isSafeInteger(c.bytes) && c.bytes > 0 && Number.isFinite(c.mtimeMs)
        && (c.entry === undefined || (typeof c.entry === 'string' && path.basename(c.entry) === c.entry && !/[\\/]/.test(c.entry))))
    } catch { /* Missing or damaged catalogue never establishes backup availability. */ }
    this.loaded = true
    await this.refresh()
  }
  // Called only after verified export publication. No paths supplied by the renderer.
  async record(copies: BackupCopy[], replacing: string[] = []) {
    const task = this.pending.catch(() => {}).then(async () => {
      const facts = new Map<string, { bytes: number; mtimeMs: number }>()
      const saved: SavedCopy[] = []
      for (const copy of copies) {
        let fact = facts.get(copy.file)
        if (!fact) {
          const info = await lstat(copy.file)
          if (!info.isFile() || info.size === 0) throw new Error('Backup artifact is unavailable.')
          fact = { bytes: info.size, mtimeMs: info.mtimeMs }; facts.set(copy.file, fact)
        }
        saved.push({ ...copy, ...fact })
      }
      const next = [...this.copies.filter(c => !replacing.includes(c.file)), ...saved]
      await mkdir(this.root, { recursive: true })
      const file = path.join(this.root, 'backup-catalog.json')
      await writeFile(file + '.tmp', JSON.stringify({ version: 1, copies: next }))
      await rename(file + '.tmp', file)
      this.copies = next
      for (const c of saved) this.available.add(c)
      this.loaded = true
    })
    this.pending = task
    return task
  }
  refresh() {
    if (this.refreshing) return this.refreshing
    const task = (async () => {
      await this.pending.catch(() => {})
      const copies = this.copies, available = new Set<SavedCopy>()
      const files = new Map<string, Awaited<ReturnType<typeof lstat>> | null>()
      for (const c of copies) {
        if (!files.has(c.file)) files.set(c.file, await lstat(c.file).catch(() => null))
        const info = files.get(c.file)
        // Cheap availability check, not a new SHA-256 integrity verification.
        if (info?.isFile() && info.size === c.bytes && info.mtimeMs === c.mtimeMs) available.add(c)
      }
      // A publication may have finished while disk checks were in flight.
      if (this.copies === copies) this.available = available
    })().finally(() => { if (this.refreshing === task) this.refreshing = undefined })
    this.refreshing = task
    return task
  }
  check(device: DeviceRecord | undefined, app: AndroidApp): BadgeCheck {
    const identity = device && backupIdentity(device)
    if (!this.loaded || !identity) return { present: null, reason: !this.loaded ? 'Local backup catalogue has not been checked.' : 'A stable device identity is required to match local backups.', items: [] }
    const copies = this.copies.filter(c => c.identity === identity && c.userId === app.userId && c.packageName === app.packageName && this.available.has(c)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return {
      present: copies.length > 0,
      reason: copies.length ? 'Files saved by ADB Vault for this device and profile. Each copy lists its actual contents. Matching app versions do not prove that app data is unchanged. File presence, size and modification time checked; contents are not rehashed on each check.' : 'No available registered backup for this device and profile. Older exports are not indexed; missing, moved or modified files are excluded.',
      items: copies.flatMap((c, i) => [
        { name: `Copy ${i + 1}`, value: `${c.format.toUpperCase()}${c.entry ? ' inside ZIP' : ''} · ${c.createdAt}` },
        { name: 'Contents', value: ({ apk: 'APK installation files', data: 'App data (without cache)', cache: 'Cache and code cache', obb: 'OBB', media: 'Media' })[c.component || 'apk'] },
        { name: 'Version', value: `${c.versionName || 'Unknown'} (${c.versionCode}) · ${c.versionCode === app.versionCode && c.versionName === app.versionName ? 'Matches installed version' : 'Different from installed version'}` },
        { name: 'Location', value: c.file, backupFile: c.file },
        ...(c.entry ? [{ name: 'Archive entry', value: c.entry }] : []),
      ]),
    }
  }
  async revealPath(file: string) {
    const copy = this.copies.find(c => c.file === file)
    if (!this.loaded || !copy) throw new Error('This backup is not in the local catalogue. Refresh the backup information.')
    const info = await lstat(copy.file).catch(() => null)
    if (!info?.isFile()) throw new Error('The backup file was moved or deleted. Refresh the backup information.')
    return copy.file
  }
  async flush() { await this.pending.catch(() => {}); await this.refreshing }
}
