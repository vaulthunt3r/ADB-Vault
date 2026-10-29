import type { ActivitySource } from './contracts.js'
import type { ActivityOperation } from './activity-operation.js'
import type { FailureDiagnostic } from './failure-diagnostics-protocol.js'
import type { FileTask } from './files-protocol.js'

export interface ActivityItem {
  id: number; sessionId?: string; time: string; text: string; tone: 'info' | 'success' | 'warning'
  source: ActivitySource; device?: string; deviceName?: string; operation?: ActivityOperation
  diagnostic?: FailureDiagnostic; endedAt?: string; interrupted?: boolean; message?: string
}
export interface HistorySession {
  id: string; startedAt: string; updatedAt: string; endedAt?: string
  status: 'open' | 'closed' | 'interrupted'; pid: number; activityCount: number; taskCount: number; unfinished: number
}
export interface SavedSession {
  version: 1; session: HistorySession; activity: ActivityItem[]; tasks: FileTask[]
  pending: { id: string; label: string; startedAt: string; source: ActivitySource; device?: string }[]
}
export interface HistoryOverview { current: HistorySession; sessions: HistorySession[]; error?: string; activity?: ActivityItem[] }
export interface HistorySnapshot extends HistoryOverview { activity: ActivityItem[] }
export const historyLimits = { sessions: 30, activity: 500, tasks: 100 }
export const historySessionLabel = (session: HistorySession) => `${new Date(session.startedAt).toLocaleString()} · ${session.status === 'closed' ? 'Closed normally' : session.status === 'interrupted' ? 'Interrupted' : 'Running'} · ${session.id.slice(0, 8)}`
