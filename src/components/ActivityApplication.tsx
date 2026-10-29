import { useState } from 'react'
import { Grid2X2 } from 'lucide-react'
import { activityIcon, type ActivityOperation } from '../lib/activityOperation'

export function ActivityApplication({ item, compact = false }: { item: ActivityOperation['items'][number]; compact?: boolean }) {
  const icon = activityIcon(item.iconPng)
  const [broken, setBroken] = useState<string>()
  return <span className={`activity-application${compact ? " compact" : ''}`} title={item.packageName}>
    <span className="activity-application-icon">{icon && broken !== icon ? <img src={`data:image/png;base64,${icon}`} alt="" width={28} height={28} loading="lazy" onError={() => setBroken(icon)} /> : <Grid2X2 size={22} aria-hidden="true" />}</span>
    <span className="activity-application-name"><strong>{item.label || item.packageName}</strong>{!compact && <code>{item.packageName}</code>}</span>
  </span>
}
