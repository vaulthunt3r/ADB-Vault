import type { FileSearchQuery } from './file-search-protocol.js'

export interface SearchFolders { include: string[]; exclude: string[]; skipNames: string[] }

// Rules are relative to the selected scope. Keep validation shared with Settings.
export function normalizeSearchFolders(value: SearchFolders): SearchFolders {
  if (!value || typeof value !== 'object') throw new Error('Invalid folder rules.')
  const paths = (list: string[], names = false) => {
    if (!Array.isArray(list) || list.length > 100) throw new Error('Use up to 100 folders per list.')
    return [...new Set(list.map(p => {
      if (typeof p !== 'string' || !p.trim() || p.length > 1024 || /[\x00-\x1f:*?"<>|]/.test(p)) throw new Error('Enter a folder name or relative path, one per line.')
      const normalized = p.trim().replace(/\\/g, '/').replace(/\/$/, '')
      if (normalized.startsWith('/') || normalized.split('/').some(s => !s || s === '.' || s === '..') || names && normalized.includes('/')) throw new Error('Use paths inside the selected location, without parent-directory traversal.')
      return normalized
    }))]
  }
  return { include: paths(value.include), exclude: paths(value.exclude), skipNames: paths(value.skipNames, true) }
}

export function searchFolderPolicy(query: FileSearchQuery, caseInsensitive: boolean) {
  const rules = query.folders || { include: [], exclude: [], skipNames: [] }
  const normalize = (s: string) => caseInsensitive ? s.toLowerCase() : s
  const includes = rules.include.map(normalize), excludes = rules.exclude.map(normalize)
  const skipNames = new Set(rules.skipNames.map(s => s.toLowerCase()))
  const inside = (value: string, folder: string) => value === folder || value.startsWith(folder + '/')
  const allowed = (relative: string, directory = false) => {
    const value = normalize(relative), parts = relative.split('/')
    if (!directory) parts.pop()
    return !excludes.some(folder => inside(value, folder)) && !parts.some(p => skipNames.has(p.toLowerCase()))
      && (!includes.length || includes.some(folder => inside(value, folder)))
  }
  // Starting directly at included folders avoids scanning their siblings/parents.
  const roots = rules.include.filter((p, i) => !includes.some((parent, n) => n !== i && inside(normalize(p), parent) && (parent !== normalize(p) || n < i))).filter(p => allowed(p, true))
  return { allowed, roots: rules.include.length ? roots : [''] }
}
