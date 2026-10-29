export const appActionIds = ['install-existing', 'launch', 'settings', 'notifications', 'open-links', 'export', 'force-stop', 'suspend', 'unsuspend', 'enable', 'disable', 'uninstall', 'clear-cache', 'clear-data', 'clear-obb', 'clear-media'] as const
export type AppActionId = typeof appActionIds[number]
export const cleanupParts = ['data', 'cache', 'obb', 'media'] as const
export type CleanupPart = typeof cleanupParts[number]
export const cleanupLabels: Record<CleanupPart, string> = { data: 'App data', cache: 'Cache', obb: 'OBB', media: 'Media' }
export const batchActionIds = ['force-stop', 'suspend', 'unsuspend', 'enable', 'disable', 'clear-cache', 'clear-data', 'clear-obb', 'clear-media', 'clear-storage', 'uninstall'] as const
export type BatchActionId = typeof batchActionIds[number]
export const batchActionLabels: Record<BatchActionId, string> = { 'force-stop': 'Force stop', suspend: 'Freeze', unsuspend: 'Unfreeze', enable: 'Enable', disable: 'Disable', 'clear-cache': 'Clear cache', 'clear-data': 'Clear app data', 'clear-obb': 'Clear OBB', 'clear-media': 'Clear media', 'clear-storage': 'Clear storage', uninstall: 'Uninstall from profile' }
export interface BatchActionRequest { id: string; userId: number; packages: string[]; action: BatchActionId; cleanup?: CleanupPart[]; options?: import('./package-actions-protocol.js').PackageActionOptions }
export interface CleanupStep { part: CleanupPart; status: 'pending' | 'running' | 'success' | 'error' | 'cancelled'; message: string; uncertain?: boolean }
export interface BatchActionItem { packageName: string; label: string; uid: number; versionCode: number; system: boolean; status: 'pending' | 'running' | 'success' | 'error' | 'skipped' | 'cancelled'; message: string; uncertain?: boolean; steps?: CleanupStep[] }
export function batchSkipReason(action: BatchActionId, app: import('./apps-protocol.js').AndroidApp, apps: import('./apps-protocol.js').AndroidApp[]) {
  if (action === 'suspend' && app.suspended) return 'Already frozen (Suspended)'
  if (action === 'suspend' && !app.enabled) return 'Already disabled'
  if (action === 'unsuspend' && !app.suspended) return 'Not frozen'
  if (action === 'enable' && app.enabled) return 'Already enabled'
  if (action === 'disable' && !app.enabled) return 'Already disabled'
  if (action.startsWith('clear-')) {
    if (!Number.isSafeInteger(app.uid) || app.uid % 100000 < 10000) return 'Core Android UID: cleanup unavailable'
    if (apps.some(a => a.packageName !== app.packageName && a.uid === app.uid)) return 'Shared Android UID: cleanup unavailable'
  }
  return null
}
export interface AppActionTarget { id: string; userId: number; packageName: string }
export interface AppActionState extends AppActionTarget {
  options?: import('./package-actions-protocol.js').PackageActionOptions
  uncertain?: boolean
  operationId?: string; startedAt?: string
  action: AppActionId | 'clear-storage' | 'permission'
  permission?: string
  status: 'running' | 'success' | 'error' | 'cancelled'
  message: string
  completed?: number
  total?: number
  exportPath?: string
  batch?: { items: BatchActionItem[]; stopRequested: boolean; deviceName: string; profileName: string; cleanup?: CleanupPart[] }
}
