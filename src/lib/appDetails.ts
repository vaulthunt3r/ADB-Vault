import type { AndroidApp } from '../../electron/apps-protocol'
import type { AppDetails, AppBadgeEvidence, BadgeCheck } from '../../electron/app-details-protocol'
import { bloatwareAssessment } from './bloatware'

// App Manager manual §2.2.2.2 plus verified source tags; coverage and colour limits: BADGES.md.
export const badgeCatalog = [
  ['trackers', 'Tracker info'], ['type', 'Application type'], ['splits', 'Split APK info'],
  ['debuggable', 'Debuggable'], ['testOnly', 'Test only'], ['noCode', 'No code'], ['overlay', 'Overlay'], ['largeHeap', 'Large heap'],
  ['openLinks', 'Open links'], ['running', 'Running'], ['stopped', 'Stopped'], ['disabled', 'Disabled'],
  ['suspended', 'Suspended'], ['hidden', 'Hidden'], ['magiskHide', 'MagiskHide'], ['magiskDenyList', 'MagiskDenyList'],
  ['wx', 'WX'], ['bloatware', 'Bloatware'], ['keyStore', 'KeyStore'], ['backup', 'Backup'],
  ['batteryExempt', 'No battery optimisation'], ['sensorsDisabled', 'Sensors disabled'], ['netPolicy', 'Net policy'],
  ['ssaid', 'SSAID'], ['saf', 'SAF'], ['playAppSigning', 'Play App Signing'], ['xposed', 'Xposed'],
  ['staticSharedLibrary', 'Static Shared Library'],
  ['systemless', 'Systemless'],
] as const
export type BadgeKey = typeof badgeCatalog[number][0]
export type BadgeTone = 'neutral' | 'orange' | 'red' | 'dark-cyan' | 'purple' | 'green' | 'blue'
const unavailable: Partial<Record<BadgeKey, string>> = {
  magiskHide: 'MagiskHide requires a supported Magisk installation and a root collector. This ADB session does not inspect Magisk rules.',
  magiskDenyList: 'Enable Settings → Apps → Use root for additional app details, then refresh Details to inspect Magisk process rules.',
  wx: 'Android API and Target SDK have not been checked in this snapshot. Refresh details to run the compatibility check.',
  bloatware: 'Classification was not collected. Check Detection databases in Components. System applications are not automatically bloatware.',
  keyStore: 'Enable root in Settings → Apps and refresh Details to inspect alias metadata. Key material is not read.',
  backup: 'Local backup catalogue has not been checked.',
  ssaid: 'Enable root in Settings → Apps and refresh Details to read the existing app/user SSAID record. The shell Android ID is not substituted.',
  systemless: 'Enable root in Settings → Apps and refresh Details to check active Magisk module mounts.',
  playAppSigning: 'Play distribution metadata has not been collected in this snapshot. Refresh details to run the check. Installer identity alone is not evidence.',
}
export function badgeChecks(app: AndroidApp, details?: AppBadgeEvidence | null): Record<BadgeKey, BadgeCheck> {
  const result = Object.fromEntries(badgeCatalog.map(([key]): [BadgeKey, BadgeCheck] => [key, { present: null, reason: unavailable[key] || 'Not collected in this snapshot.', items: [] }])) as Record<BadgeKey, BadgeCheck>
  const set = (key: BadgeKey, present: boolean | null, reason: string, items: BadgeCheck['items'] = []) => { result[key] = { present, reason, items } }
  set('type', true, 'Application type reported by Android. Systemless installation is not inferred from the system flag alone.')
  set('splits', app.splitCount == null ? null : app.splitCount > 0, 'Installed split APKs, excluding the base APK.', details?.splits.map(s => ({ name: s.name, value: `${s.path} · ${s.bytes == null ? 'Size unavailable' : `${s.bytes.toLocaleString('en-US')} B`}` })) || [])
  set('debuggable', app.debuggable, 'Android marks this application as debuggable.')
  set('stopped', app.stopped, 'Android stopped flag. This is separate from whether a process is currently running.')
  set('disabled', !app.enabled, 'Android application enabled state for the selected profile.')
  set('suspended', app.suspended, 'Android suspended state for the selected profile.')
  for (const key of ['testOnly', 'noCode', 'largeHeap', 'hidden', 'batteryExempt', 'staticSharedLibrary', 'debuggable', 'disabled', 'suspended', 'stopped'] as const) {
    if (typeof details?.badges[key] === 'boolean') set(key, details.badges[key], 'Reported by Android for this application.')
  }
  if (typeof details?.badges.openLinks === 'boolean') set('openLinks', details.badges.openLinks,
    details.badges.openLinksByDefault === true ? 'At least one domain can open by default.' : details.badges.openLinksByDefault === false ? 'No supported domain can currently open by default.' : 'Default link handling could not be determined.',
    details.links.map(link => ({ name: link.host, value: link.state })))
  for (const [key] of badgeCatalog) if (details?.badgeChecks?.[key]) result[key] = details.badgeChecks[key]
  const areas: Record<string, BadgeKey> = { 'Hidden state': 'hidden', 'Battery optimisation': 'batteryExempt', 'App links': 'openLinks', 'Static shared library': 'staticSharedLibrary' }
  for (const issue of details?.issues || []) if (areas[issue.area]) result[areas[issue.area]].reason = issue.message
  result.backup = app.backupCheck ?? { present: null, reason: 'Local backup catalogue has not been checked.', items: [] }
  return result
}
export function appBadges(app: AndroidApp, details?: AppDetails | null) {
  const checks = badgeChecks(app, details)
  return badgeCatalog.flatMap(([key, name]) => {
    const check = checks[key]
    if (check.present !== true) return []
    let label: string = name
    let tone: BadgeTone = 'neutral'
    if (key === 'type') label = (details?.badges.updatedSystem ?? app.updatedSystemApp) ? 'Updated system' : (details?.badges.system ?? app.system) ? 'System' : 'User'
    if (key === 'splits') label = `${app.splitCount} ${app.splitCount === 1 ? 'split' : 'splits'}`
    if (key === 'trackers') { label = `${check.items.length} ${check.items.length === 1 ? 'tracker' : 'trackers'}`; tone = details?.badges.trackersBlocked === true ? 'dark-cyan' : 'orange' }
    if (key === 'openLinks') tone = details?.badges.openLinksByDefault === true ? 'red' : details?.badges.openLinksByDefault === false ? 'dark-cyan' : 'neutral'
    if (key === 'wx') tone = 'red'
    if (key === 'running') tone = 'purple'
    if (key === 'bloatware') tone = bloatwareAssessment(check).badgeTone
    return [{ key, label, tone, check, interactive: check.items.length > 0 || key === 'bloatware' }]
  })
}
export function storageTotals(storage: AppDetails['storage']) {
  const { appBytes, dataBytes, cacheBytes } = storage
  return {
    dataWithoutCache: dataBytes != null && cacheBytes != null && cacheBytes <= dataBytes ? dataBytes - cacheBytes : null,
    total: appBytes != null && dataBytes != null && Number.isSafeInteger(appBytes + dataBytes) ? appBytes + dataBytes : null,
  }
}
