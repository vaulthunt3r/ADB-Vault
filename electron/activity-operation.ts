import type { AppActionState } from './app-actions-protocol.js'
import type { BackupState } from './app-backup-protocol.js'
import { restoreBusy, type RestoreState } from './app-restore-protocol.js'
import { batchActionLabels, cleanupLabels } from './app-actions-protocol.js'
import type { AppsSnapshot } from './apps-protocol.js'

export type OperationStatus = 'running' | 'success' | 'partial' | 'error' | 'cancelled' | 'interrupted'
export interface ActivityOperation {
  key: string; kind: 'action' | 'backup' | 'restore'; startedAt: string; title: string; status: OperationStatus
  deviceId: string; deviceName: string; userId: number; profileName: string; message: string
  items: { packageName: string; label: string; iconPng?: string; status: string; message: string; uncertain?: boolean }[]
}
export interface ActivityApplication { label: string; iconPng?: string }
export function activityIcon(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 131072 && /^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(value) ? value : undefined
}
// Capture identity at the start of this operation, before removal or a profile switch.
export function operationApplications(op: ActivityOperation, apps?: Pick<AppsSnapshot, 'deviceId' | 'userId' | 'apps' | 'removedApps'>): Map<string, ActivityApplication> {
  if (apps?.deviceId !== op.deviceId || apps.userId !== op.userId) return new Map()
  const packages = new Set(op.items.map(i => i.packageName))
  return new Map([...apps.apps, ...(apps.removedApps || [])].filter(a => a.userId === op.userId && packages.has(a.packageName)).map(a => [a.packageName, { label: a.label, iconPng: activityIcon(a.iconPng) }]))
}
export function identifyOperation(op: ActivityOperation, applications: Map<string, ActivityApplication>, previous?: ActivityOperation): ActivityOperation {
  const saved = new Map(previous?.items.map(i => [i.packageName, i]))
  return { ...op, items: op.items.map(item => {
    const app = applications.get(item.packageName) || saved.get(item.packageName)
    // Only failed/uncertain identities need a persisted icon; ordinary progress stays small.
    const failed = ['error', 'partial', 'interrupted'].includes(item.status) || item.uncertain
    return { ...item, label: app?.label || item.label, ...(failed ? { iconPng: activityIcon(app?.iconPng || item.iconPng) } : {}) }
  }) }
}
export function actionOperation(s: AppActionState, deviceName: string, profileName: string): ActivityOperation | null {
  if (!s.operationId) return null
  return { key: s.operationId, kind: 'action', startedAt: s.startedAt!, title: batchActionLabels[s.action as keyof typeof batchActionLabels] || ({ 'install-existing': 'Restore to profile', permission: 'Change permission', launch: 'Launch application', settings: 'Open app settings', notifications: 'Notification settings', 'open-links': 'Open by default', 'clear-obb': 'Clear OBB', 'clear-media': 'Clear media', export: 'Export APK' } as Record<string, string>)[s.action] || s.action,
    status: s.status === 'error' && s.batch?.items.some(i => i.status === 'success' || i.steps?.some(step => step.status === 'success')) ? 'partial' : s.status,
    deviceId: s.id, deviceName: s.batch?.deviceName || deviceName, userId: s.userId, profileName: s.batch?.profileName || profileName, message: s.message,
    items: s.batch?.items.map(i => ({ ...i, message: i.steps && i.status !== 'skipped' ? i.steps.map(step => `${cleanupLabels[step.part]}: ${step.status} — ${step.message}`).join('\n') : i.message })) || [{ packageName: s.packageName, label: s.packageName, status: s.status, message: s.message, uncertain: s.uncertain }] }
}
export function backupOperation(s: BackupState, deviceName: string, profileName: string): ActivityOperation | null {
  if (!s.operationId) return null
  return { key: s.operationId, kind: 'backup', startedAt: s.startedAt!, title: s.operation === 'preset' ? 'Save preset' : 'Backup', status: s.status === 'complete' ? 'success' : s.status,
    deviceId: s.id, deviceName, userId: s.userId, profileName, message: [s.message, s.archivePath || s.presetPath || s.outputDirectory].filter(Boolean).join('\n'), items: s.items.map(i => ({ ...i, message: [i.message, i.artifact, ...(i.parts || []).map(p => `${p.component}: ${p.status}${p.message ? ` — ${p.message}` : ''}`)].filter(Boolean).join('\n') })) }
}
export function restoreOperation(s: RestoreState): ActivityOperation | null {
  // File selection/verification is preparation, not a completed restore operation.
  if (!s.operationId || !s.operation) return null
  return { key: s.operationId, kind: 'restore', startedAt: s.startedAt!, title: s.sourceKind === 'install' ? 'Install' : 'Restore', status: restoreBusy(s) ? 'running' : s.status === 'success' ? 'success' : s.status === 'partial' ? 'partial' : s.status === 'cancelled' || s.status === 'ready' ? 'cancelled' : 'error',
    deviceId: s.id, deviceName: s.deviceName, userId: s.userId, profileName: s.profileName, message: s.message,
    items: s.batch?.items.map(i => ({ ...i, message: [i.message, ...(i.recoveryPaths || [])].join('\n') })) || [{ packageName: s.packageName || '', label: s.applications.find(a => a.packageName === s.packageName)?.label || s.packageName || 'Application', status: restoreBusy(s) ? 'running' : s.status === 'ready' ? 'cancelled' : s.status, message: [s.message, ...(s.recoveryPaths || [])].join('\n'), uncertain: s.uncertain }] }
}
export function operationSummary(op: ActivityOperation) {
  if (op.status === 'interrupted') return `${op.title} · ${op.items.filter(i => i.status === 'success').length} completed · Interrupted — verify result`
  const n = (status: string) => op.items.filter(i => i.status === status).length
  return `${op.title} · ${op.status === 'running' ? `${n('success')} / ${op.items.length}` : `${n('success')} completed${n('error') + n('partial') ? ` · ${n('error') + n('partial')} failed` : ''}${n('skipped') ? ` · ${n('skipped')} skipped` : ''}${n('cancelled') ? ` · ${n('cancelled')} not started` : ''}`}`
}
