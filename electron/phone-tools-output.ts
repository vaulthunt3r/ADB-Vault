import { PHONE_RECORD_LIMIT, PHONE_TEXT_LIMIT, callTypeLabel, smsTypeLabel, type PhoneDataKind, type PhoneDataRecord, type PhoneDataSnapshot, type PhoneExportFormat } from './phone-tools-protocol.js'

const MAX_OUTPUT = 64_000_000
const text = (value: unknown, max = 262144) => {
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) throw new Error('Invalid text in the phone response.')
  return value
}
const number = (value: unknown, max = Number.MAX_SAFE_INTEGER) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) throw new Error('Invalid number in the phone response.')
  return value
}
const id = (value: unknown) => { const result = text(value, 20); if (!/^\d+$/.test(result)) throw new Error('Invalid record ID.'); return result }
const list = (value: unknown) => {
  if (!Array.isArray(value) || value.length > 1000) throw new Error('Invalid contact fields.')
  return value.map(item => text(item))
}
function record(value: Record<string, unknown>, kind: PhoneDataKind): PhoneDataRecord {
  if (value.kind !== kind) throw new Error('Unexpected record type.')
  const key = id(value.id)
  if (kind === 'contacts') {
    const vcard = text(value.vcard, 1000000)
    const lines = vcard.replace(/\r\n/g, '\n').trim().split('\n')
    if (lines[0] !== 'BEGIN:VCARD' || lines.at(-1) !== 'END:VCARD'
      || lines.filter(line => line === 'BEGIN:VCARD').length !== 1 || lines.filter(line => line === 'END:VCARD').length !== 1) throw new Error('Android returned an invalid contact vCard.')
    return { kind, id: key, name: text(value.name), phones: list(value.phones), emails: list(value.emails), organizations: list(value.organizations), vcard }
  }
  if (kind === 'calls') return { kind, id: key, number: text(value.number), name: text(value.name), date: number(value.date, 4102444800000), duration: number(value.duration), type: number(value.type, 100), account: text(value.account) }
  if (typeof value.read !== 'boolean') throw new Error('Invalid SMS read state.')
  return { kind, id: key, address: text(value.address), date: number(value.date, 4102444800000), dateSent: number(value.dateSent, 4102444800000), type: number(value.type, 100), body: text(value.body, 1000000), read: value.read, subscription: text(value.subscription), threadId: text(value.threadId, 30) }
}
/** Only a completed, matching protocol response becomes a snapshot. Raw provider output never enters errors or Activity. */
export function parsePhoneToolsOutput(output: string, operation: PhoneDataKind | 'clipboard-read' | 'clipboard-write', userId: number) {
  if (Buffer.byteLength(output) > MAX_OUTPUT) throw new Error('Phone data exceeds the 64 MB collection limit. Use a smaller date range.')
  let started = false, ended = false, clipboard: string | undefined, written = false
  const rows: PhoneDataRecord[] = [], ids = new Set<string>()
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue
    // Android may print framework startup warnings before our protocol begins.
    if (!line.startsWith('{')) { if (started) throw new Error('Unexpected output while reading phone data.'); continue }
    let message: Record<string, unknown>
    try { message = JSON.parse(line) } catch { throw new Error('Incomplete phone data response.') }
    if (message.type === 'error') throw new Error(text(message.message, 1200))
    if (ended) throw new Error('Unexpected data after the completed response.')
    if (message.type === 'hello') {
      if (started || message.protocol !== 1 || message.operation !== operation || message.userId !== userId) throw new Error('Phone helper protocol or Android user changed.')
      started = true
    } else if (!started) throw new Error('Missing phone helper response header.')
    else if (message.type === 'record' && ['contacts', 'calls', 'sms'].includes(operation)) {
      if (!message.record || typeof message.record !== 'object' || Array.isArray(message.record)) throw new Error('Invalid phone data record.')
      const row = record(message.record as Record<string, unknown>, operation as PhoneDataKind)
      if (rows.length >= PHONE_RECORD_LIMIT || ids.has(row.id)) throw new Error('Too many or duplicate phone records. Use a smaller date range.')
      ids.add(row.id); rows.push(row)
    } else if (message.type === 'clipboard' && operation === 'clipboard-read') {
      if (clipboard !== undefined) throw new Error('Duplicate clipboard response.')
      clipboard = text(message.text, PHONE_TEXT_LIMIT)
      if (Buffer.byteLength(clipboard) > PHONE_TEXT_LIMIT) throw new Error('Android clipboard text exceeds 256 KiB.')
    } else if (message.type === 'written' && operation === 'clipboard-write') {
      if (written || message.verified !== true) throw new Error('Android did not confirm the clipboard update.')
      written = true
    } else if (message.type === 'progress') {
      number(message.completed, PHONE_RECORD_LIMIT)
      if (message.total !== undefined) number(message.total, PHONE_RECORD_LIMIT)
    } else if (message.type === 'done') {
      if (message.count !== rows.length || operation === 'clipboard-read' && clipboard === undefined || operation === 'clipboard-write' && !written) throw new Error('Incomplete phone data response.')
      ended = true
    } else throw new Error('Unexpected phone helper response.')
  }
  if (!started || !ended) throw new Error('Phone collection did not finish. No partial export was created.')
  return { rows, clipboard }
}

