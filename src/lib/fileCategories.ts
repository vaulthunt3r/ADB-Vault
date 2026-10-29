import { categoryQuery, categoryScope, defaultCategoryOptions, type FileCategory } from '../../electron/file-categories'
import { categorySettingsKey, useFileCategorySettings } from '../store/useFileCategorySettings'
import type { FileLocation } from '../../electron/files-protocol'
import type { FileSearchState } from '../../electron/file-search-protocol'
import { currentTab, findFileTab, filesRequest, locationKey, storageKey, useFilesStore, type PaneSide } from '../store/useFilesStore'
import { resolveFileReadLocation } from '../../electron/file-places'
import { useConnectionStore } from '../store/useConnectionStore'
import { searchRequest, useFileSearchStore } from '../store/useFileSearchStore'
import { useAppStore } from '../store/useAppStore'

let pending: { tab: string; category: FileCategory; location: FileLocation; query: string; key: string; after: number; cancelled?: boolean } | undefined
// Session-only, bounded results. Keys include the exact transport/access and rules.
const cache = new Map<string, FileSearchState>()
function remember(key: string, state: FileSearchState) {
  cache.delete(key); cache.set(key, state)
  if (cache.size > 12) cache.delete(cache.keys().next().value!)
}
const sameLocation = (a: FileLocation, b: FileLocation) => a.kind === b.kind && a.path === b.path && a.id === b.id && a.serial === b.serial && a.transportId === b.transportId && !!a.root === !!b.root

export function receiveCategorySearch(state: FileSearchState) {
  const store = useFilesStore.getState()
  const matchesPending = pending && state.revision > pending.after && JSON.stringify(state.query) === pending.query && sameLocation(state.location, pending.location)
  const key = matchesPending ? pending!.key : [...cache].find(([, old]) => old.id === state.id)?.[0]
  if (key) remember(key, state)
  if (matchesPending && pending?.cancelled) {
    pending = undefined
    if (state.status === 'running') void searchRequest({ type: 'files.search.cancel', id: state.id }).catch(() => {})
    return
  }
  for (const side of ['left', 'right'] as const) for (const tab of store.panes[side].tabs) {
    const opening = matchesPending && pending?.tab === tab.id
    if (!tab.category || !opening && tab.categoryState?.id !== state.id) continue
    const location = state.canonicalLocation || state.location
    store.updateTab(side, tab.id, { categoryState: state, categoryCached: false, loading: state.status === 'running', location, listing: { location, parent: location.path, entries: state.results.map(r => r.entry) }, ...(state.status === 'error' ? { error: state.message } : {}) })
    if (opening) pending = undefined
  }
}

export async function startFileCategory(side: PaneSide, category: FileCategory, refreshScope?: FileLocation) {
  const store = useFilesStore.getState(), tab = currentTab(store.panes[side])
  let location = refreshScope || tab.categoryScope || categoryScope(tab.location, store.storages[storageKey(tab.location)]?.entries)
  if (!location.path) {
    const reply = await filesRequest({ type: 'files.chooseFolder' })
    if (!reply.folder) return
    location = { kind: 'local', path: reply.folder }
  }
  location = resolveFileReadLocation(location, useConnectionStore.getState().devices)
  const owner = findFileTab(tab.id)
  // A delayed folder picker must not replace a tab that has since navigated or closed.
  if (!owner || owner.tab.location !== tab.location || owner.tab.request !== tab.request || owner.tab.category !== tab.category) return
  side = owner.side
  const settings = useFileCategorySettings.getState()
  const query = categoryQuery(category, settings.options[category] || defaultCategoryOptions, settings.scopes[categorySettingsKey(location)]?.rules[category])
  const queryKey = JSON.stringify(query), key = JSON.stringify([locationKey(location), location.serial, location.transportId, category, queryKey])
  const saved = !refreshScope && cache.get(key)
  if (saved && saved.status !== 'error') {
    const resolved = saved.canonicalLocation || saved.location
    store.updateTab(side, tab.id, { category, categoryScope: location, categoryState: saved, categoryCached: saved.status !== 'running', album: undefined, extension: undefined, location: resolved, selected: [], anchor: undefined, cursor: undefined, listing: { location: resolved, parent: resolved.path, entries: saved.results.map(r => r.entry) }, request: undefined, filter: '', scroll: 0, loading: saved.status === 'running', error: undefined })
    return
  }
  if (pending || useFileSearchStore.getState().state?.status === 'running') throw new Error('Stop the current file search before opening another category.')
  const request = crypto.randomUUID()
  const opening = { tab: tab.id, category, location, query: queryKey, key, after: useFileSearchStore.getState().state?.revision ?? -1 }
  pending = opening
  store.updateTab(side, tab.id, { category, categoryScope: location, categoryCached: false, album: undefined, extension: undefined, categoryState: undefined, request, location, selected: [], anchor: undefined, cursor: undefined, listing: { location, parent: location.path, entries: [] }, filter: '', scroll: 0, loading: true, error: undefined })
  if (['images', 'videos', 'audio'].includes(category) && !store.views[locationKey(location) + '#' + category]) store.view(location, { view: 'gallery', sort: 'modified', descending: true }, category)
  try { await searchRequest({ type: 'files.search', location, query }) }
  catch (error) { const current = findFileTab(tab.id); if (current?.tab.request === request && current.tab.category === category) store.updateTab(current.side, tab.id, { loading: false, error: error instanceof Error ? error.message : String(error) }); throw error }
  finally { if (pending === opening) pending = undefined }
}

export function stopCategoryForTab(side: PaneSide, id: string) {
  const tab = useFilesStore.getState().panes[side].tabs.find(t => t.id === id)
  if (pending?.tab === id) pending.cancelled = true
  if (tab?.categoryState?.status === 'running') void searchRequest({ type: 'files.search.cancel', id: tab.categoryState.id }).catch(() => {})
}

export function showFileSearch() {
  const id = useFileSearchStore.getState().state?.id, store = useFilesStore.getState()
  for (const side of ['left', 'right'] as const) {
    const tab = store.panes[side].tabs.find(t => t.category && t.categoryState?.id === id)
    if (tab) { store.switchTab(side, tab.id); useAppStore.getState().setSection('files'); return }
  }
  useFileSearchStore.getState().open()
}
