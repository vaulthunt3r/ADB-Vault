import { useEffect, useMemo, useState, type DragEvent } from 'react'
import { ArrowLeft, ArrowLeftRight, Download, FileSearch, FolderOpen, ShieldCheck, ShieldX, Square, Trash2 } from 'lucide-react'
import { useApkInspectorStore } from '../store/useApkInspectorStore'
import { useAppStore } from '../store/useAppStore'
import { requestBackend } from '../lib/backend'
import { LocalApkDetails } from '../components/LocalApkDetails'
import { compareApks, type InspectedApk, type InspectorSlotId } from '../../electron/apk-inspector-protocol'
import '../apk-inspector.css'

const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1024 ** 2).toFixed(2)} MiB`
const signatureText = { verified: "Valid signature", invalid: 'Invalid / unsigned', unavailable: "Signature not verified" }
function openDropped(event: DragEvent, slot?: InspectorSlotId) {
  event.preventDefault(); event.stopPropagation()
  const files = [...event.dataTransfer.files]
  if (!files.length || files.length > (slot ? 1 : 2) || files.some(f => !f.name.toLowerCase().endsWith('.apk'))) { useAppStore.getState().notify(slot ? "Drop one .apk file into this slot." : "Drop one or two .apk files."); return }
  const paths = files.map(f => window.desktop?.apkPath?.(f))
  if (paths.some(p => !p)) { useAppStore.getState().notify("Open the desktop application to inspect local APK files."); return }
  paths.forEach((path, i) => { void requestBackend({ type: 'inspector.open', slot: slot ?? (i === 0 ? 'before' : 'after'), path }) })
}
function Slot({ id }: { id: InspectorSlotId }) {
  const slot = useApkInspectorStore(s => s[id]), apk = slot.result, loading = slot.status === 'loading'
  return <section className={`apk-slot ${loading ? 'loading' : ''}`} aria-label={`${id === 'before' ? "Before" : "After"} APK`} onDragOver={e => e.preventDefault()} onDrop={e => openDropped(e, id)}>
    <div className="apk-slot-heading"><span>{id === 'before' ? "A · Before" : "B · After"}</span><div>
      <button className="button secondary" disabled={loading} onClick={() => void requestBackend({ type: 'inspector.open', slot: id })}><FolderOpen size={15} />{apk ? "Replace" : "Open APK"}</button>
      {loading ? <button className="button secondary" aria-label={`Cancel ${id} inspection`} onClick={() => void requestBackend({ type: 'inspector.cancel', slot: id })}><Square size={14} />Cancel</button> : slot.status !== 'empty' && <button className="icon-button" aria-label={`Clear ${id} APK`} onClick={() => void requestBackend({ type: 'inspector.clear', slot: id })}><Trash2 size={15} /></button>}
    </div></div>
    {apk ? <div className="apk-slot-result"><div><h3 title={apk.label}>{apk.label}</h3><p className="apk-filename" title={apk.path}>{apk.name} · {apk.manifest.versionName || apk.manifest.versionCode || "No version"} · {size(apk.bytes)}</p></div><span className={`apk-signature ${apk.signature.status}`} title={signatureText[apk.signature.status]}>{apk.signature.status === 'verified' ? <ShieldCheck size={15} /> : <ShieldX size={15} />}<span>{signatureText[apk.signature.status]}</span></span></div> : <div className="apk-drop"><FileSearch size={21} /><span>{slot.status === 'empty' ? "Drop an APK here or choose a file" : slot.message}</span></div>}
  </section>
}
function Pages({ current, pages, change }: { current: number; pages: number; change: (page: number) => void }) {
  return <footer className="apk-pages"><button className="button secondary" disabled={current === 0} onClick={() => change(current - 1)}>Previous</button><span>{"Page "}{current + 1}{" of "}{pages}</span><button className="button secondary" disabled={current + 1 >= pages} onClick={() => change(current + 1)}>Next</button></footer>
}
function ArchiveContents({ apk }: { apk: InspectedApk }) {
  const [search, setSearch] = useState(''), [page, setPage] = useState(0)
  const entries = apk.entries.filter(e => e.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  const pages = Math.max(1, Math.ceil(entries.length / 60)), current = Math.min(page, pages - 1)
  return <div className="apk-contents">
    <div className="apk-filter"><input type="search" aria-label="Search APK contents" placeholder="File name or path…" value={search} onChange={e => { setSearch(e.target.value); setPage(0) }} /><span>{entries.length.toLocaleString('en-US')}{" results"}</span></div>
    <div className="apk-table-wrap"><table className="apk-table"><thead><tr><th>File</th><th>Size</th></tr></thead><tbody>{entries.slice(current * 60, (current + 1) * 60).map(e => <tr key={e.name}><td>{e.name}</td><td>{size(e.bytes)}{" unpacked · "}{size(e.compressed)}{" compressed"}<small>{"CRC32 "}{e.crc32.toString(16).padStart(8, '0')}</small></td></tr>)}</tbody></table>{!entries.length && <p className="apk-no-results">No matching entries.</p>}</div>
    <Pages current={current} pages={pages} change={setPage} />
  </div>
}
function Comparison({ before, after }: { before: InspectedApk; after: InspectedApk }) {
  const [search, setSearch] = useState(''), [group, setGroup] = useState('All changes'), [page, setPage] = useState(0)
  const changes = useMemo(() => compareApks(before, after), [before, after])
  const rows = changes.filter(c => (group === 'All changes' || c.group === group) && `${c.name} ${c.before} ${c.after}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  const pages = Math.max(1, Math.ceil(rows.length / 60)), current = Math.min(page, pages - 1)
  const partial = [before, after].some(a => !a.analysis || a.analysis.status !== 'complete' || a.issues.length)
  return <div className="apk-comparison">
    <div className="apk-comparison-summary"><strong>{before.sha256 === after.sha256 ? "Identical APK files" : `${changes.length.toLocaleString('en-US')} changes`}</strong><span>{"Size "}{after.bytes - before.bytes >= 0 ? '+' : '−'}{size(Math.abs(after.bytes - before.bytes))}</span><span>{changes.filter(c => c.status === 'added').length}{" added"}</span><span>{changes.filter(c => c.status === 'removed').length}{" removed"}</span><span>{changes.filter(c => c.status === 'changed').length}{" changed"}</span></div>
    {before.manifest.packageName !== after.manifest.packageName && <p className="apk-warning">Different package names. These files are different applications, not versions of the same package.</p>}
    {before.analysis?.revision !== after.analysis?.revision && <p className="apk-warning">Detection database revisions differ. Reopen both APKs to compare library matches using the same database.</p>}
    {partial && <p className="apk-warning">Some analysis is incomplete. Review each APK’s warnings before interpreting missing libraries or addresses.</p>}
    <p className="apk-note">File changes use unpacked size and CRC32. Certificate changes do not by themselves establish Android update compatibility; signing-key rotation may apply.</p>
    <div className="apk-filter"><input type="search" aria-label="Search APK changes" placeholder="Search changes…" value={search} onChange={e => { setSearch(e.target.value); setPage(0) }} /><select aria-label="Change category" value={group} onChange={e => { setGroup(e.target.value); setPage(0) }}>{["All changes", ...new Set(changes.map(c => c.group))].map(g => <option key={g}>{g}</option>)}</select><span>{rows.length.toLocaleString('en-US')}{" results"}</span></div>
    <div className="apk-table-wrap"><table className="apk-table"><thead><tr><th>Change</th><th>A · Before</th><th>B · After</th></tr></thead><tbody>{rows.slice(current * 60, (current + 1) * 60).map((c, i) => <tr key={i}><td><span className={`apk-change ${c.status}`}>{c.status}</span><small>{c.group}</small><strong>{c.name}</strong></td><td>{c.before || '—'}</td><td>{c.after || '—'}</td></tr>)}</tbody></table>{!rows.length && <p className="apk-no-results">No matching changes.</p>}</div>
    <Pages current={current} pages={pages} change={setPage} />
  </div>
}
export function ApkInspectorSection() {
  const state = useApkInspectorStore(), before = state.before.result, after = state.after.result
  const busy = state.before.status === 'loading' || state.after.status === 'loading'
  const [mode, setMode] = useState<'before' | 'after' | 'compare'>('before')
  useEffect(() => { if (before && after) setMode('compare'); else if (before) setMode('before'); else if (after) setMode('after') }, [before?.sha256, after?.sha256])
  const apk = mode === 'after' ? after : before
  return <section className="section-content app-full-details apk-inspector" aria-label="APK Inspector" onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }} onDrop={e => openDropped(e)}>
    <div className="app-details-scroll" role="region" aria-label="Local APK information" tabIndex={0}>
      <div className="app-details-navigation"><button className="button secondary" aria-label="Back to installed applications" onClick={() => useAppStore.setState({ appsView: 'installed' })}><ArrowLeft size={15} />Apps</button></div>
      <header className="apk-heading"><div><h1>Local APKs</h1><p>Open a local APK to view application details, or add two versions to compare.</p></div><div className="apk-heading-actions"><button className="button secondary" disabled={busy || !before && !after} onClick={() => void requestBackend({ type: 'inspector.swap' })}><ArrowLeftRight size={16} />Swap A / B</button><button className="button secondary" disabled={busy || !before && !after} onClick={() => void requestBackend({ type: 'inspector.export' })}><Download size={16} />Export JSON</button></div></header>
      <div className="apk-slots"><Slot id="before" /><Slot id="after" /></div>
      {(before || after) && <>
        <nav className="apk-mode" aria-label="APK view"><button aria-pressed={mode === 'before'} disabled={!before} onClick={() => setMode('before')}>A · Inspect</button><button aria-pressed={mode === 'after'} disabled={!after} onClick={() => setMode('after')}>B · Inspect</button><button aria-pressed={mode === 'compare'} disabled={!before || !after} onClick={() => setMode('compare')}>Compare A → B</button></nav>
        {mode === 'compare' && before && after ? <Comparison key={`${before.sha256}-${after.sha256}`} before={before} after={after} /> : apk && <LocalApkDetails key={`${mode}-${apk.sha256}`} apk={apk} contents={<ArchiveContents apk={apk} />} />}
      </>}
      {!before && !after && !busy && <div className="apk-inspector-empty"><FileSearch size={32} /><h2>Application details, directly from an APK</h2><p>Badges, permissions, components, signatures and APK analysis — without a phone connection.</p><p>Files are read locally. Application code is never installed or executed.</p></div>}
    </div>
  </section>
}
