import { badgeCatalog, type BadgeKey, type BadgeTone } from './appDetails'
import { bloatwareAssessments } from './bloatware'

export const badgeDescriptions: Record<BadgeKey, string> = {
  systemless: 'The installed APK matches an active Magisk module mount. Disabled, removed and skip_mount modules are excluded. Requires the root setting; custom mount systems are not inspected.',
  trackers: 'App components match tracker signatures. The count represents components, not companies or DEX classes. A match does not prove active tracking. Blocked means all matched components are disabled in Android; App Manager rules are not checked.',
  type: 'User is a user-installed app. System is a system app. Updated system is a system app with an installed update. The type comes from Android flags.',
  splits: 'The app has additional split APKs. The count excludes the base APK. Select the badge to view the files.',
  debuggable: 'Debugging is enabled for this app build. This does not mean a debugger is connected.',
  testOnly: 'Android marks this package as intended for testing.',
  noCode: 'The package does not have the HAS_CODE flag. It may be a resource package or an overlay.',
  overlay: 'Android declares this package as a resource overlay for another package. Select the badge for its target and metadata. This is unrelated to drawing over other apps and does not mean the overlay is currently enabled.',
  largeHeap: 'The app requests a larger Java heap limit. This badge does not report actual memory usage.',
  openLinks: 'The app declares web domains. Separate colors indicate whether it can open supported links by default, cannot do so, or its state is unknown. Select the badge to view the domains.',
  running: 'Android reports a process or running service for this package in the selected profile. Cached processes count too; the app need not be on screen. This is a snapshot: Refresh details checks again. Restricted visibility is unavailable, not proof that the app is stopped.',
  stopped: 'The Android stopped flag is set, for example after a force stop. This is not a check for running processes.',
  disabled: 'The app is disabled for the selected Android profile.',
  suspended: 'Android has suspended the app, for example under an administrator policy. This is separate from Disabled.',
  hidden: 'The package is hidden for the selected profile. Android may deny access to this state.',
  magiskHide: 'The app is included in MagiskHide rules. A compatible Magisk version and privileged access are required; this check is not implemented yet.',
  magiskDenyList: 'The package has Magisk DenyList process rules. Requires the root setting. Select the badge for processes and enforcement state; a saved rule does not mean enforcement is enabled.',
  wx: 'Android 10+ with Target SDK below 29 matches App Manager’s legacy app-directory execution exception. Select the badge for both API levels. This is a compatibility rule, not inspection of memory mappings or proof of exploitation.',
  bloatware: 'The package appears in Android Debloat List. Default colors reflect the source assessment: green — removal allowed; blue — replacement required; orange — use caution; red — unsafe to remove; neutral — assessment unavailable. The list also contains essential system packages: review the description, warnings and dependencies before removal. Each color can be customized separately.',
  keyStore: 'Android KeyStore alias metadata for this app UID. Requires the root setting and a supported system collector. Shared-UID apps share entries; secret key material is never read.',
  backup: 'An available backup exported by ADB Vault for this device and Android profile, including copies inside ZIP. Select for its actual contents (APK/APKS, data, cache, OBB or media), version, date and location. JSON presets do not count. Matching app versions do not imply unchanged data. Missing or modified files are excluded. Exports made before local backup indexing are not registered.',
  batteryExempt: 'The app is exempt from Android battery optimization. This does not exempt it from all manufacturer restrictions.',
  sensorsDisabled: 'The sensor service reports the UID as idle. This can occur for an inactive app and does not necessarily mean sensors were manually blocked.',
  netPolicy: 'Android reports network restrictions for the app UID. Apps sharing a UID share these rules.',
  ssaid: 'An existing Android ID record for this app/user, read through root. Select the badge to see the value. The shell ID is never substituted and no identifier is generated or changed.',
  saf: 'The app has persistent access grants to documents or directories through Storage Access Framework. Android may deny access to the grant list.',
  playAppSigning: 'Both manifest metadata fields match the Play distribution markers used by App Manager. This suggests possible Play App Signing, not cryptographic proof. Select the badge to see the fields. Missing markers do not rule out Play App Signing; installer identity is not used.',
  xposed: 'The manifest or APK contains signs of an Xposed module. This does not mean the module is activated.',
  staticSharedLibrary: 'Android reports the package as a static shared library. A list of all installed versions is not collected yet.',
}
type Variant = { id: string; key: BadgeKey; label: string; tone: BadgeTone }
export const badgeVariants: Variant[] = badgeCatalog.flatMap(([key, label]): Variant[] => {
  if (key === 'type') return ['User', 'System', 'Updated system'].map((label, i) => ({ id: `type.${['user', 'system', 'updated'][i]}`, key, label, tone: 'neutral' }))
  if (key === 'trackers') return [{ id: 'trackers', key, label: 'Trackers', tone: 'orange' }, { id: 'trackers.blocked', key, label: 'Trackers · all disabled', tone: 'dark-cyan' }]
  if (key === 'openLinks') return [{ id: 'openLinks', key, label: 'Open links · default', tone: 'red' }, { id: 'openLinks.notDefault', key, label: 'Open links · not default', tone: 'dark-cyan' }, { id: 'openLinks.unknown', key, label: 'Open links · unknown state', tone: 'neutral' }]
  if (key === 'wx') return [{ id: key, key, label, tone: 'red' }]
  if (key === 'running') return [{ id: key, key, label, tone: 'purple' }]
  if (key === 'bloatware') return [
    { id: key, key, label: 'Bloatware · assessment unavailable', tone: 'neutral' },
    ...bloatwareAssessments.map(assessment => ({ id: `bloatware.${assessment.value}`, key, label: `Bloatware · ${assessment.label}`, tone: assessment.badgeTone })),
  ]
  return [{ id: key, key, label, tone: 'neutral' }]
})
export const validBadgeColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
// Filter choices are appearances, not additional Android badge checks.
export const filterChoiceVariants = [
  { id: 'filter.allTypes', label: 'All types', tone: 'neutral' },
  { id: 'filter.anyAvailability', label: 'Any availability', tone: 'neutral' },
  { id: 'filter.enabled', label: 'Enabled', tone: 'neutral' },
  { id: 'filter.anyLayout', label: 'Any layout', tone: 'neutral' },
  { id: 'filter.singleApk', label: 'Single APK', tone: 'neutral' },
] as const
export const badgeAppearanceVariants = [...badgeVariants, ...filterChoiceVariants]
export const defaultBadgeColor = (tone: Variant['tone']) => ({ neutral: '#64748b', orange: '#9a480c', red: '#c9253b', 'dark-cyan': '#006970', purple: '#ea80fc', green: '#237a40', blue: '#2463b3' })[tone]
export function contrastingBadgeText(color: string) {
  const channels = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  return luminance > 0.179 ? '#000000' : '#ffffff'
}
export function customBadgeStyle(color?: string, textColor?: string) {
  if (!validBadgeColor(color)) return validBadgeColor(textColor) ? { color: textColor } : undefined
  return { backgroundColor: color, borderColor: color, color: validBadgeColor(textColor) ? textColor : contrastingBadgeText(color) }
}
export function badgeAppearanceId(key: BadgeKey, label: string, tone: string) {
  if (key === 'type') return `type.${label === 'Updated system' ? 'updated' : label === 'System' ? 'system' : 'user'}`
  if (key === 'trackers' && tone === 'dark-cyan') return 'trackers.blocked'
  if (key === 'openLinks') return tone === 'red' ? key : tone === 'dark-cyan' ? 'openLinks.notDefault' : 'openLinks.unknown'
  if (key === 'bloatware') {
    const assessment = bloatwareAssessments.find(assessment => assessment.badgeTone === tone)
    return assessment ? `bloatware.${assessment.value}` : key
  }
  return key
}
