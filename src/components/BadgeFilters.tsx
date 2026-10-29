import { t } from "../lib/i18n"
import { useRestoreBusy } from '../store/useRestoreStore'
import { useBackupStore } from '../store/useBackupStore'
import { useId, useMemo, useState, type ReactNode } from 'react'
import { badgeFilterChoices, badgeFilterResult } from '../lib/badgeFilters'
import { badgeDescriptions } from '../lib/badgeAppearance'
import { defaultAppSort, filterAndSortApps, type AppFilters } from '../lib/appView'
import { useAppsStore } from '../store/useAppsStore'
import { useAppActionsStore } from '../store/useAppActionsStore'
import { requestBackend } from '../lib/backend'
import { FilterBadge } from './FilterBadge'

export function BadgeFilterControls({ filters, setFilters }: { filters: AppFilters; setFilters: (value: AppFilters) => void }) {
  const [search, setSearch] = useState(''), id = useId()
  const choices = badgeFilterChoices.filter(choice => choice.label.toLowerCase().includes(search.trim().toLowerCase()))
  return <fieldset className="apps-badge-filter"><legend className="visually-hidden">{t("Badge conditions")}</legend>
    <div className="apps-filter-options">{(['all', 'any'] as const).map(mode => <label key={mode}><input type="radio" name={`${id}-badge-match`} checked={filters.badgeMatch === mode} onChange={() => setFilters({ ...filters, badgeMatch: mode })} />{mode === 'all' ? t("All selected badges") : t("Any selected badge")}</label>)}</div>
    <input className="apps-badge-search" type="search" aria-label={t("Search badges")} placeholder={t("Find a badge…")} value={search} onChange={event => setSearch(event.target.value)} />
    <div className="apps-badge-choices">{choices.map(choice => <label key={choice.key} title={badgeDescriptions[choice.key]}><input type="checkbox" aria-label={t("Badge {0}", [choice.label])} checked={filters.badges.includes(choice.key)} disabled={!!choice.unavailable} onChange={event => setFilters({ ...filters, badges: event.target.checked ? [...filters.badges, choice.key] : filters.badges.filter(key => key !== choice.key) })} /><span><FilterBadge badge={choice.key}>{choice.label}</FilterBadge>{choice.unavailable && <small> · {choice.unavailable}</small>}</span></label>)}{!choices.length && <p className="apps-filter-help">{t("No matching badges.")}</p>}</div>
    <p className="apps-filter-help">{t("Only confirmed matches are shown. Unchecked or unavailable information is not treated as an absent badge. Application type is selected in General.")}</p>
    <p className="apps-filter-help">{t("Backup uses the local export catalogue and needs no Android scan. Select a badge to enable Apply. For other badges it refreshes badge data for this profile using your root setting, without APK analysis. Trackers and Open links include all their states; colors show the main legend variant.")}</p>

  </fieldset>
}

export function BadgeFilterStatus({ filters, search }: { filters: AppFilters; search: string }) {
  const { apps, badgeEvidence } = useAppsStore()
  const unresolved = useMemo(() => {
    if (!filters.badges.length) return 0
    const candidates = filterAndSortApps(apps, { ...filters, badges: [] }, search, defaultAppSort())
    return candidates.filter(app => badgeFilterResult(app, badgeEvidence?.[app.packageName], filters.badges, filters.badgeMatch) === null).length
  }, [apps, filters, search, badgeEvidence])
  if (!filters.badges.length) return null
  return <div className="apps-badge-status" aria-live="polite">
    {filters.badges.length > 0 && <span>{t("Badges: ")}{filters.badgeMatch === 'all' ? t("all selected") : t("any selected")}. {unresolved > 0 ? t("{0} apps have unchecked or unavailable badge information and cannot yet be matched.", [unresolved]) : t("All candidate apps have a definite filter result.")}</span>}

  </div>
}

export function BadgeReadControls({ children, filters }: { children: ReactNode; filters: AppFilters }) {
  const { apps, deviceId, userId, badgeRead } = useAppsStore()
  const restoring = useRestoreBusy()
  const backupBusy = useBackupStore(s => s.state?.status === 'running') || restoring
  const actionBusy = useAppActionsStore(s => s.action?.status === 'running') || backupBusy
  const reading = badgeRead?.status === 'running'
  const hasBadgeFilters = filters.badges.length > 0
  const backupOnly = hasBadgeFilters && filters.badges.every(key => key === 'backup')
  return <div className="apps-badge-read-controls">
    {badgeRead && !backupOnly && <p className="apps-filter-help">{badgeRead.status === 'running' ? t("Reading badge information") : badgeRead.status === 'cancelled' ? t("Badge reading cancelled") : t("Badge reading complete")} · {badgeRead.completed} / {badgeRead.total}{badgeRead.failed > 0 ? t(" · {0} failed", [badgeRead.failed]) : ''}</p>}
    <div className="apps-popover-footer">{children}<button className="button secondary apps-filter-apply" title={backupOnly ? t("Recheck local backups. No Android badge reading.") : hasBadgeFilters ? t("Refresh badge data for all applications in this profile. General filters already apply immediately.") : t("No badge filters selected. General filters already apply immediately.")} disabled={!hasBadgeFilters || reading || actionBusy || !deviceId || userId === null || !apps.length} onClick={() => hasBadgeFilters && deviceId && userId !== null && void requestBackend(backupOnly ? { type: 'apps.refreshBackups' } : { type: 'apps.badges', id: deviceId, userId })}>{t("Apply")}</button></div>
  </div>
}

export function BadgeReadingProgress() {
  const badgeRead = useAppsStore(s => s.badgeRead)
  if (badgeRead?.status !== 'running') return null
  return <div className="apps-badge-status apps-badge-progress" role="status"><span>{t("Reading badge information · ")}{badgeRead.completed} / {badgeRead.total}</span><progress aria-label={t("Badge reading progress")} max={badgeRead.total || 1} value={badgeRead.completed} /><button className="text-button" onClick={() => void requestBackend({ type: 'apps.cancelBadges' })}>{t("Cancel badge reading")}</button></div>
}
