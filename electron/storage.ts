import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { validEvidence, type PackageActionEvidence } from './package-actions-protocol.js'
import type { ComponentId, DeviceRecord } from './contracts.js'
import { defaultAppsOptions, type AppsOptions } from './apps-protocol.js'
import type { ExportDestinationSettings } from './app-backup-protocol.js'
import { notificationSettings, type NotificationSettings } from './notifications-protocol.js'
export interface Settings { packageActionEvidence?: PackageActionEvidence[]; notifications?: NotificationSettings; paths: Partial<Record<ComponentId, string>>; known: DeviceRecord[]; appsLoadingMode?: 'selected' | 'preload'; appsOptions?: AppsOptions; stopAdbOnExit?: boolean; apkZstd?: boolean; exportDestination?: ExportDestinationSettings }
export class Storage {
  data: Settings = { paths: {}, known: [] }
  private pending = Promise.resolve()
  constructor(readonly root: string) {}
  async load() {
    await mkdir(this.root, { recursive: true })
    try {
      const saved = JSON.parse(await readFile(path.join(this.root, 'backend.json'), 'utf8'))
      this.data.packageActionEvidence = Array.isArray(saved.packageActionEvidence) ? saved.packageActionEvidence.filter(validEvidence).slice(-1000) : []
      this.data.notifications = notificationSettings(saved.notifications)
      if (typeof saved.stopAdbOnExit === 'boolean') this.data.stopAdbOnExit = saved.stopAdbOnExit
      this.data.apkZstd = saved.apkZstd === true
      const folder = saved.exportDestination?.folder
      const validFolder = typeof folder === 'string' && folder.length <= 4096 && !/[\x00-\x1f]/.test(folder) && path.isAbsolute(folder)
      this.data.exportDestination = { mode: saved.exportDestination?.mode === 'fixed' && validFolder ? 'fixed' : 'ask', folder: validFolder ? folder : null }
      this.data.appsLoadingMode = saved.appsLoadingMode === 'preload' ? 'preload' : 'selected'
      this.data.appsOptions = defaultAppsOptions()
      for (const key of ['icons', 'early', 'storage', 'root'] as const) if (typeof saved.appsOptions?.[key] === 'boolean') this.data.appsOptions[key] = saved.appsOptions[key]
      if (saved.paths && typeof saved.paths === 'object') for (const id of ['adb', 'fastboot', 'driver', 'runtime', 'scrcpy'] as ComponentId[]) {
        if (typeof saved.paths[id] === 'string' && path.isAbsolute(saved.paths[id])) this.data.paths[id] = saved.paths[id]
        const relative = saved.managedPaths?.[id]
        if (typeof relative === 'string' && !path.isAbsolute(relative)) {
          const resolved = path.resolve(this.root, relative)
          if (this.managedRelativePath(resolved)) this.data.paths[id] = resolved
        }
      }
      if (Array.isArray(saved.known)) this.data.known = saved.known.filter((d: DeviceRecord) => typeof d.id === 'string' && typeof d.serial === 'string' && typeof d.name === 'string' && ['USB', 'Wi-Fi', 'Emulator'].includes(d.method)).slice(0, 100).map((d: DeviceRecord) => ({ ...d, status: 'disconnected', canDetach: false }))
    } catch { /* Missing or damaged preferences must not prevent startup. */ }
  }
  flush() { return this.pending }
  private managedRelativePath(folder: string): string | undefined {
    const relative = path.relative(path.join(this.root, 'components'), folder)
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return undefined
    return path.relative(this.root, folder)
  }
  save() {
    // Keep external tools absolute, but managed downloads relocatable. Existing
    // installed profiles retain their paths and need no migration or copying.
    const managedPaths = Object.fromEntries(Object.entries(this.data.paths)
      .flatMap(([id, folder]) => {
        const relative = folder && this.managedRelativePath(folder)
        return relative ? [[id, relative]] : []
      }))
    const json = JSON.stringify({ ...this.data, managedPaths }, null, 2)
    const target = path.join(this.root, 'backend.json')
    this.pending = this.pending.catch(() => {}).then(async () => { await writeFile(target + '.tmp', json); await rename(target + '.tmp', target) })
    return this.pending
  }
}
