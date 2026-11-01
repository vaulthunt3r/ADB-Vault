import { useHistoryStore } from '../store/useHistoryStore'
import { fileAlbums } from '../lib/fileAlbums'
import type { ViewerSelection } from './FileViewer'
import { categoryScope, fileCategories } from '../../electron/file-categories'
import { CategoryFolderCommands } from './CategoryFolderCommands'
import { searchRequest } from '../store/useFileSearchStore'
import { bookmarkKey, savedFileLocation, resolveFileReadLocation } from '../../electron/file-places'
import { fileParentPath, fileBreadcrumbs, isNetworkPath, networkPath, networkRoot } from '../../electron/file-locations'
import { useFileSearchStore } from '../store/useFileSearchStore'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bookmark, ChevronRight, Eye, File, Folder, FolderOpen, Home, MoreHorizontal, Pencil, Plus, RefreshCw, Search, Shield, X } from 'lucide-react'
import { fileBase, filePattern, type FileClipboardSelection, type FileAction, type FileEntry, type FileLocation } from '../../electron/files-protocol'
import { currentTab, defaultFolderView, fileViews, filesRequest, locationKey, selectedEntries, storageKey, useFilesStore, type PaneSide, type FileView } from '../store/useFilesStore'
import { useConnectionStore } from '../store/useConnectionStore'
import { useAppStore } from '../store/useAppStore'
import { copyText } from '../lib/clipboard'
import { fileClipboardCommand, readFileClipboard, writeFileClipboard } from '../lib/fileClipboard'
import { IconButton } from './ui'
import { fileSize } from './FileTasks'
import { FileStorageSelect } from './FileStorageSelect'
import { isInstallFile } from '../lib/fileInstall'
import { FileSortMenu } from './FileSortMenu'
import { FileThumbnail } from './FileThumbnail'
import { LockKeyhole } from 'lucide-react'
import { fileAccessHint } from '../lib/filePermissions'

export const otherPane = (side: PaneSide): PaneSide => side === 'left' ? 'right' : 'left'
export async function fileReport(operation: () => Promise<unknown>) { try { await operation() } catch (e) { useAppStore.getState().notify(e instanceof Error ? e.message : String(e)) } }
export const deviceLocation = (d: ReturnType<typeof useConnectionStore.getState>['devices'][number], path = '/sdcard'): FileLocation => ({ kind: 'device', path, id: d.id, serial: d.serial, transportId: d.transportId, hardwareId: d.hardwareId })

