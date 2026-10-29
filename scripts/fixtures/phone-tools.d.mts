import type { PhoneToolsTarget, ContactRecord, CallRecord, SmsRecord, PhoneDataKind, PhoneDataRecord } from '../../electron/phone-tools-protocol'
export const target: PhoneToolsTarget
export const contacts: ContactRecord[]
export const calls: CallRecord[]
export const sms: SmsRecord[]
export const sampleText: string
export const samples: { contacts: ContactRecord[]; calls: CallRecord[]; sms: SmsRecord[] }
export function response(operation: PhoneDataKind | 'clipboard-read' | 'clipboard-write', options?: { rows?: PhoneDataRecord[]; userId?: number; text?: string }): string
