import type { ReactNode } from 'react'
import type { BadgeKey } from '../lib/appDetails'
import { badgeVariants, badgeAppearanceVariants, customBadgeStyle } from '../lib/badgeAppearance'
import { useBadgeAppearanceStore } from '../store/useBadgeAppearanceStore'

export function FilterBadge({ badge, variant, children }: { badge?: BadgeKey; variant?: string; children: ReactNode }) {
  const { colors, textColors } = useBadgeAppearanceStore()
  const appearance = (variant ? badgeAppearanceVariants.find(item => item.id === variant) : badgeVariants.find(item => item.key === badge))!
  return <span className={`app-info-badge filter-badge ${appearance.tone}`} data-badge-appearance={appearance.id} style={customBadgeStyle(colors[appearance.id], textColors[appearance.id])}>{children}</span>
}