export function FilePanel({ side, operate, properties, network, install, installBlocked, viewFile }: { viewFile: (selection: ViewerSelection) => void; side: PaneSide; network: (side: PaneSide) => void; operate: (action: FileAction, side?: PaneSide, destination?: FileLocation, entries?: FileEntry[], source?: FileLocation, clipboard?: FileClipboardSelection) => void; properties: (l: FileLocation) => void; install: (source: FileLocation, entries: FileEntry[]) => void; installBlocked: string }) {
  const s = useFilesStore(), pane = s.panes[side], t = currentTab(pane), devices = useConnectionStore(c => c.devices), active = side === s.active
  const [editingPath, setEditingPath] = useState(false), [path, setPath] = useState(t.location.path), [menu, setMenu] = useState(false), [search, setSearch] = useState(false), [pattern, setPattern] = useState('*'), [dragOver, setDragOver] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null), [viewport, setViewport] = useState({ width: 450, height: 400, top: 0 })
  const prefs = s.views[locationKey(t.location) + (t.category ? '#' + t.category : '')] || defaultFolderView, selected = selectedEntries(t), entries = t.listing?.entries || []
  const setView = (patch: Parameters<typeof s.view>[1]) => s.view(t.location, patch, t.category)
  const mediaCategory = !!t.category && ['images', 'videos', 'audio'].includes(t.category)
  const categoryFiles = entries.filter(e => !t.extension || e.name.toLowerCase().endsWith('.' + t.extension))
  const albums = mediaCategory ? fileAlbums(categoryFiles, t.location) : new Map()
  const albumOverview = mediaCategory && t.album === undefined
  const browsed: FileEntry[] = albumOverview ? [...albums.values()].map(a => a.entry) : mediaCategory && typeof t.album === 'string' ? categoryFiles.filter(e => fileParentPath({ ...t.location, path: e.path }) === t.album) : mediaCategory ? categoryFiles : entries
  const ruleSelection = browsed.filter(e => t.selected.includes(e.path))
  const ruleScope = t.categoryScope || categoryScope(t.location, s.storages[storageKey(t.location)]?.entries)
  // FileIO normally returns canonical paths. Keep Android public-storage aliases
  // usable as well, while saving the rule against the selected storage's scope.
  const alias = t.location.kind === 'device' ? t.location.path.match(/^\/(?:sdcard|storage\/self\/primary)(?=\/|$)/)?.[0] : undefined
  const ruleRoot = t.category ? t.location : alias ? { ...ruleScope, path: alias } : ruleScope
  const shown = browsed.filter(e => (prefs.hidden || !e.hidden && !e.name.startsWith('.')) && e.name.toLocaleLowerCase().includes(t.filter.toLocaleLowerCase())).sort((a, b) => {
    if (a.kind === 'directory' && b.kind !== 'directory') return -1
    if (b.kind === 'directory' && a.kind !== 'directory') return 1
    const compare = prefs.sort === 'size' ? a.size - b.size : prefs.sort === 'modified' ? a.modified - b.modified : prefs.sort === 'type' ? fileType(a).localeCompare(fileType(b), undefined, { sensitivity: 'base' }) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    return (compare || a.name.localeCompare(b.name)) * (prefs.descending ? -1 : 1)
  })
  const grid = ['columned', 'grid', 'gallery'].includes(prefs.view), previews = ['grid', 'gallery'].includes(prefs.view)
  const height = prefs.view === 'compact' || prefs.view === 'minimal' ? 27 : prefs.view === 'wrapped' ? 64 : prefs.view === 'gallery' ? 198 : prefs.view === 'grid' ? 126 : prefs.view === 'columned' ? 30 : 35
  const columns = grid ? Math.max(1, Math.floor(viewport.width / (prefs.view === 'gallery' ? 192 : prefs.view === 'columned' ? 180 : 138))) : 1
  const parent = t.listing?.parent ?? fileParentPath(t.location)
  const parentAvailable = mediaCategory && t.album !== undefined || !t.category && t.location.path !== parent
  const cursor = t.cursor === '..' && parentAvailable || shown.some(e => e.path === t.cursor) ? t.cursor : parentAvailable ? '..' : shown[0]?.path
  const listOffset = (grid ? 0 : 29) + (parentAvailable ? 30 : 0)
  const start = Math.max(0, Math.floor(Math.max(0, viewport.top - listOffset) / height) - 3) * columns, end = Math.min(shown.length, start + (Math.ceil(viewport.height / height) + 7) * columns), visible = shown.slice(start, end)
  const top = Math.floor(start / columns) * height, bottom = Math.max(0, Math.ceil((shown.length - end) / columns) * height)
  const device = devices.find(d => d.id === t.location.id), disconnected = t.location.kind === 'device' && (!device || !['connected', 'recovery'].includes(device.status) || device.serial !== t.location.serial || device.transportId !== t.location.transportId)
  useEffect(() => { setPath(t.location.path); setEditingPath(false); setMenu(false); if (list.current) list.current.scrollTop = t.scroll }, [t.id, t.location.path, t.filter, prefs.sort, prefs.descending, prefs.view, t.album, t.extension])
  useEffect(() => { const element = list.current; if (!element) return; const ro = new ResizeObserver(() => setViewport(v => ({ ...v, width: element.clientWidth, height: element.clientHeight }))); ro.observe(element); return () => ro.disconnect() }, [])
  useEffect(() => {
    if (!menu) return
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node) && !(event.target as HTMLElement).closest('.fm-filter')) setMenu(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [menu])
  const patch = (p: Parameters<typeof s.updateTab>[2]) => s.updateTab(side, t.id, p)
  const navigate = (l: FileLocation, newTab = false) => { s.navigate(side, l, newTab); list.current?.focus({ preventScroll: true }) }
  function refreshPanel() {
    void s.load(side)
    try {
      const location = resolveFileReadLocation(t.location, devices)
      if (location.kind === 'device') void s.loadStorages(location, true)
    } catch { /* The folder/category read reports the unavailable source. */ }
  }
  function goParent() {
    if (!parentAvailable) return
    if (mediaCategory && t.album !== undefined) { patch({ album: undefined, selected: [], cursor: undefined, scroll: 0 }); return }
    const previous = t.location.path
    navigate({ ...t.location, path: parent })
    s.updateTab(side, currentTab(useFilesStore.getState().panes[side]).id, { revealPath: previous })
    list.current?.focus({ preventScroll: true })
  }
  function enterPath() {
    try {
      const value = t.location.kind === 'local' && (/^smb:\/\//i.test(path) || isNetworkPath(path)) ? networkPath(path) : t.location.kind === 'local' && /^[A-Za-z]:[\\/]?$/.test(path) ? path.slice(0, 2) + '\\' : path.replace(/[\\/]+$/, '') || (t.location.kind === 'device' ? '/' : path)
      navigate({ ...t.location, path: value })
    } catch (error) { useAppStore.getState().notify(error instanceof Error ? error.message : String(error)) }
  }
  function select(e: FileEntry, ctrl: boolean, shift: boolean) {
    useFilesStore.setState({ active: side })
    if (shift) { const anchor = shown.some(e => e.path === t.anchor) ? t.anchor : cursor === '..' ? shown[0]?.path : e.path, a = shown.findIndex(e => e.path === anchor), b = shown.findIndex(o => o.path === e.path); patch({ selected: shown.slice(Math.max(0, Math.min(a, b)), Math.max(a, b) + 1).map(e => e.path), cursor: e.path, anchor }) }
    else patch({ selected: ctrl ? t.selected.includes(e.path) ? t.selected.filter(p => p !== e.path) : [...t.selected, e.path] : [e.path], anchor: e.path, cursor: e.path })
  }
  function open(e: FileEntry) {
    if (e.access === 'restricted') { useAppStore.getState().notify(fileAccessHint(e, t.location.root)); return }
    if (albumOverview) { patch({ album: e.path, selected: [], anchor: undefined, cursor: undefined, filter: '', scroll: 0 }); return }
    if (e.kind === 'directory' || e.kind === 'link') navigate({ ...t.location, path: e.path })
    else if (isInstallFile(e)) install(t.location, [e])
    else viewFile({ source: { ...t.location }, entries: shown.filter(e => e.kind === 'file' && !isInstallFile(e)), path: e.path })
  }
  function copySelected(mode: 'copy' | 'move' = 'copy') {
    if (!selected.length || disconnected) return
    const unknown = selected.find(e => e.access === 'restricted' && !e.fingerprint)
    if (unknown) { useAppStore.getState().notify(fileAccessHint(unknown, t.location.root)); return }
    const source = { ...t.location }, entries = selected.map(e => ({ ...e }))
    setMenu(false)
    void fileReport(() => fileClipboardCommand(async () => {
      const reply = await writeFileClipboard(source, entries, mode)
      if (reply.fileClipboard?.preparationError) throw new Error(reply.fileClipboard.preparationError)
      if (reply.fileClipboard?.preparationTaskId) { useAppStore.getState().notify("Preparing files for pasting… Follow progress or stop in Tasks."); return }
      useAppStore.getState().notify(`${entries.length} ${entries.length === 1 ? 'object' : 'objects'} ${mode === 'move' ? 'cut' : 'copied'}. ${source.kind === 'local' ? "Paste in ADB Vault or File Explorer." : "Paste in ADB Vault to move the originals. Use Copy to paste phone files in File Explorer."}`)
    }))
  }
  const pasting = useRef(false)
  function pasteSelected() {
    if (disconnected || pasting.current) return
    if (!t.location.path || t.category) { useAppStore.getState().notify("Open a destination folder before pasting."); return }
    const destination = { ...t.location }, tabId = t.id
    pasting.current = true; setMenu(false)
    void fileReport(() => fileClipboardCommand(async () => {
      const clipboard = await readFileClipboard()
      if (clipboard.preparationTaskId || clipboard.preparationError) { useHistoryStore.setState({ filesSession: null }); useFilesStore.setState({ taskPanel: true }); throw new Error(clipboard.preparationError || "Files are still being prepared or preparation was stopped. Check Tasks before pasting.") }
      const current = currentTab(useFilesStore.getState().panes[side])
      if (current.id !== tabId || locationKey(current.location) !== locationKey(destination) || current.location.transportId !== destination.transportId || current.category) throw new Error("The destination changed. Paste again in the destination folder.")
      operate(clipboard.mode, side, destination, clipboard.groups.flatMap(g => g.entries), clipboard.groups[0].source, clipboard)
    }).finally(() => { pasting.current = false }))
  }
  const isCut = (entry: FileEntry) => s.clipboard?.mode === 'move' && s.clipboard.groups.some(g => g.source.kind === t.location.kind && g.source.id === t.location.id && g.source.transportId === t.location.transportId && g.entries.some(e => e.path === entry.path))
  const openSelected = (withApp = false) => { setMenu(false); if (selected.length === 1) void fileReport(async () => { const location = resolveFileReadLocation({ ...t.location, path: selected[0].path }, useConnectionStore.getState().devices); const r = await filesRequest({ type: 'files.open', location, withApp }); if (r.notice) useAppStore.getState().notify(r.notice) }) }
  function listKeys(e: KeyboardEvent) {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).closest('.fm-parent-entry')) return
    if (e.altKey) { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); s.history(side, e.key === 'ArrowLeft' ? -1 : 1); list.current?.focus() }; return }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); patch({ selected: shown.map(e => e.path), anchor: shown[0]?.path }); return }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') { e.preventDefault(); setEditingPath(true); return }
    if ((e.ctrlKey || e.metaKey) && ['c', 'x', 'v'].includes(e.key.toLowerCase())) { e.preventDefault(); if (e.key.toLowerCase() === 'v') pasteSelected(); else copySelected(e.key.toLowerCase() === 'x' ? 'move' : 'copy'); return }
    if (t.loading && !t.category) return
    if (e.key === 'Backspace' || e.key === 'ArrowLeft' && !e.ctrlKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); goParent(); return }
    if (e.key === 'Enter' || e.key === 'ArrowRight' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault()
      if (cursor === '..') goParent()
      else { const entry = shown.find(entry => entry.path === cursor); if (entry && (e.key === 'Enter' || entry.kind === 'directory' || entry.kind === 'link')) open(entry) }
      return
    }
    if (e.key === 'Escape') { setMenu(false); patch({ selected: [], anchor: undefined }); return }
    if (['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', ' '].includes(e.key)) {
      e.preventDefault(); list.current?.focus({ preventScroll: true })
      const offset = parentAvailable ? 1 : 0, index = cursor === '..' ? 0 : shown.findIndex(entry => entry.path === cursor) + offset
      const page = Math.max(1, Math.floor(viewport.height / height) - 1) * columns
      const delta = e.key === 'ArrowUp' ? -columns : e.key === 'ArrowDown' ? cursor === '..' ? 1 : columns : e.key === 'PageUp' ? -page : e.key === 'PageDown' ? page : 0
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? shown.length - 1 + offset : Math.max(0, Math.min(shown.length - 1 + offset, index + delta))
      if (parentAvailable && next === 0) {
        if (e.key === ' ') return
        const anchor = shown.findIndex(entry => entry.path === t.anchor)
        patch({ cursor: '..', selected: e.shiftKey && anchor >= 0 ? shown.slice(0, anchor + 1).map(e => e.path) : e.ctrlKey || e.metaKey ? t.selected : [], ...(!e.shiftKey ? { anchor: undefined } : {}) })
        if (list.current) list.current.scrollTop = 0
        return
      }
      const entry = shown[next - offset]; if (!entry) return
      if ((e.ctrlKey || e.metaKey) && e.key !== ' ') patch({ cursor: entry.path })
      else select(entry, e.key === ' ', e.shiftKey)
      const row = listOffset + Math.floor((next - offset) / columns) * height; if (list.current && (row < list.current.scrollTop + (grid ? 0 : 29) || row + height > list.current.scrollTop + viewport.height)) list.current.scrollTop = Math.max(0, row - viewport.height / 2)
    }
  }
  function beginDrag(event: React.DragEvent, entry: FileEntry) { const chosen = t.selected.includes(entry.path) ? selected : [entry]; event.dataTransfer.setData('application/x-adb-vault-files', JSON.stringify({ source: t.location, entries: chosen })); event.dataTransfer.effectAllowed = 'copyMove' }
  function drop(event: React.DragEvent, destination = t.location) {
    event.preventDefault(); event.stopPropagation(); setDragOver(false)
    if (t.category && destination.path === t.location.path) return
    try { const value = JSON.parse(event.dataTransfer.getData('application/x-adb-vault-files')); if (Array.isArray(value.entries) && value.source && destination.path) operate(event.shiftKey ? 'move' : 'copy', side, destination, value.entries, value.source) } catch { /* Unrelated drag data is ignored. */ }
  }
  const marked = s.bookmarks.some(b => bookmarkKey(savedFileLocation(b.location, devices)) === bookmarkKey(savedFileLocation(t.location, devices)))
  function fileType(e: FileEntry) { const dot = e.name.lastIndexOf('.'); return e.kind === 'directory' || dot <= 0 ? '' : e.name.slice(dot + 1) }
  function nameCell(e: FileEntry) {
    const album = albumOverview ? albums.get(e.path) : undefined
    const preview = album?.cover || e
    return <>{previews && preview.kind === 'file' ? <FileThumbnail entry={preview} location={t.location} enabled={!disconnected} /> : prefs.view !== 'minimal' && (e.kind === 'directory' ? <Folder size={grid ? 25 : 17} className="fm-folder-icon" /> : <File size={grid ? 25 : 17} />)}<span title={e.path}>{e.name}{e.kind === 'link' && <small>Link</small>}</span>{e.access === 'restricted' && <span className="fm-access-mark" role="img" aria-label={fileAccessHint(e, t.location.root)} title={fileAccessHint(e, t.location.root)}><LockKeyhole size={13} aria-hidden="true" /></span>}{album && <small>{album.count}{" files"}</small>}</>
  }
  const rowEvents = (e: FileEntry) => ({ onClick: (event: React.MouseEvent) => { select(e, event.ctrlKey || event.metaKey, event.shiftKey); list.current?.focus({ preventScroll: true }) }, onDoubleClick: () => open(e), onContextMenu: (event: React.MouseEvent) => { event.preventDefault(); if (!t.selected.includes(e.path)) select(e, false, false); setMenu(true) }, draggable: !albumOverview, onDragStart: (event: React.DragEvent) => beginDrag(event, e), onDrop: (event: React.DragEvent) => { if (e.kind === 'directory') drop(event, { ...t.location, path: e.path }) } })
  const sortArrow = (sort: typeof prefs.sort) => prefs.sort === sort && <ArrowDown size={10} style={{ transform: prefs.descending ? undefined : 'rotate(180deg)' }} />
  const parentRow = parentAvailable && <button className={`fm-parent-entry${cursor === '..' ? " cursor" : ''}`} title="Parent folder · ← / Backspace · Enter on .." aria-current={cursor === '..' ? 'true' : undefined} aria-label={`Parent folder in ${side} panel`} onFocus={() => patch({ cursor: '..', selected: [], anchor: undefined })} onClick={goParent}><ArrowUp size={16} /><strong>..</strong><span>{mediaCategory ? "Albums" : "Parent folder"}</span></button>
  return <section className={`fm-pane${active ? " active" : ''}${dragOver ? " fm-drop-target" : ''}`} aria-label={`${side === 'left' ? "Left" : "Right"} file panel`} onFocusCapture={() => useFilesStore.setState({ active: side })} onMouseDown={() => { if (!active) useFilesStore.setState({ active: side }) }} onDragOver={e => { if (e.dataTransfer.types.includes('application/x-adb-vault-files')) { e.preventDefault(); e.dataTransfer.dropEffect = e.shiftKey ? 'move' : 'copy'; setDragOver(true) } }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false) }} onDrop={e => drop(e)}>
    <div className="fm-pane-heading"><select aria-label={`${side} source`} value={t.location.kind === 'local' ? isNetworkPath(t.location.path) ? 'network-current' : 'local' : t.location.id} onChange={e => { if (e.target.value === 'network-add') { network(side); return }; if (e.target.value === 'network-current') return; const d = devices.find(d => d.id === e.target.value); navigate(d ? deviceLocation(d) : { kind: 'local', path: '' }) }}><option value="local">This PC</option>{isNetworkPath(t.location.path) && <option value="network-current">{"SMB · "}{networkRoot(t.location.path)}</option>}<option value="network-add">SMB / Samba…</option>{devices.map(d => <option key={d.id} value={d.id}>{d.name}{!['connected', 'recovery'].includes(d.status) ? " · Offline" : ''}</option>)}{t.location.kind === 'device' && !device && <option value={t.location.id}>{t.location.serial}{" · Unavailable"}</option>}</select>{t.location.kind === 'device' && <FileStorageSelect location={t.location} connected={!disconnected} side={side} navigate={navigate} />}{t.location.kind === 'device' && <IconButton label={t.location.root ? "Root access enabled for this tab" : "Use root for this tab (requires granted Shell access)"} disabled={!t.location.root && device?.root?.status !== 'available'} aria-pressed={!!t.location.root} onClick={() => navigate({ ...t.location, root: !t.location.root })}><Shield size={15} /></IconButton>}<IconButton label={`Refresh ${side} panel`} disabled={t.loading} onClick={refreshPanel}><RefreshCw size={15} className={t.loading ? 'spin' : ''} /></IconButton></div>
    <div className="fm-tabs" role="tablist" aria-label={`${side} folder tabs`}>{pane.tabs.map(tab => <div key={tab.id} className={tab.id === t.id ? 'active' : ''} onDragOver={e => e.preventDefault()} onDrop={e => drop(e, tab.location)}><button role="tab" aria-selected={tab.id === t.id} title={tab.location.path || "This PC"} onClick={() => s.switchTab(side, tab.id)}>{tab.category ? fileCategories[tab.category].label : fileBase(tab.location.path) || "This PC"}</button>{pane.tabs.length > 1 && <IconButton label={`Close tab ${fileBase(tab.location.path) || "This PC"}`} onClick={() => s.closeTab(side, tab.id)}><X size={11} /></IconButton>}</div>)}<IconButton label={`New ${side} tab`} onClick={() => navigate(t.location, true)}><Plus size={14} /></IconButton></div>
    <div className="fm-path"><IconButton label={`Back in ${side} panel`} disabled={t.index === 0} onClick={() => s.history(side, -1)}><ArrowLeft size={14} /></IconButton><IconButton label={`Forward in ${side} panel`} disabled={t.index >= t.history.length - 1} onClick={() => s.history(side, 1)}><ArrowRight size={14} /></IconButton>{editingPath ? <form onSubmit={e => { e.preventDefault(); enterPath() }}><input aria-label={`${side} path`} autoFocus value={path} onChange={e => setPath(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setEditingPath(false) }} /></form> : <div className="fm-breadcrumb" title={t.location.path || "This PC"}><button onClick={() => navigate({ ...t.location, path: t.location.kind === 'device' ? '/' : '' })}><Home size={14} /></button>{fileBreadcrumbs(t.location).map(part => <span key={part.path}><ChevronRight size={11} /><button onClick={() => navigate({ ...t.location, path: part.path })}>{part.name}</button></span>)}</div>}<IconButton label={`Edit ${side} path`} onClick={() => setEditingPath(!editingPath)}><Pencil size={13} /></IconButton><IconButton label={marked ? "Remove folder bookmark" : "Bookmark this folder"} aria-pressed={marked} onClick={() => s.bookmark(t.location)}><Bookmark size={14} fill={marked ? 'currentColor' : 'none'} /></IconButton></div>
    <div className="fm-filter"><Search size={14} /><input type="search" aria-label={`Filter ${side} files`} placeholder="Filter names…" value={t.filter} onChange={e => patch({ filter: e.target.value, selected: [], anchor: undefined, cursor: undefined, scroll: 0 })} /><IconButton label={`Search ${side} folder`} disabled={!t.location.path} onClick={() => useFileSearchStore.getState().open(t.location, side)}><Search size={14} /></IconButton><IconButton label={`Show hidden files in ${side} panel`} aria-pressed={prefs.hidden} onClick={() => setView({ hidden: !prefs.hidden })}><Eye size={14} /></IconButton><select aria-label={`${side} file view`} value={prefs.view} onChange={e => setView({ view: e.target.value as FileView })}>{fileViews.map(view => <option key={view} value={view}>{view[0].toUpperCase() + view.slice(1)}</option>)}</select><FileSortMenu key={t.id + locationKey(t.location)} side={side} prefs={prefs} change={setView} onOpen={() => setMenu(false)} /><IconButton label={`${side} file actions`} onClick={() => setMenu(!menu)}><MoreHorizontal size={16} /></IconButton></div>
    {t.category && <div className="fm-category-summary"><div><strong>{fileCategories[t.category].label}</strong><small title={t.location.path}>{t.location.path}</small></div><span role="status">{t.loading ? `${t.categoryState?.scanned || 0} checked` : (t.categoryCached ? "Saved results · " : '') + ((t.categoryState?.message || '') || "Search unavailable")}</span>{t.loading && t.categoryState ? <button className="text-button" onClick={() => void fileReport(() => searchRequest({ type: 'files.search.cancel', id: t.categoryState!.id }))}>Stop</button> : <button className="text-button" onClick={() => navigate(t.location)}>Open folder</button>}{!!t.categoryState?.warnings.length && <details><summary>Search notices ({t.categoryState.warnings.length})</summary>{t.categoryState.warnings.map(w => <p key={w}>{w}</p>)}</details>}{t.categoryState && ['cancelled', 'error'].includes(t.categoryState.status) && <small>Results are incomplete.</small>}</div>}
    {mediaCategory && <div className="fm-album-navigation"><button className="text-button" aria-pressed={albumOverview} onClick={() => patch({ album: undefined, selected: [], cursor: undefined, scroll: 0 })}>Albums</button><button className="text-button" aria-pressed={t.album === null} onClick={() => patch({ album: null, selected: [], cursor: undefined, scroll: 0 })}>All files</button>{typeof t.album === 'string' && <span title={t.album}>{fileBase(t.album)}</span>}<select aria-label={`${side} media type`} value={t.extension || ''} onChange={e => patch({ extension: e.target.value, selected: [], cursor: undefined, scroll: 0 })}><option value="">All types</option>{[...new Set(entries.map(e => e.name.split('.').at(-1)!.toLowerCase()))].sort().map(ext => <option key={ext} value={ext}>{ext.toUpperCase()}</option>)}</select>{typeof t.album === 'string' && <IconButton label="Open album folder" onClick={() => navigate({ ...t.location, path: t.album! })}><FolderOpen size={14} /></IconButton>}</div>}
    {search && <div className="fm-pattern"><label>Pattern<input aria-label={`${side} name pattern`} value={pattern} placeholder="*.apk" onChange={e => setPattern(e.target.value)} /></label><button className="button secondary" disabled={t.loading} onClick={() => void fileReport(async () => { const re = filePattern(pattern); patch({ selected: shown.filter(e => re.test(e.name)).map(e => e.path) }) })}>Select</button><IconButton label="Close pattern selection" onClick={() => setSearch(false)}><X size={13} /></IconButton></div>}
    {menu && <div ref={menuRef} className="fm-menu" onKeyDown={e => { if (e.key === 'Escape') { setMenu(false); list.current?.focus() } }} role="group" aria-label="File commands">{ruleSelection.length > 0 && ruleSelection.length === t.selected.length && ruleSelection.every(e => e.kind === 'directory') && <CategoryFolderCommands key={t.id + (t.category || '')} scope={ruleScope} root={ruleRoot} paths={ruleSelection.map(e => e.path)} category={t.category} disabled={disconnected} done={() => setMenu(false)} />}<button disabled={!selected.length || disconnected} onClick={() => copySelected()}>Copy · Ctrl+C</button><button disabled={!selected.length || disconnected} onClick={() => copySelected('move')}>Cut · Ctrl+X</button><button disabled={ !!t.category || !t.location.path || disconnected} onClick={pasteSelected}>Paste · Ctrl+V</button><button disabled={!!installBlocked || disconnected || t.loading || !selected.length || !selected.every(isInstallFile)} title={installBlocked || "Select APK/APKS files to install."} onClick={() => { setMenu(false); install(t.location, selected) }}>Install…</button><button onClick={() => { patch({ selected: shown.map(e => e.path) }); setMenu(false) }}>Select all</button><button onClick={() => { setSearch(true); setMenu(false) }}>Select by pattern…</button><button onClick={() => { patch({ selected: [] }); setMenu(false) }}>Clear selection</button><button disabled={!selected.length} onClick={() => void fileReport(async () => { await copyText(selected.map(e => e.name).join('\n')); setMenu(false) })}>Copy names</button><button onClick={() => void fileReport(async () => { await copyText(selected.length ? selected.map(e => e.path).join('\n') : t.location.path); setMenu(false) })}>Copy paths</button><button disabled={selected.length !== 1 || selected[0]?.kind !== 'file'} onClick={() => openSelected()}>Open on computer…</button><button disabled={selected.length !== 1 || selected[0]?.kind !== 'file'} onClick={() => openSelected(true)}>Open with…</button><button disabled={!selected.length} onClick={() => { for (const e of selected) s.bookmark({ ...t.location, path: e.path }, e.kind); setMenu(false) }}>Bookmark selected</button>{t.category && <button disabled={selected.length !== 1} onClick={() => { const entry = selected[0]; navigate({ ...t.location, path: fileParentPath({ ...t.location, path: entry.path }) }); s.updateTab(side, currentTab(useFilesStore.getState().panes[side]).id, { revealPath: entry.path }); setMenu(false) }}>Show in folder</button>}<button disabled={selected.length !== 1} onClick={() => { properties({ ...t.location, path: selected[0].path }); setMenu(false) }}>Properties</button><button disabled={selected.length !== 1 || selected[0]?.kind !== 'directory'} onClick={() => { navigate({ ...t.location, path: selected[0].path }, true); setMenu(false) }}>Open in new tab</button><button disabled={selected.length !== 1 || selected[0]?.kind !== 'directory'} onClick={() => { s.navigate(otherPane(side), { ...t.location, path: selected[0].path }); setMenu(false) }}>Open in other panel</button><button disabled={!selected.length} onClick={() => { setMenu(false); operate('rename', side) }}>Batch rename…</button>{t.location.kind === 'device' && <button disabled={!selected.length} onClick={() => { setMenu(false); operate('chmod', side) }}>Permissions…</button>}<button onClick={() => setMenu(false)}>Close menu</button></div>}
    {disconnected && <p role="status" className="file-error">Phone unavailable or reconnected. Refresh this panel after reconnecting.</p>}{t.error && <p role="alert" className="file-error">{t.error}</p>}{t.listing?.warning && <p className="file-error">{t.listing.warning}</p>}
    <div className={`fm-list${grid ? " fm-grid-list" : ''}`} id={`fm-list-${side}`} ref={list} role="region" aria-label={`${side} folder contents`} tabIndex={0} onKeyDown={listKeys} onScroll={e => { const top = e.currentTarget.scrollTop; setViewport(v => ({ ...v, top })); patch({ scroll: top }) }}>
      {grid ? <>{parentRow}<div className={`fm-grid ${prefs.view}`} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}><div style={{ height: top, gridColumn: '1 / -1' }} />{visible.map(e => <div key={e.path} style={{ height }} className={`fm-tile${t.selected.includes(e.path) ? " selected" : ''}${cursor === e.path ? " cursor" : ''}${isCut(e) ? " cut" : ''}`} aria-label={e.name} aria-selected={t.selected.includes(e.path)} role="option" {...rowEvents(e)}>{nameCell(e)}{!albumOverview && prefs.view !== 'columned' && <small>{!e.fingerprint ? "Unknown" : e.kind === 'directory' ? "Folder" : fileSize(e.size)}</small>}</div>)}<div style={{ height: bottom, gridColumn: '1 / -1' }} /></div></> : <table className={`fm-table ${prefs.view}`} aria-label={`${side} files`}><thead><tr><th aria-sort={prefs.sort === 'name' ? prefs.descending ? 'descending' : 'ascending' : undefined}><button onClick={() => setView({ sort: 'name', descending: prefs.sort === 'name' && !prefs.descending })}>Name{sortArrow('name')}</button></th><th aria-sort={prefs.sort === 'size' ? prefs.descending ? 'descending' : 'ascending' : undefined}><button onClick={() => setView({ sort: 'size', descending: prefs.sort === 'size' && !prefs.descending })}>Size{sortArrow('size')}</button></th>{prefs.view === 'detailed' && <th aria-sort={prefs.sort === 'modified' ? prefs.descending ? 'descending' : 'ascending' : undefined}><button onClick={() => setView({ sort: 'modified', descending: prefs.sort === 'modified' && !prefs.descending })}>Modified{sortArrow('modified')}</button></th>}</tr></thead><tbody>{parentAvailable && <tr className="fm-parent-row"><td colSpan={prefs.view === 'detailed' ? 3 : 2}>{parentRow}</td></tr>}{top > 0 && <tr aria-hidden="true"><td colSpan={3} style={{ height: top, padding: 0 }} /></tr>}{visible.map(e => <tr key={e.path} style={{ height }} className={`${t.selected.includes(e.path) ? 'selected' : ''}${cursor === e.path ? " cursor" : ''}${isCut(e) ? " cut" : ''}`} aria-label={e.name} aria-selected={t.selected.includes(e.path)} {...rowEvents(e)}><td><span className="fm-name">{nameCell(e)}</span></td><td className="fm-size">{!e.fingerprint ? "Unknown" : e.kind === 'directory' ? "Folder" : e.kind === 'file' ? fileSize(e.size) : e.kind}</td>{prefs.view === 'detailed' && <td title={e.fingerprint ? new Date(e.modified).toLocaleString('en-US') : "Properties unavailable"}>{e.fingerprint ? new Date(e.modified).toLocaleDateString('en-US') : '—'}</td>}</tr>)}{bottom > 0 && <tr aria-hidden="true"><td colSpan={3} style={{ height: bottom, padding: 0 }} /></tr>}</tbody></table>}
      {!shown.length && <div className="file-empty"><FolderOpen size={30} /><p>{t.loading ? t.category ? "Searching files…" : "Reading folder…" : t.error ? "Folder could not be read" : t.category || t.filter ? "No matching files" : t.listing?.warning ? "No accessible files to display" : "This folder is empty"}</p></div>}
    </div><div className="fm-pane-footer"><span>{t.loading ? "Reading…" : `${shown.length} ${albumOverview ? 'albums' : 'objects'}`}{t.selected.length > 0 && ` · ${t.selected.length} selected`}</span>{t.listing?.free !== undefined && <span>{fileSize(t.listing.free)}{" free"}</span>}</div>
  </section>
}
