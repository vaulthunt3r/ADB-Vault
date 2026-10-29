import type { BackupPart } from './app-backup-protocol.js'

export interface RestoreApplication {
  packageName: string; label: string; versionName: string | null; versionCode: number
  components: BackupPart[]; installable: boolean
}
export interface RestoreBatchItem {
  packageName: string; label: string; versionCode: number; components: BackupPart[]; completed: BackupPart[]
  status: 'pending' | 'running' | 'success' | 'error' | 'partial' | 'skipped' | 'cancelled'
  message: string; uncertain?: boolean; recoveryPaths?: string[]
}
export interface RestoreBatchRequest { packages: string[]; components: BackupPart[] }
export const canRetryRestore = (item: RestoreBatchItem) => ['error', 'partial', 'cancelled'].includes(item.status) && !item.uncertain && !item.recoveryPaths?.length && item.components.some(p => !item.completed.includes(p))
export interface RestoreState {
  operationId?: string; startedAt?: string
  sourceKind?: 'install'
  id: string; userId: number; deviceName: string; profileName: string
  status: 'opening' | 'choosing' | 'verifying' | 'ready' | 'confirming' | 'installing' | 'restoring' | 'batch' | 'partial' | 'success' | 'error' | 'cancelled'
  message: string; source?: string; sourceDevice?: string; sourceProfile?: string; createdAt?: string
  applications: RestoreApplication[]; packageName?: string; token?: string
  operation?: 'apk' | 'files' | 'batch'; selectedParts?: Exclude<BackupPart, 'apk'>[]; restoredParts?: string[]; recoveryPaths?: string[]; uncertain?: boolean
  batch?: { items: RestoreBatchItem[]; finished: number; stopRequested: boolean }
  verifiedComponents?: BackupPart[]; apkCount?: number
}
export const restoreBusy = (state?: RestoreState | null) => !!state && ['opening', 'verifying', 'confirming', 'installing', 'restoring', 'batch'].includes(state.status)
