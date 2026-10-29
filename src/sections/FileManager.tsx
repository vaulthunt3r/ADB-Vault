import { t as localeText } from '../lib/i18n'
import { locale as uiLocale } from '../lib/i18n'
import { message } from "../lib/i18n"
import { t as tr } from "../lib/i18n"
import { useHistoryStore } from '../store/useHistoryStore'
import { useFileCategorySettings } from '../store/useFileCategorySettings'
import { FileViewer, type ViewerSelection } from '../components/FileViewer'
import { resolveSavedFileLocation } from '../../electron/file-places'
import { fileCategories, categoryScope, type FileCategory } from '../../electron/file-categories'
import { startFileCategory } from '../lib/fileCategories'
import { useFileSearchStore } from '../store/useFileSearchStore'
import { useFileStorages } from '../components/FileStorageSelect'
import { NetworkFolderDialog } from '../components/NetworkFolderDialog'
import { fileParentPath } from '../../electron/file-locations'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowLeftRight, ArrowRight, Bookmark, Copy, FileInput, FilePlus, Folder, FolderOpen, FolderPlus, Home, Image as ImageIcon, Video, Music, FileText, Archive, Search, Info, ListTodo, Network, Pencil, Trash2, X } from 'lucide-react'
import { fileActionLabel, fileBase, fileTaskActive, type FileClipboardSelection, type FileAction, type FileEntry, type FileLocation, type FileProperties } from '../../electron/files-protocol'
import { currentTab, filesRequest, selectedEntries, storageKey, useFilesStore, type PaneSide } from '../store/useFilesStore'
import { useConnectionStore } from '../store/useConnectionStore'
import { useAppStore } from '../store/useAppStore'
import { useAppsStore } from '../store/useAppsStore'
import { useRestoreBusy } from '../store/useRestoreStore'
import { useBackupStore } from '../store/useBackupStore'
import { useAppActionsStore } from '../store/useAppActionsStore'
import { isInstallFile, openFileInstallation } from '../lib/fileInstall'
import { IconButton } from '../components/ui'
import { BadgeDialog } from '../components/BadgeDialog'
import { FileOperationDialog, type FilePrompt } from '../components/FileOperationDialog'
import { fileSize } from '../components/FileTasks'
import { FilePanel, deviceLocation, otherPane, fileReport } from '../components/FilePanel'
import { fileAccessHint, permissionSummary } from '../lib/filePermissions'

