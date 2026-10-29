import { t as translateUi } from '../lib/i18n'
import { locale as uiLocale } from '../lib/i18n'
import { message } from "../lib/i18n"
import { t } from "../lib/i18n"
import { useEffect, useMemo, useState } from 'react'
import { BookUser, Clipboard, Copy, Download, MessageSquare, Phone, QrCode, Send, Trash2 } from 'lucide-react'
import QRCode from 'qrcode'
import type { DeviceRecord } from '../../electron/contracts'
import {
  PHONE_TEXT_LIMIT, callTypeLabel, phoneDataLabels, phoneExportFormats, samePhoneTarget, smsTypeLabel, validatePhoneText,
  type PhoneDataKind, type PhoneDataRecord, type PhoneDateRange, type PhoneExportFormat,
} from '../../electron/phone-tools-protocol'
import { usePhoneToolsStore, type PhoneToolsView } from '../store/usePhoneToolsStore'
import { useConnectionStore } from '../store/useConnectionStore'
import { useAppStore } from '../store/useAppStore'
import { copyText } from '../lib/clipboard'
import { BadgeDialog } from './BadgeDialog'
import { usePowerBlocked } from './DevicePowerActions'
import { ActionIndicator } from './ui'
import { HintButton } from './Tooltip'
import '../phone-tools.css'

const actionLabels = { get contacts() { return t("Export contacts") }, get calls() { return t("Export call log") }, get sms() { return t("Export SMS") } }
const actionHints = { contacts: 'Preview and select phone contacts, then save them as VCF or CSV.', calls: 'Preview call history, filter by date and save selected entries as CSV or JSON.', sms: 'Preview text messages, filter by date and save selected messages as JSON or HTML. MMS and RCS are not included.' }
const kindIcons = { contacts: BookUser, calls: Phone, sms: MessageSquare }
export function PhoneToolActions({ device }: { device?: DeviceRecord }) {
  const open = usePhoneToolsStore(s => s.open)
  return <>
    <HintButton hint={t("Transfer text between this computer and the phone, or create a local QR code from text.")} className="button secondary" onClick={() => open('clipboard', device)}><Clipboard size={14} />{t("Clipboard")}<ActionIndicator /></HintButton>
    {(['contacts', 'calls', 'sms'] as const).map(kind => {
      const Icon = kindIcons[kind]
      return <HintButton hint={actionHints[kind]} className="button secondary" key={kind} disabled={!device || device.status !== 'connected'} onClick={() => open(kind, device)}><Icon size={14} />{actionLabels[kind]}<ActionIndicator /></HintButton>
    })}
  </>
}
export function PhoneToolsDialog() {
  const view = usePhoneToolsStore(s => s.view)
  return view ? <PhoneToolDialog key={`${view.kind}:${view.target?.id}:${view.target?.transportId}`} view={view} /> : null
}
function PhoneToolDialog({ view }: { view: PhoneToolsView }) {
  const state = usePhoneToolsStore()
  const job = state.job?.kind === view.kind && samePhoneTarget(state.job.target, view.target) ? state.job : null
  const connected = useConnectionStore(s => !!view.target && s.adbAvailable && s.devices.some(d => d.status === 'connected' && samePhoneTarget(d, view.target)))
  return <BadgeDialog title={view.kind === 'clipboard' ? t("Clipboard") : actionLabels[view.kind]} className={`phone-tools-dialog ${view.kind === 'clipboard' ? 'phone-clipboard-dialog' : 'phone-export-dialog'}`} close={() => usePhoneToolsStore.setState({ view: null })}>
    <p className="phone-tools-target">{view.name}{view.target && <> · <code>{view.target.serial}</code></>}</p>
    {view.kind === 'clipboard' ? <ClipboardContent view={view} connected={connected} /> : <PhoneExportContent view={{ ...view, kind: view.kind }} connected={connected} />}
    {view.target && !connected && <p className="phone-tools-note" role="status">{t("This phone connection is unavailable. Reopen the action after reconnecting. Loaded data can still be exported.")}</p>}
    {state.error && <p className="phone-tools-error" role="alert">{message(state.error)}</p>}
    {job && <div className={`phone-tools-status ${job.status}`} role={job.status === 'error' ? 'alert' : 'status'}><p>{message(job.message)}</p>
      {job.status === 'running' && <><span>{job.total !== undefined ? t("{0} / {1} records", [job.completed ?? 0, job.total]) : t("Please wait…")}</span><button className="button secondary" onClick={() => void state.cancel()}>{t("Cancel operation")}</button></>}
      {job.status === 'success' && job.output && <button className="button secondary" onClick={() => void state.request({ type: 'phoneTools.reveal', jobId: job.id })}>{t("Show saved file")}</button>}
    </div>}
  </BadgeDialog>
}

