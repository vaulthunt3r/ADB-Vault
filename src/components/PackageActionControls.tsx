import { t as translateUi } from '../lib/i18n'
import { locale as uiLocale } from '../lib/i18n'
import { t } from "../lib/i18n"
import type { AndroidApp } from '../../electron/apps-protocol'
import type { PackageAction, PackageActionOptions } from '../../electron/package-actions-protocol'
import { useAppsStore } from '../store/useAppsStore'
import { useConnectionStore } from '../store/useConnectionStore'
import { activityMessageSummary } from '../lib/activityMessage'

export function PackageActionControls({ value, onChange, disabled }: { value: PackageActionOptions; onChange: (value: PackageActionOptions) => void; disabled: boolean }) {
  const { deviceId, options } = useAppsStore(), devices = useConnectionStore(s => s.devices)
  const device = devices.find(d => d.id === deviceId)
  const rootAvailable = options.root && device?.root?.status === 'available' && !!device.root.method
  if (!rootAvailable && !value.root) return null
  return <div className="package-action-controls">
    <label><input type="checkbox" disabled={disabled || !rootAvailable} checked={value.root === true} onChange={e => onChange({ ...value, root: e.target.checked })} />{t("Use confirmed root")}</label>
  </div>
}
export function KeepAppData({ checked, disabled, onChange }: { checked: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  return <label className="package-keep-data" title={t("Passes -k (keep data/cache) when uninstalling from this profile. Retained data is not a backup.")}><input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />{t("Keep data when uninstalling")}</label>
}
export function PackageActionBadge({ apps, action, options }: { apps: AndroidApp[]; action: PackageAction; options: PackageActionOptions }) {
  const evidence = apps.map(app => app.actionEvidence?.filter(e => e.action === action && (!options.method || e.method === options.method) && e.root === (options.root === true) && e.keepData === (options.keepData === true)).reverse().sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0])
  const denied = evidence.filter(e => e?.outcome === 'denied').length
  const contextDenials = action === 'clear-cache' && !options.root ? apps.filter((app, i) => !evidence[i] && app.actionContext?.callerUid === 2000 && app.actionContext.cachePermission === 'denied').length : 0
  const first = evidence.find(Boolean), count = evidence.filter(Boolean).length + contextDenials
  if (!count) return <small className="package-action-badge" title={t("Availability is unknown. No successful operation or explicit restriction is recorded for this app, firmware, profile and access level.")}>{t("Unknown")}</small>
  const available = evidence.filter(e => e?.outcome === 'confirmed').length
  const restricted = denied + contextDenials
  const label = apps.length > 1 ? `${available} available · ${restricted} restricted · ${apps.length - available - restricted} unknown` : restricted ? t("Restricted") : first?.outcome === 'confirmed' ? t("Available") : t("Unknown")
  const detail = contextDenials ? t("Shell lacks INTERNAL_DELETE_CACHE_FILES. Permission is checked again before clearing cache; app data is never cleared as a fallback.") : apps.length > 1 ? t("Availability based on successful operations and explicit restrictions for this selection and access level. Unchecked or uncertain outcomes remain unknown.") : translateUi("{0}\nLast checked: {1}\nAvailable means this operation previously succeeded. Android can change its policy; this does not guarantee the next attempt.", [first ? activityMessageSummary(first.message) : '', first ? new Date(first.at).toLocaleString(uiLocale()) : ''])
  return <small className={`package-action-badge ${denied || contextDenials ? 'denied' : ''}`} title={detail}>{label}</small>
}
