import { useMemo, useState, type CSSProperties } from 'react'
import { ArrowLeft, BookOpen, Download, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import type { AppNote, AppNoteDraft } from '../../electron/app-notes-protocol'
import type { AppActionTarget } from '../../electron/app-actions-protocol'
import type { AndroidApp } from '../../electron/apps-protocol'
import { useAppNotesStore } from '../store/useAppNotesStore'
import { useAppsStore } from '../store/useAppsStore'
import { useAppStore } from '../store/useAppStore'
import { requestBackend } from '../lib/backend'
import { BadgeDialog } from './BadgeDialog'
import './app-notes.css'

const date = (value: string) => new Date(value).toLocaleString('en-US')
function PersonalBadge({ note }: { note: AppNote }) {
  return <span className="personal-badge" style={{ '--note-color': note.color } as CSSProperties}>{note.label || "Note"}</span>
}
export function AppPersonalBadges({ packageName }: { packageName: string }) {
  const entries = useAppNotesStore(s => s.entries), notes = entries.filter(n => n.packageName === packageName)
  if (!notes.length) return null
  return <span className="personal-table-badges" aria-label={`${notes.length} personal records`} title={`Personal: ${notes.slice(0, 8).map(n => n.label || 'Note').join(', ')}${notes.length > 8 ? '…' : ''}`}><PersonalBadge note={notes[0]} />{notes.length > 1 && <span className="personal-more">+{notes.length - 1}</span>}</span>
}
export function AppNotesSummary({ app, compact = false }: { app: AndroidApp; compact?: boolean }) {
  const notes = useAppNotesStore(s => s.entries), status = useAppNotesStore(s => s.status)
  const own = notes.filter(n => n.packageName === app.packageName)
  const [target, setTarget] = useState<AppActionTarget | null>(null)
  const deviceId = useAppsStore(s => s.deviceId)
  return <div className={`app-personal-summary${compact ? " personal-compact" : ''}`}>
    <button className="personal-open" disabled={!deviceId} onClick={() => setTarget({ id: deviceId!, userId: app.userId, packageName: app.packageName })} title="Personal labels and notes · shared across all phones"><BookOpen size={14} /><span className={compact ? 'visually-hidden' : undefined}>Personal{own.length ? ` (${own.length})` : " · add note"}{status === 'error' && " · unavailable"}</span></button>
    {own.slice(0, compact ? 1 : 3).map(note => <button className="personal-badge-button" key={note.id} onClick={() => deviceId && setTarget({ id: deviceId, userId: app.userId, packageName: app.packageName })} title={note.text || note.label}><PersonalBadge note={note} /></button>)}
    {compact && own.length > 1 && <button className="personal-more" title="Show all personal records" onClick={() => deviceId && setTarget({ id: deviceId, userId: app.userId, packageName: app.packageName })}>+{own.length - 1}</button>}
    {target && <BadgeDialog title={`Personal records · ${app.label}`} close={() => setTarget(null)} className="personal-dialog"><NotesPanel packageName={target.packageName} target={target} /></BadgeDialog>}
  </div>
}
function NoteCard({ note, edit, busy, remove }: { note: AppNote; edit: () => void; busy: boolean; remove: () => void }) {
  const o = note.origin
  return <article className="personal-record">
    <div className="personal-record-heading"><PersonalBadge note={note} /><code>{note.packageName}</code><div className="personal-record-actions"><button className="icon-button" title="Edit record" aria-label="Edit record" disabled={busy} onClick={edit}><Pencil size={14} /></button><button className="icon-button" title="Delete record" aria-label="Delete record" disabled={busy} onClick={remove}><Trash2 size={14} /></button></div></div>
    {note.text && <p className="personal-record-text">{note.text}</p>}
    <p className="personal-provenance">{"Created "}{date(note.createdAt)} · {o ? `${o.deviceName} · ${o.profileName} (ID ${o.userId})` : "On this PC"}{note.updatedAt !== note.createdAt && <><br />{"Edited "}{date(note.updatedAt)}</>}</p>
    {o && <details className="personal-origin"><summary>Original phone and app version</summary><dl><dt>Phone</dt><dd>{o.model || o.deviceName}</dd><dt>Android / build</dt><dd>{[o.android, o.build].filter(Boolean).join(' · ') || "Not recorded"}</dd><dt>Application</dt><dd>{o.appLabel} · {o.versionName || '—'} ({o.versionCode})</dd>{o.fingerprint && <><dt>Firmware</dt><dd>{o.fingerprint}</dd></>}</dl><p>This records where the note was created. Behaviour may differ on another phone or app version.</p></details>}
  </article>
}
function NoteEditor({ note, packageName, target, saved, cancel }: { note?: AppNote; packageName?: string; target?: AppActionTarget; saved: () => void; cancel: () => void }) {
  const [draft, setDraft] = useState<AppNoteDraft>(() => ({ packageName: note?.packageName || packageName || '', label: note?.label || '', text: note?.text || '', color: note?.color || '#5681c2', ...(note ? { id: note.id, expectedUpdatedAt: note.updatedAt } : target ? { target } : {}) }))
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const update = (patch: Partial<AppNoteDraft>) => setDraft(s => ({ ...s, ...patch }))
  return <form className="personal-editor" aria-label={note ? "Edit personal record" : "New personal record"} onSubmit={async event => { event.preventDefault(); if (busy) return; setBusy(true); setError(''); const ok = await requestBackend({ type: 'apps.notesSave', note: draft }, setError); setBusy(false); if (ok) saved() }}>
    <h3>{note ? "Edit record" : "New personal record"}</h3>
    <label>Package name<input autoFocus={!packageName && !note} required pattern="[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*" maxLength={255} value={draft.packageName} disabled={busy || !!packageName || !!note} placeholder="com.example.app" onChange={e => update({ packageName: e.target.value })} /></label>
    <div className="personal-label-fields"><label>Personal badge<input autoFocus={!!packageName || !!note} maxLength={60} value={draft.label} placeholder="For example: Keep / Tested / Replace" disabled={busy} onChange={e => update({ label: e.target.value })} /></label><label>Colour<input type="color" value={draft.color} disabled={busy} onChange={e => update({ color: e.target.value })} /></label></div>
    <label>Note<textarea rows={5} maxLength={8000} value={draft.text} disabled={busy} placeholder="Your experience with this application…" onChange={e => update({ text: e.target.value })} /></label>
    <p className="personal-provenance">{note ? "Original phone and creation date are preserved." : target ? "The current phone, profile and app version will be recorded." : "Created on this PC without a phone attached to this record."}{" Visible for this package on every phone."}</p>
    {error && <p role="alert">{error}</p>}
    <div className="personal-toolbar"><button type="submit" className="button primary" disabled={busy || !(draft.label.trim() || draft.text.trim())}>{busy ? "Saving…" : "Save record"}</button><button type="button" className="button secondary" disabled={busy} onClick={cancel}>Cancel</button></div>
  </form>
}
function NotesPanel({ packageName, target }: { packageName?: string; target?: AppActionTarget }) {
  const { entries, status, error } = useAppNotesStore()
  const [search, setSearch] = useState(''), [limit, setLimit] = useState(50)
  const [editing, setEditing] = useState<AppNote | 'new' | null>(null), [busy, setBusy] = useState(false)
  const notes = useMemo(() => entries.filter(n => (!packageName || n.packageName === packageName) && `${n.packageName} ${n.label} ${n.text} ${n.origin?.deviceName || ''}`.toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [entries, packageName, search])
  return <div className="personal-panel"><p className="component-description">Your own labels and notes, shared across phones by package name. Stored on this computer; available even after an app is removed.</p>
    {status !== 'ready' ? <p role={error ? 'alert' : 'status'}>{error || "Loading personal database…"}</p> : <>
      <div className="personal-toolbar"><button className="button secondary" disabled={busy || !!editing} onClick={() => setEditing('new')}><Plus size={14} />Add record</button>{!packageName && <><button className="button secondary" disabled={busy || !!editing} onClick={async () => { setBusy(true); await requestBackend({ type: 'apps.notesImport' }); setBusy(false) }}><Upload size={14} />Import</button><button className="button secondary" disabled={busy || !!editing} onClick={async () => { setBusy(true); await requestBackend({ type: 'apps.notesExport' }); setBusy(false) }}><Download size={14} />Export</button></>}<span className="personal-provenance">{notes.length}{" records"}</span></div>
      {!packageName && <label className="personal-search">Search records<input type="search" placeholder="Package, badge, note or original phone…" value={search} onChange={e => { setSearch(e.target.value); setLimit(50) }} /></label>}
      {editing && <NoteEditor key={typeof editing === 'object' ? editing.id : 'new'} note={typeof editing === 'object' ? editing : undefined} packageName={packageName} target={target} saved={() => setEditing(null)} cancel={() => setEditing(null)} />}
      {!notes.length && !editing && <p className="personal-empty">{search ? "No matching records." : "No personal records yet. Add a badge, a note, or both."}</p>}
      {notes.slice(0, limit).map(note => <NoteCard key={note.id} note={note} busy={busy || !!editing} edit={() => setEditing(note)} remove={async () => { setBusy(true); await requestBackend({ type: 'apps.notesDelete', id: note.id, expectedUpdatedAt: note.updatedAt }); setBusy(false) }} />)}
      {notes.length > limit && <button className="button secondary" onClick={() => setLimit(n => n + 50)}>Show more</button>}
    </>}
  </div>
}
export function PersonalDatabase() {
  return <section className="section-content personal-database" aria-label="Personal database"><div className="app-details-navigation"><button className="button secondary" onClick={() => useAppStore.setState({ appsView: 'installed' })}><ArrowLeft size={15} />Apps</button></div><div className="personal-database-scroll"><h1>Personal database</h1><NotesPanel /></div></section>
}
