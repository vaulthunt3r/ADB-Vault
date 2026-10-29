import { message } from "../lib/i18n"
import { t } from "../lib/i18n"
import { useAppsStore } from '../store/useAppsStore'
import { requestBackend } from '../lib/backend'
import { useEffect, useState } from 'react'
import type { AndroidApp } from '../../electron/apps-protocol'
import type { AppDetails, BadgeCheck } from '../../electron/app-details-protocol'
import { BadgeDialog } from './BadgeDialog'
import { BadgeLegend } from './BadgeLegend'
import { badgeAppearanceId, customBadgeStyle } from '../lib/badgeAppearance'
import { useBadgeAppearanceStore } from '../store/useBadgeAppearanceStore'
import { appBadges, badgeCatalog, badgeChecks, type BadgeKey } from '../lib/appDetails'
import { bloatwareAssessment } from '../lib/bloatware'
import { BloatwareDetails } from './BloatwareDetails'
import { Copy, FolderOpen } from 'lucide-react'
import { copyText } from '../lib/clipboard'
import { useAppStore } from '../store/useAppStore'

export function AppBadges({ app, data }: { app: AndroidApp; data?: AppDetails | null }) {
  const deviceId = useAppsStore(s => s.deviceId)
  return <ApplicationBadges identity={`${deviceId}-${app.packageName}-${app.userId}`} checks={badgeChecks(app, data)} badges={appBadges(app, data)} onSelect={key => { if (key === 'backup') void requestBackend({ type: 'apps.refreshBackups' }) }} />
}
export function ApplicationBadges({ identity, checks, badges, onSelect, local = false }: {
  identity: string; checks: Record<BadgeKey, BadgeCheck>; badges: ReturnType<typeof appBadges>; onSelect?: (key: BadgeKey) => void; local?: boolean
}) {
  const [selected, setSelected] = useState<BadgeKey | 'legend' | null>(null)
  const [revealing, setRevealing] = useState(false), [revealError, setRevealError] = useState('')
  useEffect(() => { setSelected(null) }, [identity])
  useEffect(() => { setRevealError('') }, [identity, selected])
  const { colors, textColors } = useBadgeAppearanceStore()
  const badge = selected && selected !== 'legend' ? checks[selected] : null
  const title = selected === 'openLinks' ? t("Supported domains") : selected === 'trackers' ? local ? t("Tracker signatures · DEX") : t("Tracker components") : t(badgeCatalog.find(([key]) => key === selected)?.[1] || '')
  return <>
    <div className="app-badges" aria-label={t("Application badges")}>{badges.map(b => b.interactive
      ? <button key={b.key} type="button" className={`app-info-badge ${b.tone}`} style={customBadgeStyle(colors[badgeAppearanceId(b.key, b.label, b.tone)], textColors[badgeAppearanceId(b.key, b.label, b.tone)])} title={b.key === 'bloatware' ? t("{0} · Android Debloat List\n{1}", [t(bloatwareAssessment(b.check).label), message(b.check.reason)]) : message(b.check.reason)} aria-haspopup="dialog" onClick={() => { setSelected(b.key); onSelect?.(b.key) }}>{message(b.label)}</button>
      : <span key={b.key} className={`app-info-badge ${b.tone}`} style={customBadgeStyle(colors[badgeAppearanceId(b.key, b.label, b.tone)], textColors[badgeAppearanceId(b.key, b.label, b.tone)])} title={message(b.check.reason)}>{message(b.label)}</span>)}</div>
    <button className="app-badge-checks-link" onClick={() => setSelected('legend')}>{t("Badge legend")}</button>
    {selected === 'legend' && <BadgeLegend checks={checks} local={local} close={() => setSelected(null)} />}
    {selected && selected !== 'legend' && <BadgeDialog title={title} close={() => setSelected(null)}>
        {selected === 'bloatware' && badge ? <BloatwareDetails check={badge} /> : <><p>{message(badge?.reason)}</p><dl className="app-badge-items">{badge?.items.map((item, index) => <div key={`${item.name}-${index}`}><dt className={selected === 'trackers' || selected === 'backup' && item.backupFile ? 'app-badge-item-name' : undefined}><span>{selected === 'backup' ? message(item.name) : item.name}</span>{selected === 'trackers' && <button type="button" className="icon-button" title={t("Copy component name")} aria-label={t("Copy {0}", [item.name])} onClick={() => void copyText(item.name).then(() => useAppStore.getState().notify("Copied"), () => useAppStore.getState().notify("Could not copy to the clipboard."))}><Copy size={14} /></button>}
          {selected === 'backup' && item.backupFile && <button type="button" className="icon-button" title={t("Show in folder")} aria-label={t("Show {0} in folder", [item.backupFile])} disabled={revealing} onClick={async () => {
            setRevealing(true); setRevealError('')
            try { await requestBackend({ type: 'apps.revealBackup', file: item.backupFile! }, setRevealError) }
            finally { setRevealing(false) }
          }}><FolderOpen size={16} /></button>}
        </dt><dd>{message(item.value)}</dd></div>)}</dl>{revealError && <p role="alert">{message(revealError)}</p>}</>}
        {selected === 'trackers' && <p className="app-badge-attribution">{t("Uses App Manager tracker signatures (GPL-3.0-or-later), including Exodus and ETIP contributions. Source files, revision and licences are available in Components → Detection databases.")}</p>}
    </BadgeDialog>}
  </>
}
