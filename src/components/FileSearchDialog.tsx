import { fileParentPath, fileSourceLabel } from '../../electron/file-locations'
import { useEffect, useState } from 'react'
import { Archive, Copy, FolderOpen, HelpCircle, Search, Trash2 } from 'lucide-react'
import type { FileIndexInfo, FileSearchResult } from '../../electron/file-search-protocol'
import { fileBase } from '../../electron/files-protocol'
import { searchRequest, useFileSearchStore } from '../store/useFileSearchStore'
import { currentTab, filesRequest, locationKey, useFilesStore } from '../store/useFilesStore'
import { useAppStore } from '../store/useAppStore'
import { copyText } from '../lib/clipboard'
import { BadgeDialog } from './BadgeDialog'
import { IconButton } from './ui'
import { fileSize } from './FileTasks'

export function FileSearchDialog() {
  const visible = useFileSearchStore(s => s.visible)
  return visible ? <SearchForm /> : null
}
function SearchForm() {
  const s = useFileSearchStore(), q = s.draft, location = s.location!, busy = s.state?.status === 'running'
  const [index, setIndex] = useState<FileIndexInfo>(), [error, setError] = useState(''), [pending, setPending] = useState(false), [page, setPage] = useState(0), [help, setHelp] = useState(false)
  const result = s.state && locationKey(s.state.location) === locationKey(location) ? s.state : null
  const close = () => useFileSearchStore.setState({ visible: false })
  const update = (patch: Partial<typeof q>) => useFileSearchStore.setState({ draft: { ...q, ...patch } })
  useEffect(() => { let active = true; setIndex(undefined); setError(''); void searchRequest({ type: 'files.index.info', location }).then(r => { if (active) setIndex(r.fileIndex) }).catch(e => { if (active) setError(e.message) }); return () => { active = false } }, [location])
  useEffect(() => { if (result?.index) setIndex(result.index) }, [result?.index])
  useEffect(() => setPage(0), [result?.id])
  async function request(type: 'search' | 'build' | 'delete' | 'cancel') {
    setPending(true); setError('')
    try {
      if (type === 'search') await searchRequest({ type: 'files.search', location, query: q })
      else if (type === 'cancel') await searchRequest({ type: 'files.search.cancel', id: s.state!.id })
      else if (type === 'build') await searchRequest({ type: 'files.index.build', location })
      else { await searchRequest({ type: 'files.index.delete', location }); setIndex(undefined) }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setPending(false) }
  }
  async function reveal(r: FileSearchResult) {
    try {
      const target = { ...location, path: r.archive || r.entry.path }
      await filesRequest({ type: 'files.properties', location: target })
      const folder = fileParentPath(target)
      const store = useFilesStore.getState(); store.navigate(s.side, { ...target, path: folder })
      const tab = currentTab(useFilesStore.getState().panes[s.side]); store.updateTab(s.side, tab.id, { revealPath: target.path, filter: '' })
      store.view({ ...target, path: folder }, { hidden: true }); useAppStore.getState().setSection('files'); close()
    } catch (e) { setError('Cannot open this result. It may have changed since the scan. ' + (e instanceof Error ? e.message : String(e))) }
  }
  const date = (value?: number) => value === undefined ? '' : new Date(value).toLocaleDateString('sv-SE')
  const dateValue = (value: string, end = false) => value ? new Date(value + (end ? 'T23:59:59.999' : 'T00:00:00')).getTime() : undefined
  const results = result?.results || [], pages = Math.max(1, Math.ceil(results.length / 40)), current = Math.min(page, pages - 1)
  return <BadgeDialog title="Search files" className="fm-search-dialog" close={close} footer={<>{busy ? <button className="button secondary" disabled={pending} onClick={() => void request('cancel')}>Stop search</button> : <button className="button primary" disabled={pending || q.source === 'index' && !index} onClick={() => void request('search')}><Search size={15} />Search</button>}</>}>
    <div className="fm-search-scope"><span title={`${fileSourceLabel(location)} · ${location.path}${location.root ? " · Root" : ''}`}>{fileSourceLabel(location)} · {location.path}{location.root ? " · Root" : ''}</span><IconButton label="Search help" aria-expanded={help} onClick={() => setHelp(!help)}><HelpCircle size={16} /></IconButton></div>
    {help && <div className="fm-search-help">Filter names in a file panel filters only that list. Scan folders reads the selected folder, with optional subfolders. Saved index searches a snapshot of names, sizes and dates without reading the phone. Update it after files change.<br />Name patterns support * and ? or regular expressions. Text search matches literal text in UTF-8 or UTF-16 with BOM, up to 2 MiB per file. Archive search reads ZIP/APKS up to 64 MiB, without extracting files or searching nested archives. Links and Android kernel folders are not followed. Limits: 100,000 objects, 2,000 displayed matches, 5 minutes. Skipped objects are reported.</div>}
    <fieldset className="fm-search-fields" disabled={busy || pending}>
      <label>Search in<select value={q.source} onChange={e => update({ source: e.target.value as typeof q.source, ...(e.target.value === 'index' ? { text: '', archives: false } : {}) })}><option value="live">Scan folders</option><option value="index">Saved index</option></select></label>
      <label className="fm-search-name">Name<input autoComplete="off" placeholder={q.nameMode === 'glob' ? "*.apk" : q.nameMode === 'regex' ? "\\.(apk|apks)$" : "All names"} value={q.name} onChange={e => update({ name: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void request('search') } }} /></label>
      <label>Match<select value={q.nameMode} onChange={e => update({ nameMode: e.target.value as typeof q.nameMode })}><option value="contains">Contains</option><option value="glob">Wildcard (*, ?)</option><option value="regex">Regular expression</option></select></label>
      <label>Type<select value={q.kind} onChange={e => update({ kind: e.target.value as typeof q.kind })}><option value="any">Files and folders</option><option value="file">Files</option><option value="directory">Folders</option></select></label>
      <label className="fm-search-text">Containing text<input disabled={q.source === 'index'} placeholder={q.source === 'index' ? "Available in Scan folders" : "Optional · plain text"} value={q.text} onChange={e => update({ text: e.target.value })} /></label>
      <label>Min size (MiB)<input type="number" min="0" step="any" value={q.minSize === undefined ? '' : q.minSize / 1024 ** 2} onChange={e => update({ minSize: e.target.value === '' ? undefined : Math.round(Number(e.target.value) * 1024 ** 2) })} /></label>
      <label>Max size (MiB)<input type="number" min="0" step="any" value={q.maxSize === undefined ? '' : q.maxSize / 1024 ** 2} onChange={e => update({ maxSize: e.target.value === '' ? undefined : Math.round(Number(e.target.value) * 1024 ** 2) })} /></label>
      <label>Modified from<input type="date" value={date(q.after)} onChange={e => update({ after: dateValue(e.target.value) })} /></label>
      <label>Modified through<input type="date" value={date(q.before)} onChange={e => update({ before: dateValue(e.target.value, true) })} /></label>
      <div className="fm-search-options"><label><input type="checkbox" checked={q.recursive} onChange={e => update({ recursive: e.target.checked })} />Subfolders</label><label><input type="checkbox" checked={q.caseSensitive} onChange={e => update({ caseSensitive: e.target.checked })} />Case sensitive</label><label><input type="checkbox" disabled={q.source === 'index'} checked={q.archives} onChange={e => update({ archives: e.target.checked })} />Inside ZIP / APKS</label></div>
    </fieldset>
    {q.source === 'index' && <div className="fm-search-index"><span>{index ? `${index.count.toLocaleString('en-US')} objects · Updated ${new Date(index.updatedAt).toLocaleString('en-US')}` : "No saved index for this folder."}<small>Saved snapshot · files may have changed</small></span><button className="button secondary" disabled={busy || pending} onClick={() => void request('build')}>{index ? "Update index" : "Build index"}</button><IconButton label="Delete saved index" disabled={!index || busy || pending} onClick={() => void request('delete')}><Trash2 size={15} /></IconButton></div>}
    {error && <p role="alert" className="file-error">{error}</p>}
    {result && <div className="fm-search-summary" role="status"><strong>{busy ? `${result.operation === 'index' ? "Indexing" : "Searching"} · ${result.scanned.toLocaleString('en-US')} checked · ${result.matched.toLocaleString('en-US')} matches` : result.message}</strong>{busy && <span title={result.current}>{result.current}</span>}{result.status === 'cancelled' || result.status === 'error' ? <span>Results below are incomplete.</span> : null}{result.warnings.length > 0 && <details><summary>{result.warnings.length}{" search notices"}</summary>{result.warnings.map(w => <p key={w}>{w}</p>)}</details>}</div>}
    {!!results.length && <><div className="fm-search-results"><table><thead><tr><th>Name / location</th><th>Size</th><th>Modified</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{results.slice(current * 40, current * 40 + 40).map((r, i) => <tr key={`${r.entry.path}:${r.member || ''}:${i}`}><td><strong>{r.archive && <Archive size={14} />}{r.entry.name}</strong><small title={r.archive ? `${r.archive} → ${r.member}` : r.entry.path}>{r.archive ? `${r.archive} → ${r.member}` : r.entry.path}</small></td><td>{r.entry.kind === 'directory' ? "Folder" : fileSize(r.entry.size)}</td><td>{new Date(r.entry.modified).toLocaleDateString('en-US')}</td><td><IconButton label={`Copy path of ${r.entry.name}`} onClick={() => void copyText(r.archive ? `${r.archive}!/${r.member}` : r.entry.path).catch(e => setError(String(e)))}><Copy size={14} /></IconButton><IconButton label={r.archive ? `Show archive ${fileBase(r.archive)}` : `Show ${r.entry.name} in folder`} onClick={() => void reveal(r)}><FolderOpen size={15} /></IconButton></td></tr>)}</tbody></table></div><div className="fm-search-pages"><button className="text-button" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</button><span>{current + 1} / {pages} · {results.length}{" shown"}</span><button className="text-button" disabled={current + 1 === pages} onClick={() => setPage(current + 1)}>Next</button></div></>}
  </BadgeDialog>
}
