import { activeAppFilters, filterAndSortApps, type AppFilters } from './appView'
import { useAppsStore } from '../store/useAppsStore'
import { useAppsViewStore } from '../store/useAppsViewStore'
import { useAppsSelectionStore } from '../store/useAppsSelectionStore'
import { useBackupStore } from '../store/useBackupStore'

// Names describe the snapshot, never an instruction to enable/disable applications.
export function presetNames(filters: AppFilters, search: string, current: string[], marked: string[]) {
  const parts = activeAppFilters({ ...filters, badges: [] }).map(item => item.label)
  const query = search.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 24)
  if (query) parts.push(`Search ${query}`)
  const base = parts.join(' — ')
  const currentSet = new Set(current)
  const hidden = marked.filter(pkg => !currentSet.has(pkg)).length
  const suffix = `Selected ${marked.length}`
  const partial = marked.length !== current.length
  const markedName = hidden || !base ? suffix : partial ? `${base.slice(0, 77 - suffix.length)} — ${suffix}` : base
  const safe = (name: string) => name.slice(0, 80).replace(/[. ]+$/g, '')
  return { current: safe(base || (filters.badges.length ? "Filtered apps" : "All apps")), marked: safe(markedName), hidden }
}

export function openAppsBackup(preferred?: 'current' | 'marked', onlyMarked = false) {
  const apps = useAppsStore.getState(), view = useAppsViewStore.getState()
  if (!apps.deviceId || apps.userId === null) return
  const current = filterAndSortApps(apps.apps, view.filters, view.search, view.sort, apps.badgeEvidence).map(app => app.packageName)
  const marked = [...useAppsSelectionStore.getState().packages]
  const names = presetNames(view.filters, view.search, current, marked)
  const scopes = { current: { packages: current, hidden: 0, name: names.current }, marked: { packages: marked, hidden: names.hidden, name: names.marked } }
  const scope = preferred || (marked.length ? 'marked' : 'current')
  useBackupStore.getState().open({ purpose: onlyMarked ? 'backup' : 'preset', id: apps.deviceId, userId: apps.userId, ...scopes[onlyMarked ? 'marked' : scope], ...(!onlyMarked ? { scopes, scope } : {}) })
}