const html = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
// Preserve original values in JSON/VCF; CSV is made safe to open in spreadsheet applications.
const cell = (value: unknown) => {
  let content = String(value ?? '')
  if (/^[\s]*[=+\-@]/.test(content) || /^[\t\r\n]/.test(content)) content = "'" + content
  return `"${content.replace(/"/g, '""')}"`
}
export function formatPhoneExport(snapshot: PhoneDataSnapshot, rows: PhoneDataRecord[], format: PhoneExportFormat) {
  if (format === 'vcf') {
    if (snapshot.kind !== 'contacts' || rows.some(row => row.kind !== 'contacts')) throw new Error('vCard export requires contacts.')
    return rows.map(row => row.kind === 'contacts' ? row.vcard.replace(/\r\n|\r|\n/g, '\r\n').replace(/(?:\r\n)+$/, '') + '\r\n' : '').join('')
  }
  if (format === 'json') return JSON.stringify({ format: 'adb-vault-phone-data', version: 1, kind: snapshot.kind, device: { name: snapshot.deviceName, serial: snapshot.target.serial }, androidUser: snapshot.userId, capturedAt: snapshot.capturedAt, range: snapshot.range, recordCount: rows.length, records: rows }, null, 2) + '\n'
  if (format === 'csv') {
    const records = snapshot.kind === 'contacts'
      ? [['Name', 'Phone numbers', 'Email addresses', 'Organizations'], ...rows.map(row => { if (row.kind !== 'contacts') throw new Error('Unexpected export record.'); return [row.name, row.phones.join('\n'), row.emails.join('\n'), row.organizations.join('\n')] })]
      : [['Number', 'Cached name', 'Date (ISO 8601)', 'Duration (seconds)', 'Direction', 'Phone account'], ...rows.map(row => { if (row.kind !== 'calls') throw new Error('Unexpected export record.'); return [row.number, row.name, new Date(row.date).toISOString(), row.duration, callTypeLabel(row.type), row.account] })]
    return '\ufeff' + records.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n'
  }
  if (snapshot.kind !== 'sms') throw new Error('HTML export requires SMS.')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>SMS export</title>
<style>body{max-width:900px;margin:40px auto;padding:0 20px;font:15px/1.6 system-ui,sans-serif;color:#18231e;background:#f7f9f7}header{margin-bottom:28px}h1{margin-bottom:4px}article{margin:12px 0;padding:18px;border:1px solid #cad4cc;border-radius:8px;background:white}h2{font-size:16px;margin:0}small{color:#526058}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;margin-bottom:0}</style></head><body><header><h1>SMS export</h1><p>${html(snapshot.deviceName)} · ${html(snapshot.target.serial)} · Android user ${snapshot.userId}<br>Captured ${html(snapshot.capturedAt)} · ${rows.length} messages</p></header>
${rows.map(row => { if (row.kind !== 'sms') throw new Error('Unexpected export record.'); return `<article><h2>${html(row.address || 'Unknown sender')}</h2><small>${html(new Date(row.date).toISOString())} · ${html(smsTypeLabel(row.type))} · ${row.read ? 'Read' : 'Unread'}${row.subscription ? ' · SIM/subscription ' + html(row.subscription) : ''}</small><pre>${html(row.body)}</pre></article>` }).join('\n')}
</body></html>\n`
}
