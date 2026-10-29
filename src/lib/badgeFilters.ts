import { t } from "./i18n"
import type { AndroidApp } from '../../electron/apps-protocol'
import type { AppBadgeEvidence } from '../../electron/app-details-protocol'
import { badgeCatalog, badgeChecks, type BadgeKey } from './appDetails'

// Application type already has a dedicated filter. Planned checks cannot match any app yet.
export const badgeFilterChoices = badgeCatalog.filter(([key]) => key !== 'type').map(([key, label]) => ({
  key, label: key === 'trackers' ? t("Trackers") : key === 'splits' ? t("Split APK") : label,
  unavailable: key === 'magiskHide' ? t("Not supported") : null,
}))
export const isFilterBadge = (key: unknown): key is BadgeKey => badgeFilterChoices.some(choice => choice.key === key && !choice.unavailable)
export function badgeFilterResult(app: AndroidApp, evidence: AppBadgeEvidence | undefined, keys: BadgeKey[], mode: 'all' | 'any'): boolean | null {
  if (!keys.length) return true
  const checks = badgeChecks(app, evidence), values = keys.map(key => checks[key].present)
  if (mode === 'any') return values.includes(true) ? true : values.includes(null) ? null : false
  return values.includes(false) ? false : values.includes(null) ? null : true
}
