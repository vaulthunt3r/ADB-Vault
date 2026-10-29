export interface BadgeCheck {
  present: boolean | null
  reason: string
  items: { name: string; value: string; backupFile?: string }[]
}
export interface AppComponent {
  name: string; type: 'Activity' | 'Receiver' | 'Service' | 'Provider'; enabled: boolean | null
  exported?: boolean; directBootAware?: boolean
  processName?: string | null; permission?: string | null; targetActivity?: string | null
  authority?: string | null; readPermission?: string | null; writePermission?: string | null
}
export interface AppPermission {
  name: string; granted: boolean | null; protectionLevel: number | null
  declaringPackage: string | null; label: string | null; description: string | null
  flags?: number | null; definitionFlags?: number | null
  changeRestriction?: string
}
export function validAppPermission(value: unknown): value is AppPermission {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const p = value as AppPermission
  const bits = (n: unknown) => n === null || Number.isInteger(n) && Number(n) >= 0 && Number(n) <= 0x7fffffff
  const text = (s: unknown) => s === null || typeof s === 'string' && s.length <= 8192
  return typeof p.name === 'string' && p.name.length > 0 && p.name.length <= 8192 && (p.granted === null || typeof p.granted === 'boolean')
    && bits(p.protectionLevel) && (p.flags === undefined || bits(p.flags)) && (p.definitionFlags === undefined || bits(p.definitionFlags))
    && [p.declaringPackage, p.label, p.description].every(text) && (p.changeRestriction === undefined || typeof p.changeRestriction === 'string' && p.changeRestriction.length <= 8192)
}
export interface AppDetails {
  analysis?: import('./database-protocol.js').ApkAnalysis
  packageName: string; userId: number; uid: number
  fields: Record<string, string>
  flags: string[]
  badges: Record<string, boolean | null>
  badgeChecks?: Record<string, BadgeCheck>
  components?: AppComponent[]
  requestedPermissions?: AppPermission[]
  paths: { name: string; path: string }[]
  splits: { name: string; path: string; bytes: number | null }[]
  installers: { role: string; packageName: string | null; label: string | null }[]
  storage: { requested: boolean; appBytes: number | null; dataBytes: number | null; cacheBytes: number | null }
  network: { start: number; end: number; wifi: { rx: number; tx: number } | null; mobile: { rx: number; tx: number } | null }
  links: { host: string; state: string }[]
  issues: { area: string; message: string }[]
}
export interface AppDetailsState {
  deviceId: string; userId: number; packageName: string; status: 'loading' | 'ready' | 'error'
  collectedAt: string | null; data: AppDetails | null; error: string | null
}
export type AppBadgeEvidence = Pick<AppDetails, 'badges' | 'badgeChecks' | 'splits' | 'links' | 'issues'>
export function appBadgeEvidence(data: AppDetails): AppBadgeEvidence {
  // Filters need check outcomes, not per-app component lists, paths, domains or root identifiers.
  return { badges: { ...data.badges }, badgeChecks: Object.fromEntries(Object.entries(data.badgeChecks || {}).map(([key, check]) => [key, { present: check.present, reason: check.reason.slice(0, 500), items: [] }])), splits: [], links: [], issues: data.issues.map(issue => ({ area: issue.area, message: issue.message.slice(0, 500) })) }
}
export function validateAppTarget(packageName: string, userId: number) {
  if (typeof packageName !== 'string' || packageName.length > 255 || !/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/.test(packageName)) throw new Error('Invalid application package.')
  if (!Number.isInteger(userId) || userId < 0 || userId > 99999) throw new Error('Invalid Android profile ID.')
}
export function parseAppDetails(output: string, packageName: string, userId: number): AppDetails {
  validateAppTarget(packageName, userId)
  if (output.length > 2_000_000) throw new Error('Oversized application details.')
  const value = JSON.parse(output)
  const invalid = () => { throw new Error('Invalid application details response.') }
  const text = (v: unknown): v is string => typeof v === 'string' && v.length <= 8192
  const number = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0
  const nullableNumber = (v: unknown) => v === null || number(v)
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
  const list = (v: unknown, check: (item: any) => boolean) => Array.isArray(v) && v.length <= 1024 && v.every(check)
  if (!object(value) || value.type !== 'details' || value.protocolVersion !== 1 || value.packageName !== packageName || value.userId !== userId || !number(value.uid) || Math.floor(value.uid / 100000) !== userId) invalid()
  const d = value as unknown as AppDetails
  if (d.badgeChecks !== undefined && (!object(d.badgeChecks) || Object.keys(d.badgeChecks).length > 40 || !Object.values(d.badgeChecks).every(c => object(c) && (c.present === null || typeof c.present === 'boolean') && text(c.reason) && list(c.items, i => object(i) && text(i.name) && text(i.value))))) invalid()
  if (d.components !== undefined && (!Array.isArray(d.components) || d.components.length > 10000 || !d.components.every(c => object(c) && text(c.name) && ['Activity', 'Receiver', 'Service', 'Provider'].includes(String(c.type)) && (c.enabled === null || typeof c.enabled === 'boolean')))) invalid()
  if (d.components?.some(c => !['exported', 'directBootAware'].every(k => c[k as keyof AppComponent] === undefined || typeof c[k as keyof AppComponent] === 'boolean') || !['processName', 'permission', 'targetActivity', 'authority', 'readPermission', 'writePermission'].every(k => c[k as keyof AppComponent] == null || text(c[k as keyof AppComponent])))) invalid()
  if (d.requestedPermissions !== undefined && (!Array.isArray(d.requestedPermissions) || d.requestedPermissions.length > 10000 || !d.requestedPermissions.every(validAppPermission))) invalid()
  if (!object(d.fields) || Object.keys(d.fields).length > 100 || !Object.values(d.fields).every(text)
    || !object(d.badges) || Object.keys(d.badges).length > 50 || !Object.values(d.badges).every(v => typeof v === 'boolean' || v === null)
    || !list(d.flags, text) || !list(d.paths, p => object(p) && text(p.name) && text(p.path))
    || !list(d.splits, p => object(p) && text(p.name) && text(p.path) && nullableNumber(p.bytes))
    || !list(d.installers, p => object(p) && text(p.role) && (p.packageName === null || text(p.packageName)) && (p.label === null || text(p.label)))
    || !list(d.links, p => object(p) && text(p.host) && ['Verified', 'Selected', 'Not approved'].includes(String(p.state)))
    || !list(d.issues, p => object(p) && text(p.area) && text(p.message))) invalid()
  if (!object(d.storage) || typeof d.storage.requested !== 'boolean' || !['appBytes', 'dataBytes', 'cacheBytes'].every(k => nullableNumber(d.storage[k as keyof typeof d.storage]))) invalid()
  if (!object(d.network) || !number(d.network.start) || !number(d.network.end) || d.network.start > d.network.end
    || ![d.network.wifi, d.network.mobile].every(n => n === null || (object(n) && number(n.rx) && number(n.tx)))) invalid()
  return d
}
