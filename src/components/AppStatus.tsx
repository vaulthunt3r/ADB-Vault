import type { AndroidApp } from '../../electron/apps-protocol'
import { badgeDescriptions, badgeVariants, customBadgeStyle } from '../lib/badgeAppearance'
import { useBadgeAppearanceStore } from '../store/useBadgeAppearanceStore'

const states = [
  { key: 'disabled', label: "Disabled" },
  { key: 'stopped', label: "Stopped" },
  { key: 'suspended', label: "Suspended" },
] as const

export function AppStatus({ app }: { app: AndroidApp }) {
  const { colors, textColors } = useBadgeAppearanceStore()
  const active = states.filter(({ key }) => key === 'disabled' ? !app.enabled : app[key])
  return <span className="apps-package-states">
    {!active.length && <span className="app-status-enabled" title="Enabled — the app is enabled for this Android profile.">Enabled</span>}
    {active.map(({ key, label }) => <span key={key} className={`app-info-badge ${badgeVariants.find(variant => variant.id === key)!.tone}`} title={`${label} — ${badgeDescriptions[key]}`} style={customBadgeStyle(colors[key], textColors[key])}>{label}</span>)}
  </span>
}