function ClipboardContent({ view, connected }: { view: PhoneToolsView; connected: boolean }) {
  const state = usePhoneToolsStore(), blocked = usePowerBlocked()
  const text = state.clipboardDraft, bytes = new TextEncoder().encode(text).length
  const [pcPending, setPcPending] = useState(false), [showQr, setShowQr] = useState(false), [qr, setQr] = useState(''), [qrError, setQrError] = useState('')
  const busy = state.pending || state.job?.status === 'running'
  const change = (value: string) => { usePhoneToolsStore.setState({ clipboardDraft: value, error: '' }); setShowQr(false) }
  useEffect(() => {
    setQr(''); setQrError('')
    if (!showQr || !text) return
    let cancelled = false
    void QRCode.toDataURL(text, { width: 360, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } })
      .then(value => { if (!cancelled) setQr(value) })
      .catch(() => { if (!cancelled) setQrError(translateUi("This text is too long for one QR code. Shorten it or use clipboard transfer.")) })
    return () => { cancelled = true }
  }, [showQr, text])
  const fromComputer = async () => {
    setPcPending(true)
    try {
      const value = window.desktop ? await window.desktop.readClipboard?.() : await navigator.clipboard.readText()
      const draftTarget = usePhoneToolsStore.getState().clipboardDraftTarget
      if (!(draftTarget === null && view.target === null || samePhoneTarget(draftTarget, view.target))) return
      if (value === undefined) throw new Error(translateUi("Restart ADB Vault to enable clipboard reading."))
      validatePhoneText(value); change(value)
      if (!value) useAppStore.getState().notify("The computer clipboard contains no text.")
    } catch (error) { usePhoneToolsStore.setState({ error: (error as Error).message }) }
    finally { setPcPending(false) }
  }
  return <div className="phone-clipboard-content">
    <p className="phone-tools-note">{t("Transfer text between this computer and the selected phone, or show a QR code for another phone to scan.")}</p>
    <label htmlFor="phone-clipboard-text">{t("Text ")}<span>{bytes.toLocaleString(uiLocale())} / {PHONE_TEXT_LIMIT.toLocaleString(uiLocale())}{t(" bytes")}</span></label>
    <textarea id="phone-clipboard-text" aria-label={t("Clipboard text")} value={text} disabled={busy || pcPending} spellCheck={false} maxLength={PHONE_TEXT_LIMIT} rows={8} onChange={event => change(event.target.value)} placeholder={t("Paste or type text, a link or a short note…")} />
    {bytes > PHONE_TEXT_LIMIT && <p className="phone-tools-error">{t("Text exceeds the 256 KiB clipboard limit.")}</p>}
    <div className="phone-tools-buttons">
      <button className="button secondary" disabled={pcPending || busy} onClick={() => void fromComputer()}><Clipboard size={14} />{t("Paste from PC")}</button>
      <button className="button secondary" disabled={!text || bytes > PHONE_TEXT_LIMIT} onClick={() => void copyText(text).then(() => useAppStore.getState().notify("Text copied to the computer clipboard."), error => usePhoneToolsStore.setState({ error: error.message }))}><Copy size={14} />{t("Copy to PC")}</button>
      <button className="button secondary" disabled={!text} aria-pressed={showQr} onClick={() => setShowQr(!showQr)}><QrCode size={14} />{showQr ? t("Hide QR code") : t("Show QR code")}</button>
      <button className="button secondary" disabled={!text || pcPending || busy} onClick={() => change('')}><Trash2 size={14} />{t("Clear text")}</button>
    </div>
    <div className="phone-tools-buttons phone-clipboard-android">
      <button className="button primary" disabled={!connected || blocked || busy || pcPending || !text || bytes > PHONE_TEXT_LIMIT} onClick={() => { setShowQr(false); void state.request({ type: 'phoneTools.clipboard.write', target: view.target!, text }) }}><Send size={14} />{t("Send to Android")}</button>
      <button className="button secondary" disabled={!connected || blocked || busy || pcPending} onClick={() => { setShowQr(false); void state.request({ type: 'phoneTools.clipboard.read', target: view.target! }) }}><Download size={14} />{t("Get from Android")}</button>
      <p className="phone-tools-note">{t("Send updates the phone’s clipboard. Paste the text in the desired Android app.")}</p>
    </div>
    {showQr && <div className="phone-clipboard-qr">{qr ? <><img src={qr} alt={t("QR code containing the clipboard text")} /><p>{t("Scan with your phone’s camera. QR generation stays on this computer.")}</p></> : qrError ? <p className="phone-tools-error" role="alert">{qrError}</p> : <p role="status">{t("Creating QR code…")}</p>}</div>}
  </div>
}

