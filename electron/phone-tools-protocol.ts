import type { DeviceRecord } from './contracts.js'

export type PhoneToolsTarget = Pick<DeviceRecord, 'id' | 'serial' | 'transportId'>
export type PhoneDataKind = 'contacts' | 'calls' | 'sms'
export type PhoneExportFormat = 'vcf' | 'csv' | 'json' | 'html'
export const phoneDataLabels: Record<PhoneDataKind, string> = { contacts: 'contacts', calls: 'call log', sms: 'SMS' }
export const phoneExportFormats: Record<PhoneDataKind, PhoneExportFormat[]> = { contacts: ['vcf', 'csv'], calls: ['csv', 'json'], sms: ['json', 'html'] }
export const PHONE_RECORD_LIMIT = 20000
export const PHONE_TEXT_LIMIT = 262144
export interface PhoneDateRange { from?: number; to?: number }
export interface ContactRecord {
  kind: 'contacts'; id: string; name: string; phones: string[]; emails: string[]; organizations: string[]; vcard: string
}
export interface CallRecord {
  kind: 'calls'; id: string; number: string; name: string; date: number; duration: number; type: number; account: string
}
export interface SmsRecord {
  kind: 'sms'; id: string; address: string; date: number; dateSent: number; type: number; body: string; read: boolean; subscription: string; threadId: string
}
export type PhoneDataRecord = ContactRecord | CallRecord | SmsRecord
export interface PhoneDataSnapshot {
  id: string; kind: PhoneDataKind; target: PhoneToolsTarget; deviceName: string; userId: number
  capturedAt: string; range: PhoneDateRange; rows: PhoneDataRecord[]
}
export interface PhoneToolsJob {
  id: string; kind: PhoneDataKind | 'clipboard'; action: 'read' | 'write' | 'export'; target: PhoneToolsTarget; deviceName: string
  status: 'running' | 'success' | 'error' | 'cancelled'; message: string; startedAt: string; endedAt?: string
  completed?: number; total?: number; output?: string
}
export interface PhoneToolsState {
  revision: number; job: PhoneToolsJob | null; data: PhoneDataSnapshot | null
  clipboard: { id: string; target: PhoneToolsTarget; text: string; userId: number } | null
}
export type PhoneToolsRequest =
  | { type: 'phoneTools.read'; kind: PhoneDataKind; target: PhoneToolsTarget; range: PhoneDateRange }
  | { type: 'phoneTools.clipboard.read'; target: PhoneToolsTarget }
  | { type: 'phoneTools.clipboard.write'; target: PhoneToolsTarget; text: string }
  | { type: 'phoneTools.export'; snapshotId: string; ids: string[] | 'all'; format: PhoneExportFormat }
  | { type: 'phoneTools.cancel' | 'phoneTools.reveal'; jobId: string }
  | { type: 'phoneTools.clear' }

export function samePhoneTarget(a: PhoneToolsTarget | null | undefined, b: PhoneToolsTarget | null | undefined) {
  return !!a && !!b && a.id === b.id && a.serial === b.serial && a.transportId === b.transportId
}
export function validatePhoneTarget(value: unknown): asserts value is PhoneToolsTarget {
  const target = value as PhoneToolsTarget | undefined
  if (!target || typeof target !== 'object' || ['id', 'serial'].some(key => {
    const text = target[key as 'id' | 'serial']
    return typeof text !== 'string' || !text || text.length > 512 || /[\x00-\x1f]/.test(text)
  }) || target.transportId !== undefined && (typeof target.transportId !== 'string' || !/^\d{1,20}$/.test(target.transportId))) throw new Error('Invalid phone connection.')
}
export function validatePhoneText(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.includes('\0') || new TextEncoder().encode(value).length > PHONE_TEXT_LIMIT) throw new Error('Clipboard text must be at most 256 KiB and contain no null characters.')
}
export function validatePhoneToolsRequest(value: Record<string, unknown>) {
  const uuid = (id: unknown) => typeof id === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)
  switch (value.type) {
    case 'phoneTools.read': {
      validatePhoneTarget(value.target)
      if (!['contacts', 'calls', 'sms'].includes(String(value.kind))) throw new Error('Unsupported phone data.')
      const range = value.range as PhoneDateRange
      if (!range || typeof range !== 'object' || Array.isArray(range)
        || [range.from, range.to].some(date => date !== undefined && (!Number.isSafeInteger(date) || date < 0 || date > 4102444800000))
        || range.from !== undefined && range.to !== undefined && range.from >= range.to
        || value.kind === 'contacts' && (range.from !== undefined || range.to !== undefined)) throw new Error('Invalid date range.')
      break
    }
    case 'phoneTools.clipboard.read': validatePhoneTarget(value.target); break
    case 'phoneTools.clipboard.write': validatePhoneTarget(value.target); validatePhoneText(value.text); break
    case 'phoneTools.export':
      if (!uuid(value.snapshotId) || !['vcf', 'csv', 'json', 'html'].includes(String(value.format))) throw new Error('Invalid phone data export.')
      if (value.ids !== 'all' && (!Array.isArray(value.ids) || !value.ids.length || value.ids.length > PHONE_RECORD_LIMIT
        || value.ids.some(id => typeof id !== 'string' || !/^\d{1,20}$/.test(id)) || new Set(value.ids).size !== value.ids.length)) throw new Error('Select records to export.')
      break
    case 'phoneTools.cancel': case 'phoneTools.reveal': if (!uuid(value.jobId)) throw new Error('Invalid phone operation.'); break
    case 'phoneTools.clear': break
    default: throw new Error('Unsupported phone action.')
  }
}

export function callTypeLabel(type: number) {
  return ({ 1: 'Incoming', 2: 'Outgoing', 3: 'Missed', 4: 'Voicemail', 5: 'Rejected', 6: 'Blocked', 7: 'Answered elsewhere' } as Record<number, string>)[type] || `Type ${type}`
}
export function smsTypeLabel(type: number) {
  return ({ 1: 'Received', 2: 'Sent', 3: 'Draft', 4: 'Outbox', 5: 'Failed', 6: 'Queued' } as Record<number, string>)[type] || `Type ${type}`
}
