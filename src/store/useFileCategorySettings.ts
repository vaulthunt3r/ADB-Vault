import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { defaultCategoryOptions, type CategoryOptions, type FileCategory } from '../../electron/file-categories'
import { bookmarkKey, savedFileLocation } from '../../electron/file-places'
import { normalizeSearchFolders, type SearchFolders } from '../../electron/file-search-folders'
import type { FileLocation } from '../../electron/files-protocol'
import { useConnectionStore } from './useConnectionStore'

type FolderRules = Pick<SearchFolders, 'include' | 'exclude'>
export const categorySettingsKey = (location: FileLocation) => bookmarkKey(savedFileLocation(location, useConnectionStore.getState().devices))
interface CategorySettings {
  options: Partial<Record<FileCategory, CategoryOptions>>
  scopes: Record<string, { location: FileLocation; rules: Partial<Record<FileCategory, FolderRules>> }>
  change: (category: FileCategory, patch: Partial<CategoryOptions>) => void
  folders: (location: FileLocation, category: FileCategory, rules: FolderRules) => void
}
export const useFileCategorySettings = create<CategorySettings>()(persist((set) => ({
  options: {}, scopes: {},
  change: (category, patch) => set(s => ({ options: { ...s.options, [category]: { ...defaultCategoryOptions, ...s.options[category], ...patch } } })),
  folders: (location, category, rules) => {
    const valid = normalizeSearchFolders({ ...rules, skipNames: [] }), key = categorySettingsKey(location)
    set(s => ({ scopes: { ...s.scopes, [key]: { location: savedFileLocation(location, useConnectionStore.getState().devices), rules: { ...s.scopes[key]?.rules, [category]: { include: valid.include, exclude: valid.exclude } } } } }))
  },
}), { name: 'adb-vault-file-categories', partialize: s => ({ options: s.options, scopes: s.scopes }) }))
