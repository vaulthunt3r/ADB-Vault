import type { BadgeCheck } from '../../electron/app-details-protocol'
import { badgeCatalog, type BadgeKey } from '../lib/appDetails'
import { badgeDescriptions, badgeVariants, customBadgeStyle } from '../lib/badgeAppearance'
import { useBadgeAppearanceStore } from '../store/useBadgeAppearanceStore'
import { BadgeDialog } from './BadgeDialog'
import { badgeCheckState } from '../lib/badgeCheckState'
import { useAppsStore } from '../store/useAppsStore'

export function BadgeLegend({ close, checks, local = false }: { close: () => void; checks?: Record<BadgeKey, BadgeCheck>; local?: boolean }) {
  const { colors, textColors } = useBadgeAppearanceStore()
  const rootEnabled = useAppsStore(s => !!s.options.root)
  return <BadgeDialog title="Badge legend" close={close}>
    <p>A complete guide to application badges. Customize their colors in Settings → Badges. Only confirmed properties appear on the application page.</p>
    {checks && <p>{local ? "Local APK inspection shows properties confirmed by the manifest and static analysis. Installation, running state, Android permission grants and other device-only checks are unavailable. The tracker badge counts DEX signatures; its result is shown below." : "Present: confirmed. Not present: checked and not found. Root required: enable root in Settings → Apps. Not supported: this collector or Android feature is unsupported. Not checked: no result yet. Access denied and Unavailable explain why a check failed. Backup checks local files saved by ADB Vault; open it to see which components were actually copied."}</p>}
    <dl className="app-badge-checks badge-legend">{badgeCatalog.map(([key, label]) => <div key={key}>
      <dt>{label}<div className="badge-legend-previews">{badgeVariants.filter(v => v.key === key).map(v => <span key={v.id} className={`app-info-badge ${v.tone}`} style={customBadgeStyle(colors[v.id], textColors[v.id])}>{v.label}</span>)}</div></dt>
      <dd><p>{local && key === 'trackers' ? "Known tracker signatures found in defined DEX classes. A match does not prove runtime activity." : local && key === 'type' ? "APK file type, independent of how the application might be installed on Android." : badgeDescriptions[key]}</p>{checks && <div className="badge-legend-result"><strong>{local && checks[key].present === null ? "Unavailable in this APK" : badgeCheckState(key, checks[key], rootEnabled)}</strong><p>{checks[key].reason}</p></div>}</dd>
    </div>)}</dl>
  </BadgeDialog>
}
