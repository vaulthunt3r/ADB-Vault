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
    <label><input type="checkbox" disabled={disabled || !rootAvailable} checked={value.root === true} onChange={e => onChange({ ...value, root: e.target.checked })} />Use confirmed root</label>
  </div>
}
export function KeepAppData({ checked, disabled, onChange }: { checked: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  return <label className="package-keep-data" title="Passes -k (keep data/cache) when uninstalling from this profile. Retained data is not a backup."><input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />Keep data when uninstalling</label>
}
export function PackageActionBadge({ apps, action, options }: { apps: AndroidApp[]; action: PackageAction; options: PackageActionOptions }) {
  const evidence = apps.map(app => app.actionEvidence?.filter(e => e.action === action && (!options.method || e.method === options.method) && e.root === (options.root === true) && e.keepData === (options.keepData === true)).reverse().sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0])
  const denied = evidence.filter(e => e?.outcome === 'denied').length
  const contextDenials = action === 'clear-cache' && !options.root ? apps.filter((app, i) => !evidence[i] && app.actionContext?.callerUid === 2000 && app.actionContext.cachePermission === 'denied').length : 0
  const first = evidence.find(Boolean), count = evidence.filter(Boolean).length + contextDenials
  if (!count) return <small className="package-action-badge" title="Availability is unknown. No successful operation or explicit restriction is recorded for this app, firmware, profile and access level.">Unknown</small>
  const available = evidence.filter(e => e?.outcome === 'confirmed').length
  const restricted = denied + contextDenials
  const label = apps.length > 1 ? `${available} available · ${restricted} restricted · ${apps.length - available - restricted} unknown` : restricted ? "Restricted" : first?.outcome === 'confirmed' ? "Available" : "Unknown"
  const detail = contextDenials ? "Shell lacks INTERNAL_DELETE_CACHE_FILES. Permission is checked again before clearing cache; app data is never cleared as a fallback." : apps.length > 1 ? "Availability based on successful operations and explicit restrictions for this selection and access level. Unchecked or uncertain outcomes remain unknown." : `${first ? activityMessageSummary(first.message) : ''}\nLast checked: ${first ? new Date(first.at).toLocaleString('en-US') : ''}\nAvailable means this operation previously succeeded. Android can change its policy; this does not guarantee the next attempt.`
  return <small className={`package-action-badge ${denied || contextDenials ? 'denied' : ''}`} title={detail}>{label}</small>
}
