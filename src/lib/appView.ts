import { t } from "./i18n"
import type { AndroidApp } from '../../electron/apps-protocol'
import type { AppBadgeEvidence } from '../../electron/app-details-protocol'
import type { BadgeKey } from './appDetails'
import { badgeFilterChoices, badgeFilterResult } from './badgeFilters'
import { storageTotals } from './appDetails'
import { matchesAppSearch, parseAppSearch } from './appSearch'

export interface AppFilters {
  badges: BadgeKey[]
  badgeMatch: 'all' | 'any'
  type: 'all' | 'system' | 'user'
  updatedSystem: boolean
  availability: 'all' | 'enabled' | 'disabled'
  stopped: boolean
  suspended: boolean
  packaging: 'all' | 'single' | 'split'
  installer: string
  targetSdkMin: number | null
  targetSdkMax: number | null
}
export type AppSortKey = 'label' | 'packageName' | 'firstInstallTime' | 'lastUpdateTime' | 'targetSdk' | 'minSdk' | 'apkSizeBytes' | 'dataBytes' | 'dataWithoutCache' | 'cacheBytes' | 'installer' | 'debuggable'
export interface AppSort { key: AppSortKey; direction: 'asc' | 'desc' }
export const defaultAppFilters = (): AppFilters => ({ badges: [], badgeMatch: 'all', type: 'all', updatedSystem: false, availability: 'all', stopped: false, suspended: false, packaging: 'all', installer: '', targetSdkMin: null, targetSdkMax: null })
export const defaultAppSort = (): AppSort => ({ key: 'label', direction: 'asc' })
export const appSortFields: { key: AppSortKey; label: string; ascending: string; descending: string }[] = [
  { key: 'label', get label() { return t("Name") }, ascending: 'A → Z', descending: 'Z → A' },
  { key: 'packageName', get label() { return t("Package name") }, ascending: 'A → Z', descending: 'Z → A' },
  { key: 'firstInstallTime', get label() { return t("Installation date") }, get ascending() { return t("Oldest first") }, get descending() { return t("Newest first") } },
  { key: 'lastUpdateTime', get label() { return t("Last update date") }, get ascending() { return t("Oldest first") }, get descending() { return t("Newest first") } },
  { key: 'targetSdk', get label() { return t("Target SDK") }, get ascending() { return t("Lowest first") }, get descending() { return t("Highest first") } },
  { key: 'minSdk', get label() { return t("Minimum SDK") }, get ascending() { return t("Lowest first") }, get descending() { return t("Highest first") } },
  { key: 'apkSizeBytes', get label() { return t("APK size") }, get ascending() { return t("Smallest first") }, get descending() { return t("Largest first") } },
  { key: 'dataBytes', get label() { return t("Data (includes cache)") }, get ascending() { return t("Smallest first") }, get descending() { return t("Largest first") } },
  { key: 'dataWithoutCache', get label() { return t("Data (excludes cache)") }, get ascending() { return t("Smallest first") }, get descending() { return t("Largest first") } },
  { key: 'cacheBytes', get label() { return t("Cache") }, get ascending() { return t("Smallest first") }, get descending() { return t("Largest first") } },
  { key: 'installer', get label() { return t("Installer") }, ascending: 'A → Z', descending: 'Z → A' },
  { key: 'debuggable', get label() { return t("Debuggable") }, get ascending() { return t("No first") }, get descending() { return t("Yes first") } },
]
export const isStorageSort = (key: AppSortKey) => ['dataBytes', 'dataWithoutCache', 'cacheBytes'].includes(key)
export const appSortDirection = (key: AppSortKey): AppSort['direction'] => ['firstInstallTime', 'lastUpdateTime', 'apkSizeBytes', 'debuggable'].includes(key) || isStorageSort(key) ? 'desc' : 'asc'
export function appStorageValue(app: AndroidApp, key: 'dataBytes' | 'cacheBytes' | 'dataWithoutCache') {
  if (!app.storageRequested) return null
  const value = key === 'dataWithoutCache' ? storageTotals({ requested: true, appBytes: null, dataBytes: app.dataBytes ?? null, cacheBytes: app.cacheBytes ?? null }).dataWithoutCache : app[key]
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}
export function activeAppFilters(filters: AppFilters): { key: keyof AppFilters; label: string; badge?: BadgeKey }[] {
  const result: { key: keyof AppFilters; label: string; badge?: BadgeKey }[] = []
  for (const key of filters.badges) result.push({ key: 'badges', badge: key, label: t("Badge: {0}", [badgeFilterChoices.find(choice => choice.key === key)!.label]) })
  if (filters.type !== 'all') result.push({ key: 'type', label: filters.type === 'system' ? t("System") : t("User") })
  if (filters.updatedSystem) result.push({ key: 'updatedSystem', label: t("Updated system") })
  if (filters.availability !== 'all') result.push({ key: 'availability', label: filters.availability === 'enabled' ? t("Enabled") : t("Disabled") })
  if (filters.stopped) result.push({ key: 'stopped', label: t("Stopped") })
  if (filters.suspended) result.push({ key: 'suspended', label: t("Suspended") })
  if (filters.packaging !== 'all') result.push({ key: 'packaging', label: filters.packaging === 'single' ? t("Single APK") : t("Split APK") })
  if (filters.installer) result.push({ key: 'installer', label: t("Installer: {0}", [filters.installer === '@unknown' ? t("Unavailable") : filters.installer]) })
  if (filters.targetSdkMin != null) result.push({ key: 'targetSdkMin', label: t("Target SDK ≥ {0}", [filters.targetSdkMin]) })
  if (filters.targetSdkMax != null) result.push({ key: 'targetSdkMax', label: t("Target SDK ≤ {0}", [filters.targetSdkMax]) })
  return result
}
export function filterAndSortApps(apps: AndroidApp[], filters: AppFilters, search: string, sort: AppSort, evidence: Record<string, AppBadgeEvidence> = {}): AndroidApp[] {
  const query = parseAppSearch(search)
  const filtered = apps.filter(app => {
    const system = app.system || app.updatedSystemApp
    return (filters.type === 'all' || (filters.type === 'system' ? system : !system))
      && badgeFilterResult(app, evidence[app.packageName], filters.badges, filters.badgeMatch) === true
      && (!filters.updatedSystem || app.updatedSystemApp)
      && (filters.availability === 'all' || (filters.availability === 'enabled' ? app.enabled : !app.enabled))
      && (!filters.stopped || app.stopped) && (!filters.suspended || app.suspended)
      && (filters.packaging === 'all' || (app.splitCount != null && (filters.packaging === 'single' ? app.splitCount === 0 : app.splitCount > 0)))
      && (!filters.installer || (filters.installer === '@unknown' ? !app.installer?.trim() : app.installer === filters.installer))
      && (filters.targetSdkMin == null || app.targetSdk > 0 && app.targetSdk >= filters.targetSdkMin)
      && (filters.targetSdkMax == null || app.targetSdk > 0 && app.targetSdk <= filters.targetSdkMax)
      && matchesAppSearch(app, query)
  })
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
  const value = (app: AndroidApp): string | number | null => {
    if (sort.key === 'dataBytes' || sort.key === 'cacheBytes' || sort.key === 'dataWithoutCache') return appStorageValue(app, sort.key)
    if (sort.key === 'debuggable') return typeof app.debuggable === 'boolean' ? Number(app.debuggable) : null
    const v = app[sort.key]
    return typeof v === 'number' ? (v > 0 ? v : null) : typeof v === 'string' ? v.trim() || null : null
  }
  return filtered.sort((a, b) => {
    const av = value(a), bv = value(b)
    // Missing values always go last, independent of sort direction; zero storage is known.
    if (av === null && bv !== null) return 1
    if (bv === null && av !== null) return -1
    const order = av === null || bv === null ? 0 : typeof av === 'number' && typeof bv === 'number' ? av - bv : collator.compare(String(av), String(bv))
    return order ? order * (sort.direction === 'asc' ? 1 : -1) : a.packageName < b.packageName ? -1 : a.packageName > b.packageName ? 1 : 0
  })
}

export function formatApkSize(bytes: number | null | undefined): string {
  if (bytes == null || bytes <= 0) return t("Unavailable")
  const unit = bytes >= 1024 ** 3 ? 3 : bytes >= 1024 ** 2 ? 2 : bytes >= 1024 ? 1 : 0
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(bytes / 1024 ** unit)} ${['B', 'KiB', 'MiB', 'GiB'][unit]}`
}

export const formatStorageSize = (bytes: number | null | undefined) => bytes === 0 ? '0 B' : formatApkSize(bytes)
