import { t as tr } from "../lib/i18n"
import { startFileCategory, stopCategoryForTab } from '../lib/fileCategories'
import { bookmarkKey, savedFileLocation, resolveFileReadLocation } from '../../electron/file-places'
import { useConnectionStore } from './useConnectionStore'
import type { FileCategory } from '../../electron/file-categories'
import type { FileSearchState } from '../../electron/file-search-protocol'
import { isNetworkPath } from '../../electron/file-locations'
import { create } from 'zustand'
import { useHistoryStore } from './useHistoryStore'
import { persist } from 'zustand/middleware'
import type { BackendReply } from '../../electron/contracts'
import { fileBase, type FileEntry, type FileListing, type FileLocation, type FileStorage, type FilesRequest, type FilesState } from '../../electron/files-protocol'

export const fileViews = ['compact', 'columned', 'detailed', 'wrapped', 'minimal', 'grid', 'gallery'] as const
export type FileView = typeof fileViews[number]
export interface FolderView { view: FileView; sort: 'name' | 'size' | 'modified' | 'type'; descending: boolean; hidden: boolean }
export interface FileTab { id: string; location: FileLocation; history: FileLocation[]; index: number; listing?: FileListing; selected: string[]; anchor?: string; cursor?: string; revealPath?: string; loading: boolean; error?: string; filter: string; request?: string; scroll: number; album?: string | null; extension?: string; category?: FileCategory; categoryScope?: FileLocation; categoryCached?: boolean; categoryState?: FileSearchState }
export interface FilePane { tabs: FileTab[]; active: string }
export type PaneSide = 'left' | 'right'
const tab = (location: FileLocation): FileTab => ({ id: crypto.randomUUID(), location, history: [location], index: 0, selected: [], loading: false, filter: '', scroll: 0 })
const left = tab({ kind: 'local', path: '' }), right = tab({ kind: 'local', path: '' })
export const locationKey = (l: FileLocation) => `${l.kind}:${l.id || ''}:${l.root ? 'root:' : ''}${l.path}`
export const storageKey = (l: FileLocation) => JSON.stringify([l.id, l.serial, l.transportId])
export const defaultFolderView: FolderView = { view: 'detailed', sort: 'name', descending: false, hidden: false }
interface FilesStore {
  clipboard?: import('../../electron/files-protocol').FileClipboardSelection
  panes: Record<PaneSide, FilePane>; active: PaneSide; initialized: boolean; tasks: FilesState; taskPanel: boolean; places: boolean
  networks: { name: string; path: string }[]
  storages: Record<string, { entries?: FileStorage[]; loading: boolean; request: string; error?: string }>
  loadStorages: (location: FileLocation, refresh?: boolean) => Promise<void>
  bookmarks: { name: string; location: FileLocation; kind?: FileEntry['kind'] }[]; recent: FileLocation[]; views: Record<string, FolderView>
  receive: (state: FilesState) => void
  updateTab: (side: PaneSide, id: string, patch: Partial<FileTab>) => void
  navigate: (side: PaneSide, location: FileLocation, newTab?: boolean) => void
  history: (side: PaneSide, direction: number) => void
  load: (side: PaneSide, recursive?: boolean, pattern?: string) => Promise<void>
  closeTab: (side: PaneSide, id: string) => void
  switchTab: (side: PaneSide, id: string) => void
  bookmark: (location: FileLocation, kind?: FileEntry['kind']) => void
  view: (location: FileLocation, patch: Partial<FolderView>, category?: FileCategory) => void
}
export async function filesRequest(r: FilesRequest): Promise<Extract<BackendReply, { ok: true }>> {
  if (!window.desktop) throw new Error('Start ADB Vault desktop to work with real files.')
  const reply = await window.desktop.request(r)
  if (reply.snapshot.files) useFilesStore.getState().receive(reply.snapshot.files)
  if (!reply.ok) throw new Error(reply.error)
  return reply
}
export const currentTab = (pane: FilePane) => pane.tabs.find(t => t.id === pane.active) || pane.tabs[0]
// Tabs can change panes while a read is pending. A response belongs to the tab,
// and its request token, rather than the pane in which the request started.
export function findFileTab(id: string) {
  const { panes } = useFilesStore.getState()
  for (const side of ['left', 'right'] as const) {
    const tab = panes[side].tabs.find(t => t.id === id)
    if (tab) return { side, tab }
  }
}
export const selectedEntries = (t: FileTab): FileEntry[] => t.listing?.entries.filter(e => t.selected.includes(e.path)) || []
export const useFilesStore = create<FilesStore>()(persist((set, get) => ({
  panes: { left: { tabs: [left], active: left.id }, right: { tabs: [right], active: right.id } }, active: 'left', initialized: false,
  tasks: { tasks: [], revision: 0 }, taskPanel: false, places: false, networks: [], bookmarks: [], recent: [], views: {}, storages: {},
  loadStorages: async (location, refresh = false) => {
    if (location.kind !== 'device') return
    const key = storageKey(location), previous = get().storages[key]
    if (previous?.loading || previous && !refresh) return
    const request = crypto.randomUUID()
    set(s => ({ storages: { ...s.storages, [key]: { entries: previous?.entries, loading: true, request } } }))
    try {
      const reply = await filesRequest({ type: 'files.storages', location: { ...location, path: '/', root: false } })
      if (!reply.fileStorages) throw new Error('Storage list unavailable. Refresh to try again.')
      if (get().storages[key]?.request === request) set(s => ({ storages: { ...s.storages, [key]: { entries: reply.fileStorages, loading: false, request } } }))
    } catch (error) {
      if (get().storages[key]?.request === request) set(s => ({ storages: { ...s.storages, [key]: { loading: false, request, error: error instanceof Error ? error.message : String(error) } } }))
    }
  },
  receive: state => {
    const previous = get()
    if (state.revision < previous.tasks.revision) return
    const newConflict = state.tasks.some(t => t.conflict && !previous.tasks.tasks.some(old => old.id === t.id && old.conflict?.source === t.conflict!.source && old.conflict?.destination === t.conflict!.destination))
    if (newConflict && !previous.taskPanel) useHistoryStore.setState({ filesSession: null })
    set({ tasks: state, taskPanel: previous.taskPanel || newConflict })
  },
  updateTab: (side, id, patch) => set(s => ({ panes: { ...s.panes, [side]: { ...s.panes[side], tabs: s.panes[side].tabs.map(t => t.id === id ? { ...t, ...patch } : t) } } })),
  navigate: (side, location, newTab = false) => {
    const s = get(), pane = s.panes[side], previous = currentTab(pane)
    if (!newTab && previous.category) stopCategoryForTab(side, previous.id)
    if (newTab) { const next = tab(location); set({ panes: { ...s.panes, [side]: { tabs: [...pane.tabs, next], active: next.id } } }) }
    else s.updateTab(side, previous.id, { location, category: undefined, categoryScope: undefined, categoryCached: false, album: undefined, extension: undefined, categoryState: undefined, history: [...previous.history.slice(0, previous.index + 1), location].slice(-100), index: Math.min(previous.index + 1, 99), listing: undefined, selected: [], anchor: undefined, cursor: undefined, revealPath: undefined, filter: '', error: undefined, scroll: 0 })
    const devices = useConnectionStore.getState().devices, saved = savedFileLocation(location, devices)
    set({ recent: [saved, ...get().recent.filter(l => bookmarkKey(savedFileLocation(l, devices)) !== bookmarkKey(saved))].slice(0, 20) }); void get().load(side)
  },
  history: (side, direction) => {
    const t = currentTab(get().panes[side]), index = t.index + direction
    if (index < 0 || index >= t.history.length) return
    if (t.category) stopCategoryForTab(side, t.id)
    get().updateTab(side, t.id, { index, category: undefined, categoryScope: undefined, categoryCached: false, album: undefined, extension: undefined, categoryState: undefined, location: t.history[index], listing: undefined, selected: [], anchor: undefined, cursor: undefined, revealPath: undefined, filter: '', scroll: 0 }); void get().load(side)
  },
  load: async (side, recursive = false, pattern = '*') => {
    const t = currentTab(get().panes[side])
    if (t.category) { try { await startFileCategory(side, t.category, t.categoryScope || t.location) } catch (error) { const owner = findFileTab(t.id); if (owner?.tab.category === t.category && owner.tab.request === t.request) get().updateTab(owner.side, t.id, { error: error instanceof Error ? error.message : String(error) }) }; return }
    const request = crypto.randomUUID(); get().updateTab(side, t.id, { loading: true, error: undefined, request })
    try {
      const location = resolveFileReadLocation(t.location, useConnectionStore.getState().devices)
      const reply = await filesRequest({ type: 'files.list', location, recursive, pattern })
      const owner = findFileTab(t.id), current = owner?.tab
      if (!owner || current?.request !== request) return
      if (!reply.fileListing) throw new Error('Folder listing unavailable. Refresh to try again.')
      const listing = reply.fileListing
      const revealed = current.revealPath && listing.entries.find(e => e.path === current.revealPath)
      get().updateTab(owner.side, t.id, { listing, location: listing.location, history: current.history.map((l, i) => i === current.index ? listing.location : l), loading: false, revealPath: undefined, ...(revealed ? { cursor: revealed.path, anchor: revealed.path } : {}), selected: current.revealPath ? listing.entries.filter(e => e.path === current.revealPath).map(e => e.path) : current.selected.filter(p => listing.entries.some(e => e.path === p && (!current.listing || current.listing.entries.find(old => old.path === p)?.fingerprint === e.fingerprint))) })
    } catch (error) {
      const owner = findFileTab(t.id), message = error instanceof Error ? error.message : String(error)
      const profile = t.location.kind === 'device' && /^\/storage\/emulated\/(\d+)(?:\/|$)/.exec(t.location.path)
      const profileHint = profile && /Permission denied|Operation not permitted|does not allow reading|No such file/i.test(message) ? ` This is storage for Android profile ID ${profile[1]}. Start and unlock that profile on the phone. Android may still block ADB access; granted root access may help but does not unlock encrypted data.` : ''
      if (owner?.tab.request === request) get().updateTab(owner.side, t.id, { loading: false, error: message + profileHint + (isNetworkPath(t.location.path) ? tr(" For network sign-in, use SMB / Samba in the source selector.") : ''), selected: [], listing: undefined })
    }
  },
  closeTab: (side, id) => { const s = get(), p = s.panes[side]; if (p.tabs.length === 1) return; stopCategoryForTab(side, id); const tabs = p.tabs.filter(t => t.id !== id); set({ panes: { ...s.panes, [side]: { tabs, active: p.active === id ? tabs[Math.max(0, p.tabs.findIndex(t => t.id === id) - 1)].id : p.active } } }) },
  switchTab: (side, id) => { const s = get(); set({ active: side, panes: { ...s.panes, [side]: { ...s.panes[side], active: id } } }); if (!currentTab(get().panes[side]).listing) void get().load(side) },
  bookmark: (location, kind) => set(s => { const saved = savedFileLocation(location, useConnectionStore.getState().devices); const matches = (l: FileLocation) => bookmarkKey(savedFileLocation(l, useConnectionStore.getState().devices)) === bookmarkKey(saved); return { bookmarks: s.bookmarks.some(b => matches(b.location)) ? s.bookmarks.filter(b => !matches(b.location)) : [...s.bookmarks, { name: fileBase(location.path) || tr("This PC"), kind, location: saved }] } }),
  view: (location, patch, category) => set(s => {
    const key = locationKey(location) + (category ? '#' + category : '')
    const prune = (pane: FilePane): FilePane => ({ ...pane, tabs: pane.tabs.map(t => {
      if (locationKey(t.location) + (t.category ? '#' + t.category : '') !== key) return t
      const hiddenPaths = new Set(t.listing?.entries.filter(e => e.hidden).map(e => e.path))
      const visible = (path: string) => path === '..' || !fileBase(path).startsWith('.') && !hiddenPaths.has(path)
      return { ...t, selected: t.selected.filter(visible), anchor: t.anchor && visible(t.anchor) ? t.anchor : undefined, cursor: t.cursor && visible(t.cursor) ? t.cursor : undefined }
    }) })
    return { views: { ...s.views, [key]: { ...(s.views[key] || defaultFolderView), ...patch } }, ...(patch.hidden === false ? { panes: { left: prune(s.panes.left), right: prune(s.panes.right) } } : {}) }
  }),
}), {
  name: 'adb-vault-files', version: 3,
  migrate: value => { const s = value as FilesStore; const seen = new Set<string>(); const aliases: Record<string, FileView> = { details: 'detailed', tiles: 'grid', thumbnails: 'gallery' }; return { ...s, views: Object.fromEntries(Object.entries(s.views || {}).map(([key, value]) => [key, { ...value, view: aliases[value.view] || (fileViews.includes(value.view) ? value.view : 'detailed') }])), bookmarks: (s.bookmarks || []).map(b => ({ ...b, location: savedFileLocation(b.location) })).filter(b => { const key = bookmarkKey(b.location); if (seen.has(key)) return false; seen.add(key); return true }), recent: (s.recent || []).map(l => savedFileLocation(l)) } },
  partialize: s => ({ panes: Object.fromEntries(Object.entries(s.panes).map(([side, p]) => [side, { active: p.active, tabs: p.tabs.map(t => ({ ...tab({ ...t.location, root: false }), id: t.id })) }])), bookmarks: s.bookmarks, networks: s.networks, views: s.views, recent: s.recent, places: s.places, initialized: s.initialized }),
}))