export function FileManager() {
  const state = useFilesStore(), connection = useConnectionStore()
  const apps = useAppsStore(), restoring = useRestoreBusy(), backupBusy = useBackupStore(s => s.state?.status === 'running'), actionBusy = useAppActionsStore(s => s.action?.status === 'running')
  const installBlocked = !window.desktop ? tr("Installation requires the desktop application.") : !connection.devices.some(d => d.id === connection.activeDeviceId && d.status === 'connected') ? tr("Connect and select the destination device in Connection.") : restoring || backupBusy || actionBusy || connection.busy || apps.status === 'loading' || apps.backgroundUserId !== null || apps.badgeRead?.status === 'running' || state.tasks.tasks.some(t => fileTaskActive(t) && (t.source.kind === 'device' || t.destination?.kind === 'device')) ? tr("Wait for the current device operation to finish.") : ''
  const [viewer, setViewer] = useState<(ViewerSelection & { sessionKey: string }) | null>(null)
  const viewFile = (selection: ViewerSelection) => setViewer({ ...selection, sessionKey: crypto.randomUUID() })
  const [prompt, setPrompt] = useState<FilePrompt | null>(null), [properties, setProperties] = useState<FileLocation | null>(null)
  const [network, setNetwork] = useState<{ side: PaneSide; initial?: string; discover?: boolean; error?: string } | null>(null)
  const finished = state.tasks.tasks.filter(t => !fileTaskActive(t)).map(t => t.id).join(',')
  const lastFinished = useRef(finished)
  useEffect(() => {
    const s = useFilesStore.getState()
    if (!s.initialized) {
      const d = connection.devices.find(d => d.id === connection.activeDeviceId && d.status === 'connected')
      useFilesStore.setState({ initialized: true })
      if (d) s.navigate('right', deviceLocation(d))
    }
    for (const side of ['left', 'right'] as const) { const t = currentTab(useFilesStore.getState().panes[side]); if (!t.loading && !t.category) void s.load(side) }
  }, [])
  useEffect(() => {
    if (lastFinished.current === finished) return
    lastFinished.current = finished
    for (const side of ['left', 'right'] as const) if (!currentTab(useFilesStore.getState().panes[side]).category) void useFilesStore.getState().load(side)
  }, [finished])
  const active = currentTab(state.panes[state.active]), selected = selectedEntries(active)
  function install(source: FileLocation, entries: FileEntry[]) {
    if (installBlocked) { useAppStore.getState().notify(installBlocked); return }
    if (!entries.length || !entries.every(isInstallFile)) return
    void openFileInstallation({ source: { ...source }, items: entries.map(e => ({ path: e.path, fingerprint: e.fingerprint })) })
  }
  function operation(action: FileAction, side = state.active, destination?: FileLocation, entries?: FileEntry[], source?: FileLocation, clipboard?: FileClipboardSelection) {
    const t = currentTab(useFilesStore.getState().panes[side]), targets = entries || selectedEntries(t)
    const unknown = targets.find(e => e.access === 'restricted' && !e.fingerprint)
    if (unknown && !['mkdir', 'create'].includes(action)) { useAppStore.getState().notify(fileAccessHint(unknown, (source || t.location).root)); return }
    if (t.category && ['mkdir', 'create'].includes(action)) return
    if (!['mkdir', 'create'].includes(action) && !targets.length || !t.location.path || t.loading && !t.category) return
    const to = ['copy', 'move'].includes(action) ? destination || currentTab(useFilesStore.getState().panes[otherPane(side)]).location : undefined
    if (to && !destination && currentTab(useFilesStore.getState().panes[otherPane(side)]).category) { useAppStore.getState().notify("Open a destination folder in the other panel first."); return }
    if (to && !to.path) { useAppStore.getState().notify("Open a destination folder in the other panel first."); return }
    setPrompt({ action, clipboard, source: source || t.location, destination: to, entries: ['mkdir', 'create'].includes(action) ? [] : targets, siblings: t.listing?.entries || [] })
  }
  function keys(e: KeyboardEvent) {
    if ((e.target as HTMLElement).matches('input, select, textarea') || (e.target as HTMLElement).closest('dialog') || e.altKey) return
    const command = ({ F5: 'copy', F6: 'move', F7: 'mkdir', F2: 'rename', Delete: 'delete' } as Record<string, FileAction>)[e.key]
    if (command) { e.preventDefault(); operation(command) }
    if (e.key === 'Tab' && !e.ctrlKey && ((e.target as HTMLElement).classList.contains('fm-list') || (e.target as HTMLElement).closest('.fm-parent-entry'))) { e.preventDefault(); const side = otherPane(state.active); useFilesStore.setState({ active: side }); document.getElementById(`fm-list-${side}`)?.focus() }
  }
  return <section className="fm-workspace" aria-label={tr("Files")} onKeyDown={keys}>
    <header className="fm-toolbar"><h1>{tr("Files")}</h1><button className="button secondary" aria-pressed={state.places} onClick={() => useFilesStore.setState({ places: !state.places })}><Bookmark size={14} />{tr("Places")}</button><IconButton label={tr("Swap panels")} onClick={() => useFilesStore.setState({ panes: { left: state.panes.right, right: state.panes.left }, active: otherPane(state.active) })}><ArrowLeftRight size={16} /></IconButton><span className="fm-toolbar-space" /><button className="button secondary" onClick={() => { if (!state.taskPanel) useHistoryStore.setState({ filesSession: null }); useFilesStore.setState({ taskPanel: !state.taskPanel }) }}><ListTodo size={15} />{tr("Tasks")}{state.tasks.tasks.some(fileTaskActive) && <span className="fm-count">{state.tasks.tasks.filter(fileTaskActive).length}</span>}</button></header>
    <div className="fm-body">{state.places && <Places navigate={l => state.navigate(state.active, l)} network={(initial, discover, error) => setNetwork({ side: state.active, initial, discover, error })} />}<div className="fm-panels">{(['left', 'right'] as const).map(side => <FilePanel key={side} side={side} network={side => setNetwork({ side })} operate={operation} properties={setProperties} install={install} installBlocked={installBlocked} viewFile={viewFile} />)}</div></div>
    {viewer && <FileViewer key={viewer.sessionKey} selection={viewer} close={() => setViewer(null)} />}
    <footer className="fm-commands">{([['copy', Copy, 'F5'], ['move', ArrowRight, 'F6'], ['mkdir', FolderPlus, 'F7'], ['create', FilePlus, ''], ['rename', Pencil, 'F2'], ['delete', Trash2, 'Del']] as const).map(([action, Icon, shortcut]) => <button className="button secondary" key={action} disabled={!active.location.path || active.loading || !!active.category && ['mkdir', 'create'].includes(action) || (!['mkdir', 'create'].includes(action) && !selected.length)} onClick={() => operation(action)}><Icon size={14} /><span>{tr(fileActionLabel[action])}</span>{shortcut && <kbd>{shortcut}</kbd>}</button>)}<button className="button secondary" disabled={!!installBlocked || active.loading || !selected.length || !selected.every(isInstallFile)} title={installBlocked || (selected.length && selected.every(isInstallFile) ? tr("Review {0} selected APK/APKS files before installation.", [selected.length]) : tr("Select APK/APKS files to install."))} onClick={() => install(active.location, selected)}><FileInput size={14} /><span>{tr("Install…")}</span></button></footer>
    {network && <NetworkFolderDialog side={network.side} initial={network.initial} discover={network.discover} initialError={network.error} close={() => setNetwork(null)} />}{prompt && <FileOperationDialog prompt={prompt} close={() => setPrompt(null)} />}{properties && <FilePropertiesDialog location={properties} close={() => setProperties(null)} />}
  </section>
}
function Places({ navigate, network }: { navigate: (l: FileLocation) => void; network: (initial?: string, discover?: boolean, error?: string) => void }) {
  const store = useFilesStore(), { bookmarks, recent, bookmark, networks } = store, { devices } = useConnectionStore()
  const options = useFileCategorySettings(s => s.options)
  const active = currentTab(store.panes[store.active]), scanning = useFileSearchStore(s => s.state?.status === 'running')
  const [opening, setOpening] = useState('')
  async function openNetwork(folder: { name: string; path: string }) {
    if (opening) return
    setOpening(folder.path)
    try {
      const reply = await filesRequest({ type: 'files.network.connect', address: folder.path, prompt: false })
      if (!reply.folder) return
      const path = reply.folder
      if (path !== folder.path) useFilesStore.setState(s => ({ networks: [...s.networks.filter(n => ![path.toLowerCase(), folder.path.toLowerCase()].includes(n.path.toLowerCase())), { ...folder, path }] }))
      navigate({ kind: 'local', path })
    } catch (error) { network(folder.path, false, error instanceof Error ? error.message : String(error)) }
    finally { setOpening('') }
  }

  const scope = categoryScope(active.location, store.storages[storageKey(active.location)]?.entries)
  const openSaved = (location: FileLocation, kind?: string) => void fileReport(async () => {
    const target = resolveSavedFileLocation(location, devices)
    navigate(kind === 'file' ? { ...target, path: fileParentPath(target) } : target)
    if (kind === 'file') { const s = useFilesStore.getState(); s.updateTab(s.active, currentTab(s.panes[s.active]).id, { revealPath: target.path }) }
  })
  return <nav className="fm-places" aria-label={tr("File locations")}><span className="eyebrow">{tr("Locations")}</span><button onClick={() => navigate({ kind: 'local', path: '' })}><Home size={15} />{tr("This PC")}</button><button onClick={() => void fileReport(async () => { const r = await filesRequest({ type: 'files.chooseFolder' }); if (r.folder) navigate({ kind: 'local', path: r.folder }) })}><FolderOpen size={15} />{tr("Choose folder…")}</button>{devices.filter(d => ['connected', 'recovery'].includes(d.status)).map(d => <PhonePlaces key={d.id} device={d} navigate={navigate} />)}<div className="fm-places-heading"><span className="eyebrow">{tr("Categories")}</span><IconButton label={tr("Category settings")} onClick={() => { useAppStore.setState({ settingsTab: 'files' }); useAppStore.getState().setSection('settings') }}><Pencil size={12} /></IconButton></div>{(Object.keys(fileCategories) as FileCategory[]).filter(category => options[category]?.visible !== false).map(category => { const Icon = ({ images: ImageIcon, videos: Video, audio: Music, documents: FileText, archives: Archive })[category]; return <button key={category} disabled={scanning} aria-pressed={active.category === category} title={tr("Search {0} in {1}", [tr(fileCategories[category].label).toLocaleLowerCase(), scope.path || tr("a folder you choose")])} onClick={() => void fileReport(() => startFileCategory(store.active, category))}><Icon size={14} />{tr(fileCategories[category].label)}</button> })}<span className="eyebrow">{tr("Network")}</span><button onClick={() => network(undefined, true)}><Search size={14} />{tr("Search network…")}</button><button onClick={() => network()}><Network size={14} />{tr("Add SMB folder…")}</button>{networks.map(n => <div className="fm-favorite" key={n.path}><button title={n.path} disabled={!!opening} onClick={() => void openNetwork(n)}><Network size={14} />{opening === n.path ? tr("Opening…") : n.name}</button><IconButton label={tr("Remove network folder {0}", [n.name])} onClick={() => useFilesStore.setState({ networks: networks.filter(o => o.path !== n.path) })}><X size={12} /></IconButton></div>)}<span className="eyebrow">{tr("Favorites")}</span>{bookmarks.length ? bookmarks.map((b, n) => <div className="fm-favorite" key={n}><button title={b.location.path} onClick={() => openSaved(b.location, b.kind)}><Bookmark size={14} />{b.name}</button><IconButton label={tr("Remove bookmark {0}", [b.name])} onClick={() => bookmark(b.location)}><X size={12} /></IconButton></div>) : <small>{tr("Bookmark a folder using the button beside its path.")}</small>}<span className="eyebrow">{tr("Recent locations")}</span>{recent.slice(0, 8).map((l, n) => <button key={n} title={l.path} onClick={() => openSaved(l)}><Folder size={14} />{fileBase(l.path) || tr("This PC")}</button>)}</nav>
}
function PhonePlaces({ device, navigate }: { device: ReturnType<typeof useConnectionStore.getState>['devices'][number]; navigate: (l: FileLocation) => void }) {
  const location = deviceLocation(device), storage = useFileStorages(location, true)
  return <div><button title={device.serial} onClick={() => navigate(location)}><Folder size={15} />{device.name}</button>
    {storage.entries.map(v => <button className="fm-place-child" key={v.path} title={v.path + (v.readOnly ? tr(" · Read only") : '')} onClick={() => navigate({ ...location, path: v.path })}>{v.name}</button>)}
    {!storage.entries.some(v => v.kind === 'sd') && <button className="fm-place-child" disabled title={storage.error || tr("Insert an SD card and refresh the phone panel.")}>{storage.loading ? tr("Reading storage…") : storage.error ? tr("SD card · Unavailable") : tr("SD card · Not mounted")}</button>}
    <button className="fm-place-child" onClick={() => navigate({ ...location, path: '/storage' })}>{tr("All storage folders")}</button>
    <button className="fm-place-child" onClick={() => navigate({ ...location, path: '/' })}>{tr("File system /")}</button>
  </div>
}
function FilePropertiesDialog({ location, close }: { location: FileLocation; close: () => void }) {
  const [value, setValue] = useState<FileProperties>(), [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function read(calculate = false) { setBusy(true); setError(''); try { const r = await filesRequest({ type: 'files.properties', location, calculate }); setValue(r.fileProperties) } catch (e) { setError(String(e)) } finally { setBusy(false) } }
  useEffect(() => { void read() }, [])
  return <BadgeDialog title={tr("Properties")} close={close}><div className="file-properties"><Info size={24} /><h3>{fileBase(location.path)}</h3><code>{location.path}</code>{value && <dl><dt>{tr("Type")}</dt><dd>{value.entry.kind}</dd><dt>{tr("Size")}</dt><dd>{value.entry.kind === 'directory' && value.bytes === undefined ? <button className="text-button" disabled={busy} onClick={() => void read(true)}>{localeText("Calculate folder size")}</button> : tr("{0} ({1} bytes)", [fileSize(value.bytes ?? value.entry.size), value.bytes ?? value.entry.size])}{value.count !== undefined && tr(" · {0} objects", [value.count])}</dd><dt>{tr("Modified")}</dt><dd>{new Date(value.entry.modified).toLocaleString(uiLocale())}</dd>{location.kind === 'device' && <><dt>{tr("Permissions")}</dt><dd><span className="file-permissions-value" tabIndex={0} title={permissionSummary(value.entry.mode, value.entry.kind === 'directory')} aria-label={permissionSummary(value.entry.mode, value.entry.kind === 'directory')}>{value.entry.mode || '—'}</span></dd><dt>{tr("Owner / group")}</dt><dd>{value.entry.uid} / {value.entry.gid}</dd><dt>{tr("Access")}</dt><dd>{location.root ? tr("Root requested for this tab") : tr("ADB Shell")}</dd></>}</dl>}{busy && <p>{tr("Reading properties…")}</p>}{error && <p role="alert" className="file-error">{message(error)}</p>}</div></BadgeDialog>
}
