export const backupFormats = ['auto', 'apk', 'apks', 'zip', 'files'] as const
export type BackupFormat = typeof backupFormats[number]
export interface ExportDestinationSettings { mode: 'ask' | 'fixed'; folder: string | null }
export const backupParts = ['apk', 'data', 'cache', 'obb', 'media'] as const
export type BackupPart = typeof backupParts[number]
export type BackupContents = Record<BackupPart, boolean>
export const defaultBackupContents = (): BackupContents => ({ apk: true, data: false, cache: false, obb: false, media: false })
export interface BackupRequest { id: string; userId: number; packages: string[]; name?: string; folderName?: string; format: BackupFormat; zip?: boolean; contents?: BackupContents; stopApps?: boolean; allowPartial?: boolean }
export interface AppPreset {
  format: 'adb-vault-app-preset'; version: 1; name: string; createdAt: string
  device: { name: string; identity: string }; profile: { id: number; name: string }
  applications: { packageName: string; label: string }[]
}
export interface PresetPreview {
  token: string; id: string; userId: number; preset: AppPreset
  matched: string[]; missing: string[]
}
export interface BackupItem {
  packageName: string; label: string; status: 'pending' | 'running' | 'success' | 'skipped' | 'error' | 'cancelled'; message?: string
  folder?: string
  artifact?: string
  artifacts?: { component: BackupPart; file: string; sha256: string; bytes: number }[]
  parts?: { component: BackupPart; status: 'saved' | 'absent' | 'error'; message?: string }[]
}
export interface BackupState {
  operationId?: string; startedAt?: string
  id: string; userId: number; name: string; format: BackupFormat; operation: 'backup' | 'preset'
  status: 'running' | 'complete' | 'partial' | 'cancelled' | 'error'; message: string
  items: BackupItem[]; outputDirectory?: string; presetPath?: string
  zip?: boolean; phase?: 'archiving' | 'data'; archivePath?: string
  contents?: BackupContents; stopApps?: boolean; allowPartial?: boolean
  completed: number; total: number; currentFile?: { completed: number; total: number }
}
