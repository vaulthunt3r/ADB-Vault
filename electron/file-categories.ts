import { defaultSearchQuery, type FileSearchQuery } from './file-search-protocol.js'
import type { FileLocation, FileStorage } from './files-protocol.js'
import { normalizeSearchFolders, type SearchFolders } from './file-search-folders.js'

export const fileCategories = {
  images: { label: 'Images', extensions: 'jpg|jpeg|png|gif|webp|bmp|heic|heif|avif|tif|tiff|svg|dng|raw' },
  videos: { label: 'Videos', extensions: 'mp4|mkv|webm|avi|mov|m4v|3gp|3g2|mpeg|mpg|ts|mts|m2ts|wmv|flv' },
  audio: { label: 'Audio', extensions: 'mp3|m4a|aac|flac|ogg|opus|wav|wma|aiff|amr|mid|midi|ape|alac' },
  documents: { label: 'Documents', extensions: 'pdf|txt|md|rtf|doc|docx|xls|xlsx|ppt|pptx|odt|ods|odp|csv|epub|fb2|djvu|log' },
  archives: { label: 'Archives', extensions: 'zip|7z|rar|tar|gz|bz2|xz|tgz|tbz2|txz|zst|lz4|cab|iso' },
} as const
export type FileCategory = keyof typeof fileCategories
export const serviceFolderGroups = {
  icons: { label: 'Icon folders', names: ['icons', '.icons'] },
  cache: { label: 'Cache folders', names: ['cache', '.cache'] },
  thumbnails: { label: 'Thumbnail folders', names: ['thumbnails', '.thumbnails'] },
} as const
export type ServiceFolderGroup = keyof typeof serviceFolderGroups
export interface CategoryOptions { visible: boolean; iconFiles: boolean; serviceFolders: ServiceFolderGroup[] }
export const defaultCategoryOptions: CategoryOptions = { visible: true, iconFiles: false, serviceFolders: [] }
export const categoryQuery = (category: FileCategory, options = defaultCategoryOptions, folders?: Pick<SearchFolders, 'include' | 'exclude'>): FileSearchQuery => ({
  ...defaultSearchQuery, name: '\\.(' + fileCategories[category].extensions + (category === 'images' && options.iconFiles ? '|ico|cur|icns' : '') + ')$', nameMode: 'regex', kind: 'file',
  folders: { include: folders?.include || [], exclude: folders?.exclude || [], skipNames: (Object.keys(serviceFolderGroups) as ServiceFolderGroup[]).filter(key => !options.serviceFolders.includes(key)).flatMap(key => [...serviceFolderGroups[key].names]) },
})

export function categoryScope(location: FileLocation, storages: FileStorage[] = []): FileLocation {
  if (location.kind === 'local') return { ...location }
  const selected = [...storages].sort((a, b) => b.path.length - a.path.length).find(s => location.path === s.path || location.path.startsWith(s.path + '/'))
  const removable = location.path.match(/^\/storage\/([A-Za-z0-9][A-Za-z0-9._-]*)(?:\/|$)/)
  const emulated = location.path.match(/^\/storage\/emulated\/\d+(?:\/|$)/)?.[0].replace(/\/$/, '')
  const path = selected?.path || emulated || (removable && !['emulated', 'self'].includes(removable[1]) ? '/storage/' + removable[1] : storages.find(s => s.kind === 'internal')?.path || '/sdcard')
  return { ...location, path }
}

// Convert selected real folder paths, including virtual albums, to Settings rules.
// Scope may be canonical while the preference is keyed by the original alias.
export function relativeCategoryFolders(scope: FileLocation, folders: string[]): string[] {
  const slash = (p: string) => scope.kind === 'local' ? p.replace(/\\/g, '/') : p
  const root = slash(scope.path).replace(/\/+$/, ''), prefix = root + '/'
  const compare = (p: string) => scope.kind === 'local' ? p.toLowerCase() : p
  if (!scope.path || !folders.length) throw new Error('Select folders inside the search location.')
  const paths = folders.map(folder => {
    const full = slash(folder).replace(/\/+$/, '')
    if (!compare(full).startsWith(compare(prefix)) || full.length <= prefix.length) throw new Error('Select folders inside the search location; the location itself cannot be added.')
    const relative = full.slice(prefix.length)
    const valid = normalizeSearchFolders({ include: [relative], exclude: [], skipNames: [] }).include[0]
    if (valid !== relative) throw new Error('This folder name cannot be represented by a category rule. Edit its rule in Settings.')
    return relative
  })
  const unique = new Map<string, string>()
  for (const p of paths) if (!unique.has(compare(p))) unique.set(compare(p), p)
  return [...unique.values()]
}

export function appendCategoryFolders(scope: FileLocation, previous: Pick<SearchFolders, 'include' | 'exclude'> | undefined, target: 'include' | 'exclude', folders: string[]): Pick<SearchFolders, 'include' | 'exclude'> {
  const rules = normalizeSearchFolders({ include: previous?.include || [], exclude: previous?.exclude || [], skipNames: [] })
  const selected = relativeCategoryFolders(scope, folders)
  const compare = (p: string) => scope.kind === 'local' ? p.toLowerCase() : p
  const known = new Set(rules[target].map(compare))
  for (const p of selected) if (!known.has(compare(p))) { rules[target].push(p); known.add(compare(p)) }
  const valid = normalizeSearchFolders(rules)
  return { include: valid.include, exclude: valid.exclude }
}
