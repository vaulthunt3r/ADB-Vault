import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { appColumns, defaultAppVisibility, type AppColumnId } from '../lib/appColumns'
import { appSortFields, defaultAppSort, defaultAppFilters, type AppFilters, type AppSort } from '../lib/appView'
import { isFilterBadge } from '../lib/badgeFilters'

interface AppsViewState {
  search: string
  setSearch: (search: string) => void
  filters: AppFilters
  setFilters: (filters: AppFilters) => void
  visibility: Record<string, boolean>
  sort: AppSort
  order: AppColumnId[]
  moveColumn: (id: AppColumnId, target: AppColumnId) => void
  setVisible: (id: AppColumnId, visible: boolean) => void
  setSort: (sort: AppSort) => void
  resetColumns: () => void
}
export function restoreAppsView(saved: unknown) {
  const value = saved as Partial<AppsViewState> | null
  const filters = defaultAppFilters(), savedFilters = value?.filters
  if (savedFilters) {
    if (Array.isArray(savedFilters.badges)) filters.badges = [...new Set(savedFilters.badges.filter(isFilterBadge))]
    if (savedFilters.badgeMatch === 'any') filters.badgeMatch = 'any'
    if (['all', 'system', 'user'].includes(savedFilters.type)) filters.type = savedFilters.type
    if (['all', 'enabled', 'disabled'].includes(savedFilters.availability)) filters.availability = savedFilters.availability
    if (['all', 'single', 'split'].includes(savedFilters.packaging)) filters.packaging = savedFilters.packaging
    for (const key of ['updatedSystem', 'stopped', 'suspended'] as const) if (typeof savedFilters[key] === 'boolean') filters[key] = savedFilters[key]
    if (filters.updatedSystem) filters.type = 'system'
    if (typeof savedFilters.installer === 'string' && savedFilters.installer.length <= 255 && (savedFilters.installer === '@unknown' || /^[A-Za-z0-9_.$]+$/.test(savedFilters.installer))) filters.installer = savedFilters.installer
    for (const key of ['targetSdkMin', 'targetSdkMax'] as const) if (typeof savedFilters[key] === 'number' && Number.isInteger(savedFilters[key]) && savedFilters[key] > 0 && savedFilters[key] <= 10000) filters[key] = savedFilters[key]
  }
  const visibility = defaultAppVisibility()
  for (const column of appColumns) if (column.id !== 'label' && typeof value?.visibility?.[column.id] === 'boolean') visibility[column.id] = value.visibility[column.id]
  const sort = value?.sort && appSortFields.some(field => field.key === value.sort?.key) && ['asc', 'desc'].includes(value.sort.direction) ? { key: value.sort.key, direction: value.sort.direction } : defaultAppSort()
  const order = [...new Set((Array.isArray(value?.order) ? value.order : []).filter(id => appColumns.some(c => c.id === id)))]
  for (const column of appColumns) if (!order.includes(column.id)) order.push(column.id)
  return { visibility, sort, order, filters }
}
export const useAppsViewStore = create<AppsViewState>()(persist(set => ({
  search: '', setSearch: search => set({ search }),
  filters: defaultAppFilters(), setFilters: filters => set({ filters }),
  visibility: defaultAppVisibility(), sort: defaultAppSort(), order: appColumns.map(c => c.id),
  moveColumn: (id, target) => set(state => {
    const order = [...state.order], from = order.indexOf(id), to = order.indexOf(target)
    if (from < 0 || to < 0 || from === to) return state
    order.splice(from, 1); order.splice(to, 0, id)
    return { order }
  }),
  setVisible: (id, visible) => { if (id !== 'label') set(state => ({ visibility: { ...state.visibility, [id]: visible } })) },
  setSort: sort => set({ sort }),
  resetColumns: () => set({ visibility: defaultAppVisibility(), order: appColumns.map(c => c.id) }),
}), {
  name: 'adb-vault-apps-view', version: 1,
  partialize: state => ({ visibility: state.visibility, sort: state.sort, order: state.order, filters: state.filters }),
  merge: (saved, current) => ({ ...current, ...restoreAppsView(saved) }),
}))