function dateInput(value?: number) {
  if (value === undefined) return ''
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function phoneDateRange(from: string, to: string): PhoneDateRange {
  const parse = (value: string) => {
    if (!/^\d{4}-\d\d-\d\d$/.test(value)) throw new Error(translateUi("Choose a valid date."))
    const date = new Date(`${value}T00:00:00`)
    if (!Number.isFinite(date.getTime()) || dateInput(date.getTime()) !== value) throw new Error(translateUi("Choose a valid date."))
    return date
  }
  const start = from ? parse(from) : undefined, end = to ? parse(to) : undefined
  if (end) end.setDate(end.getDate() + 1)
  if (start && end && start >= end) throw new Error(translateUi("The end date must be on or after the start date."))
  return { ...(start ? { from: start.getTime() } : {}), ...(end ? { to: end.getTime() } : {}) }
}
function searchable(record: PhoneDataRecord) {
  if (record.kind === 'contacts') return [record.name, ...record.phones, ...record.emails, ...record.organizations].join(' ')
  if (record.kind === 'calls') return `${record.number} ${record.name} ${callTypeLabel(record.type)}`
  return `${record.address} ${record.body} ${smsTypeLabel(record.type)}`
}
function PhoneExportContent({ view, connected }: { view: PhoneToolsView & { kind: PhoneDataKind }; connected: boolean }) {
  const state = usePhoneToolsStore(), blocked = usePowerBlocked()
  const data = state.data?.kind === view.kind && samePhoneTarget(state.data.target, view.target) ? state.data : null
  const [from, setFrom] = useState(dateInput(data?.range.from)), [to, setTo] = useState(data?.range.to === undefined ? '' : dateInput(data.range.to - 1))
  const [query, setQuery] = useState(''), [selected, setSelected] = useState(new Set<string>()), [page, setPage] = useState(0)
  const [format, setFormat] = useState<PhoneExportFormat>(phoneExportFormats[view.kind][0])
  const busy = state.pending || state.job?.status === 'running'
  const filtered = useMemo(() => data?.rows.filter(row => searchable(row).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) || [], [data, query])
  const pages = Math.max(1, Math.ceil(filtered.length / 50)), currentPage = Math.min(page, pages - 1)
  let range: PhoneDateRange = {}, rangeError = ''
  try { range = phoneDateRange(from, to) } catch (error) { rangeError = (error as Error).message }
  const needsRefresh = !!data && (range.from !== data.range.from || range.to !== data.range.to)
  useEffect(() => { setSelected(new Set()); setPage(0) }, [data?.id])
  const exportRows = (ids: string[]) => { if (data && ids.length) void state.request({ type: 'phoneTools.export', snapshotId: data.id, ids, format }) }
  const descriptions = {
    contacts: translateUi("VCF preserves contact fields supplied by Android, without photos. CSV includes names, numbers, email addresses and organizations."),
    calls: translateUi("Export call history, including numbers, dates, direction and duration."),
    sms: translateUi("Export ordinary SMS messages with their numbers, timestamps and delivery folders. MMS and RCS are not included."),
  }
  return <div className="phone-export-content">
    <p className="phone-tools-note">{descriptions[view.kind]}{t(" Data is read from the phone’s current Android user.")}</p>
    <div className="phone-export-load">
      {view.kind !== 'contacts' && <><label>{t("From")}<input aria-label={t("Export from date")} type="date" min="1970-01-01" max="2099-12-31" disabled={busy} value={from} onChange={event => setFrom(event.target.value)} /></label><label>{t("Through")}<input aria-label={t("Export through date")} type="date" min="1970-01-01" max="2099-12-31" disabled={busy} value={to} onChange={event => setTo(event.target.value)} /></label></>}
      <button className="button primary" disabled={!connected || blocked || busy || !!rangeError} onClick={() => void state.request({ type: 'phoneTools.read', kind: view.kind, target: view.target!, range })}>{data ? t("Refresh data") : t("Load data")}</button>
      {view.kind !== 'contacts' && <span className="phone-tools-note">{t("Empty dates include all available records.")}</span>}
    </div>
    {rangeError && <p className="phone-tools-error">{rangeError}</p>}
    {needsRefresh && <p className="phone-tools-note" role="status">{t("Refresh data to apply the changed date range before exporting.")}</p>}
    {data ? <>
      <p className="phone-tools-note">{t("Loaded ")}{data.rows.length.toLocaleString(uiLocale())}{t(" records · Android user ")}{data.userId} · {new Date(data.capturedAt).toLocaleString(uiLocale())}</p>
      <div className="phone-export-search"><input type="search" aria-label={t("Search phone data")} placeholder={view.kind === 'contacts' ? t("Name, number, email or organization…") : view.kind === 'calls' ? t("Number, name or direction…") : t("Number or message text…")} value={query} onChange={event => { setQuery(event.target.value); setSelected(new Set()); setPage(0) }} />
        <button className="button secondary" disabled={!filtered.length || busy} onClick={() => setSelected(new Set(filtered.map(row => row.id)))}>{t("Select matching")}</button><button className="button secondary" disabled={!selected.size || busy} onClick={() => setSelected(new Set())}>{t("Clear selection")}</button></div>
      <div className="phone-export-table-wrap"><table className="phone-export-table"><thead><tr><th scope="col" aria-label={t("Select")}></th>{(view.kind === 'contacts' ? ['Name', translateUi("Phone numbers"), translateUi("Email addresses")] : view.kind === 'calls' ? [translateUi("Number"), translateUi("Date"), 'Direction', translateUi("Duration")] : [translateUi("Number"), translateUi("Date"), 'Folder', 'Message']).map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>
        {filtered.slice(currentPage * 50, (currentPage + 1) * 50).map(row => <tr key={row.id}><td><input type="checkbox" aria-label={t("Select record {0}", [row.id])} checked={selected.has(row.id)} disabled={busy} onChange={event => setSelected(previous => { const next = new Set(previous); if (event.target.checked) next.add(row.id); else next.delete(row.id); return next })} /></td><RecordCells row={row} /></tr>)}
      </tbody></table>{!filtered.length && <p className="phone-export-empty">{data.rows.length ? t("No matching records.") : t("No {0} records were returned for this selection.", [phoneDataLabels[view.kind]])}</p>}</div>
      <div className="phone-export-pagination"><span>{filtered.length.toLocaleString(uiLocale())}{t(" matching · ")}{selected.size.toLocaleString(uiLocale())}{t(" selected")}</span><button className="button secondary" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>{t("Previous")}</button><span>{currentPage + 1} / {pages}</span><button className="button secondary" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>{t("Next")}</button></div>
      <div className="phone-export-save"><label>{t("Format")}<select aria-label={t("Phone export format")} disabled={busy} value={format} onChange={event => setFormat(event.target.value as PhoneExportFormat)}>{phoneExportFormats[view.kind].map(value => <option key={value} value={value}>{value.toUpperCase()}</option>)}</select></label>
        <button className="button secondary" disabled={busy || needsRefresh || !!rangeError || !selected.size} onClick={() => exportRows([...selected])}>{t("Export selected (")}{selected.size})…</button>
        <button className="button primary" disabled={busy || needsRefresh || !!rangeError || !filtered.length} onClick={() => exportRows(filtered.map(row => row.id))}>{t("Export matching (")}{filtered.length})…</button>
      </div>
      <p className="phone-tools-note">{format === 'csv' ? t("CSV protects text fields from spreadsheet formulas. VCF and JSON retain original values. ") : ''}{t("Exports save a copy on this computer. Loaded records stay in memory until cleared or the app closes.")}</p>
      <button className="phone-tools-clear" disabled={busy} onClick={() => void state.request({ type: 'phoneTools.clear' })}>{t("Clear loaded data")}</button>
    </> : <div className="phone-export-empty"><Download size={24} /><strong>{t("Ready to load ")}{phoneDataLabels[view.kind]}</strong><p>{t("Load the records, then choose what to export.")}</p></div>}
  </div>
}
function RecordCells({ row }: { row: PhoneDataRecord }) {
  if (row.kind === 'contacts') return <><td><strong>{row.name || t("Unnamed contact")}</strong>{row.organizations.length > 0 && <small>{row.organizations.join(' · ')}</small>}</td><td>{row.phones.map((value, i) => <div key={i}>{value}</div>)}</td><td>{row.emails.map((value, i) => <div key={i}>{value}</div>)}</td></>
  if (row.kind === 'calls') return <><td><strong>{row.number || t("Unknown number")}</strong>{row.name && <small>{row.name}</small>}</td><td>{new Date(row.date).toLocaleString(uiLocale())}</td><td>{message(callTypeLabel(row.type))}</td><td>{row.duration}{t(" s")}</td></>
  return <><td>{row.address || t("Unknown sender")}</td><td>{new Date(row.date).toLocaleString(uiLocale())}</td><td>{message(smsTypeLabel(row.type))}{!row.read && <small>{t("Unread")}</small>}</td><td>{row.body.length > 160 ? <details><summary>{row.body.slice(0, 160)}…</summary><pre>{row.body}</pre></details> : <pre>{row.body || '—'}</pre>}</td></>
}
