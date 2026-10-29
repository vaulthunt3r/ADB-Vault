import { validAppPermission, validateAppTarget, type AppPermission } from './app-details-protocol.js'
import type { AppActionTarget } from './app-actions-protocol.js'

export interface PermissionChange extends AppActionTarget { permission: string; granted: boolean; expectedGranted: boolean }
export interface PermissionSnapshot {
  packageName: string; userId: number; uid: number; versionCode: number; targetSdk: number
  sharedUidPackages: string[]; requestedPermissions: AppPermission[]
}
export function validatePermissionChange(r: PermissionChange) {
  validateAppTarget(r.packageName, r.userId)
  if (typeof r.id !== 'string' || !r.id.length || r.id.length > 512 || /[\x00-\x1f]/.test(r.id)
    || typeof r.permission !== 'string' || r.permission.length > 512 || !/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(r.permission)
    || typeof r.granted !== 'boolean' || typeof r.expectedGranted !== 'boolean' || r.granted === r.expectedGranted) throw new Error('Invalid permission change.')
}
// Do not clear policy flags or elevate to root to bypass Android's permission rules.
export function permissionRestriction(p: AppPermission, targetSdk: number | null, sharedUid = false): string | null {
  if (p.changeRestriction) return p.changeRestriction
  if (p.granted === null) return 'Android did not report the grant state. Refresh applications to retry.'
  if (p.protectionLevel === null) return 'Android did not report the permission type.'
  if ((p.protectionLevel & 15) !== 1) return 'Managed by Android. Only runtime permissions can be changed here.'
  if (targetSdk === null || targetSdk < 23) return 'This application does not support Android runtime permissions.'
  if (sharedUid) return 'This application shares its UID. Permission changes could affect other applications.'
  if (p.flags == null || p.definitionFlags == null) return 'Android did not report permission restrictions. Refresh applications to retry.'
  if (p.flags & 0x10) return 'Fixed by Android. This permission cannot be changed here.'
  if (p.flags & 0x04) return 'Fixed by a device or profile administrator.'
  if (!p.granted && (p.definitionFlags & 0x04) && !(p.flags & (0x800 | 0x1000 | 0x2000))) return 'Restricted by Android. The installer must allowlist this permission before it can be granted.'
  return null
}
export function parsePermissionSnapshot(output: string, target: AppActionTarget): PermissionSnapshot {
  if (output.length > 2_000_000) throw new Error('Oversized permission response.')
  const p = JSON.parse(output)
  const number = (n: unknown) => Number.isSafeInteger(n) && Number(n) >= 0
  if (!p || p.type !== 'permissions' || p.protocolVersion !== 1 || p.packageName !== target.packageName || p.userId !== target.userId
    || !number(p.uid) || Math.floor(p.uid / 100000) !== target.userId || !number(p.versionCode) || !number(p.targetSdk)
    || !Array.isArray(p.sharedUidPackages) || !p.sharedUidPackages.includes(p.packageName) || p.sharedUidPackages.length > 10000
    || !p.sharedUidPackages.every((v: unknown) => typeof v === 'string' && v.length <= 255 && /^[A-Za-z0-9_.]+$/.test(v))
    || !Array.isArray(p.requestedPermissions) || p.requestedPermissions.length > 10000 || !p.requestedPermissions.every(validAppPermission)
    || new Set(p.requestedPermissions.map((v: AppPermission) => v.name)).size !== p.requestedPermissions.length) throw new Error('Invalid permission response.')
  return p
}
