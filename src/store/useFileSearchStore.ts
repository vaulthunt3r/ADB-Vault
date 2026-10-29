import { create } from 'zustand'
import { receiveCategorySearch } from '../lib/fileCategories'
import type { FileLocation } from '../../electron/files-protocol'
import { defaultSearchQuery, type FileSearchQuery, type FileSearchRequest, type FileSearchState } from '../../electron/file-search-protocol'
import type { PaneSide } from './useFilesStore'

interface SearchStore {
  visible: boolean; location: FileLocation | null; side: PaneSide; state: FileSearchState | null; draft: FileSearchQuery
  open: (location?: FileLocation, side?: PaneSide) => void; receive: (state: FileSearchState) => void
}
export const useFileSearchStore = create<SearchStore>((set, get) => ({
  visible: false, location: null, side: 'left', state: null, draft: defaultSearchQuery,
  open: (location, side) => set({ visible: true, ...(get().state?.status === 'running' ? { location: get().state!.location } : location ? { location, side: side || get().side } : {}) }),
  receive: state => { if (state.revision >= (get().state?.revision ?? -1)) { set({ state }); receiveCategorySearch(state) } },
}))
export async function searchRequest(request: FileSearchRequest) {
  if (!window.desktop) throw new Error('Start ADB Vault desktop to search real files.')
  const r = await window.desktop.request(request)
  if (r.snapshot.fileSearch) useFileSearchStore.getState().receive(r.snapshot.fileSearch)
  if (!r.ok) throw new Error(r.error)
  return r
}
