export const packageActionIds = ['enable', 'disable', 'uninstall', 'clear-data', 'clear-cache'] as const
export type PackageAction = typeof packageActionIds[number]
// Omitted method selects automatically. Explicit methods are retained for diagnostic tests.
export interface PackageActionOptions { method?: 'shell' | 'api'; root?: boolean; keepData?: boolean }
export interface PackageActionContext { fingerprint: string; sdk: number; callerUid: number; cachePermission: 'granted' | 'denied' | 'unknown' }
export interface PackageActionEvidence {
  device: string; fingerprint: string; userId: number; packageName: string; versionCode: number
  action: PackageAction; method: 'shell' | 'api'; root: boolean; keepData: boolean
  outcome: 'confirmed' | 'denied' | 'uncertain' | 'failed'; message: string; at: string
}
export function validatePackageOptions(options: PackageActionOptions | undefined, action: string) {
  if (options === undefined) return
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(k => !['method', 'root', 'keepData'].includes(k)) || (options.method !== undefined && !['shell', 'api'].includes(options.method)) || (options.root !== undefined && typeof options.root !== 'boolean') || (options.keepData !== undefined && (typeof options.keepData !== 'boolean' || action !== 'uninstall'))) throw new Error('Invalid application action options.')
  if (!packageActionIds.includes(action as PackageAction) && action !== 'clear-storage' && Object.keys(options).length) throw new Error('Method selection is unavailable for this action.')
}
export function packageMethodLabel(options?: PackageActionOptions) { return `${options?.method === 'api' ? 'Android API' : options?.method === 'shell' ? 'ADB command' : 'Automatic'}${options?.root ? ' · root' : ' · shell'}` }
export function evidenceKey(e: PackageActionEvidence) { return JSON.stringify([e.device, e.fingerprint, e.userId, e.packageName, e.versionCode, e.action, e.method, e.root, e.keepData]) }
export function validEvidence(value: unknown): value is PackageActionEvidence {
  if (!value || typeof value !== 'object') return false
  const e = value as PackageActionEvidence
  return ['device', 'fingerprint', 'packageName', 'message', 'at'].every(k => typeof e[k as keyof PackageActionEvidence] === 'string' && String(e[k as keyof PackageActionEvidence]).length <= 1600) && !!e.device && !!e.fingerprint && Number.isSafeInteger(e.userId) && e.userId >= 0 && Number.isSafeInteger(e.versionCode) && e.versionCode >= 0 && packageActionIds.includes(e.action) && ['shell', 'api'].includes(e.method) && typeof e.root === 'boolean' && typeof e.keepData === 'boolean' && ['confirmed', 'denied', 'uncertain', 'failed'].includes(e.outcome) && Number.isFinite(Date.parse(e.at))
}
