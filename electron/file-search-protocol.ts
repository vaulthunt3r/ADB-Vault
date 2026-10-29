import type { FileEntry, FileLocation } from './files-protocol.js'
import type { SearchFolders } from './file-search-folders.js'

export interface FileSearchQuery {
  source: 'live' | 'index'; name: string; nameMode: 'contains' | 'glob' | 'regex'; caseSensitive: boolean
  recursive: boolean; kind: 'any' | 'file' | 'directory'; minSize?: number; maxSize?: number
  after?: number; before?: number; text: string; archives: boolean
  folders?: SearchFolders
}
export interface FileSearchResult { entry: FileEntry; archive?: string; member?: string }
export interface FileIndexInfo { updatedAt: string; count: number; location: FileLocation }
export interface FileSearchState {
  revision: number; id: string; status: 'idle' | 'running' | 'complete' | 'cancelled' | 'error'
  operation: 'search' | 'index'; location: FileLocation; query: FileSearchQuery
  scanned: number; matched: number; results: FileSearchResult[]; current: string; warnings: string[]
  message: string; index?: FileIndexInfo
  canonicalLocation?: FileLocation
}
export type FileSearchRequest =
  | { type: 'files.search'; location: FileLocation; query: FileSearchQuery }
  | { type: 'files.search.cancel'; id: string }
  | { type: 'files.index.info'; location: FileLocation }
  | { type: 'files.index.build'; location: FileLocation }
  | { type: 'files.index.delete'; location: FileLocation }

export const defaultSearchQuery: FileSearchQuery = { source: 'live', name: '', nameMode: 'contains', caseSensitive: false, recursive: true, kind: 'any', text: '', archives: false }
