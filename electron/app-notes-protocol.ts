import type { AppActionTarget } from './app-actions-protocol.js'

export interface AppNoteOrigin {
  deviceName: string; model: string; android: string; build: string; fingerprint: string
  profileName: string; userId: number; appLabel: string; versionName: string; versionCode: number
}
export interface AppNote {
  id: string; packageName: string; label: string; text: string; color: string
  createdAt: string; updatedAt: string; origin: AppNoteOrigin | null
}
export interface AppNotesState { status: 'loading' | 'ready' | 'error'; entries: AppNote[]; error: string | null }
export interface AppNoteDraft { id?: string; expectedUpdatedAt?: string; packageName: string; label: string; text: string; color: string; target?: AppActionTarget }
export type AppNotesRequest = { type: 'apps.notesSave'; note: AppNoteDraft } | { type: 'apps.notesDelete'; id: string; expectedUpdatedAt: string } | { type: 'apps.notesExport' | 'apps.notesImport' }
export const maxAppNotes = 10000
export const maxAppNotesBytes = 16 * 1024 * 1024
const bounded = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)
export const validNoteId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id)
export const validNoteDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value))
export function validateAppNoteDraft(value: AppNoteDraft) {
  if (!value || !bounded(value.packageName, 255) || !/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/.test(value.packageName)
    || !bounded(value.label, 60) || /[\r\n\t]/.test(value.label) || !bounded(value.text, 8000) || !(value.label.trim() || value.text.trim())
    || typeof value.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(value.color)
    || value.id !== undefined && (!validNoteId(value.id) || !validNoteDate(value.expectedUpdatedAt))) throw new Error('Enter a package name and a label or note, within the displayed limits.')
}
function parseOrigin(value: unknown): AppNoteOrigin | null {
  if (value === null) return null
  if (!value || typeof value !== 'object') throw new Error('Invalid personal record origin.')
  const origin = value as AppNoteOrigin
  const keys = ['deviceName', 'model', 'android', 'build', 'fingerprint', 'profileName', 'appLabel', 'versionName'] as const
  if (keys.some(key => !bounded(origin[key], 1024)) || !Number.isSafeInteger(origin.userId) || origin.userId < 0 || origin.userId > 99999 || !Number.isSafeInteger(origin.versionCode) || origin.versionCode < 0) throw new Error('Invalid personal record origin.')
  return { ...Object.fromEntries(keys.map(key => [key, origin[key]])) as Pick<AppNoteOrigin, typeof keys[number]>, userId: origin.userId, versionCode: origin.versionCode }
}
export function parseAppNotes(value: unknown): AppNote[] {
  const file = value as { format?: unknown; version?: unknown; entries?: unknown }
  if (!file || file.format !== 'adb-vault-personal-records' || file.version !== 1 || !Array.isArray(file.entries) || file.entries.length > maxAppNotes) throw new Error('Unsupported personal database file.')
  const seen = new Set<string>()
  return file.entries.map((row: AppNote) => {
    validateAppNoteDraft({ ...row, expectedUpdatedAt: row?.updatedAt })
    if (!validNoteId(row.id) || seen.has(row.id) || !validNoteDate(row.createdAt) || !validNoteDate(row.updatedAt) || row.updatedAt < row.createdAt) throw new Error('Invalid or duplicate personal record.')
    seen.add(row.id)
    return { id: row.id, packageName: row.packageName, label: row.label.trim(), text: row.text.trim(), color: row.color.toLowerCase(), createdAt: row.createdAt, updatedAt: row.updatedAt, origin: parseOrigin(row.origin) }
  })
}
export const appNotesFile = (entries: AppNote[]) => ({ format: 'adb-vault-personal-records', version: 1, entries })
