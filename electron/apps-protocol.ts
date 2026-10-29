export interface AndroidApp {
  installed?: boolean
  actionContext?: import('./package-actions-protocol.js').PackageActionContext
  actionEvidence?: import('./package-actions-protocol.js').PackageActionEvidence[]
  backupCheck?: import('./app-details-protocol.js').BadgeCheck
  packageName: string; label: string; versionName: string | null; versionCode: number
  uid: number; userId: number; enabled: boolean; system: boolean; updatedSystemApp: boolean
  sourceDir: string | null; firstInstallTime: number; lastUpdateTime: number
  targetSdk: number; minSdk: number; debuggable: boolean; suspended: boolean; stopped: boolean
  enabledState: number | null; installer: string | null; iconPng: string | null
  iconType?: string; iconError?: string; labelError?: string
  apkSizeBytes?: number | null; splitCount?: number | null; sizeError?: string
  iconSkipped?: boolean; dataBytes?: number | null; cacheBytes?: number | null; storageError?: string; storageRequested?: boolean
}
export interface AppsOptions { icons: boolean; early: boolean; storage: boolean; root?: boolean }
export const defaultAppsOptions = (): AppsOptions => ({ icons: true, early: false, storage: false, root: false })
export type AppsLoadingMode = 'selected' | 'preload'
export interface AppsSnapshot {
  removedApps?: AndroidApp[]
  badgeEvidence?: Record<string, import('./app-details-protocol.js').AppBadgeEvidence>
  badgeRead?: { status: 'running' | 'complete' | 'cancelled'; completed: number; total: number; failed: number }
  progress?: { completed: number; total: number } | null
  details?: import('./app-details-protocol.js').AppDetailsState | null
  options: AppsOptions
  loadingMode: AppsLoadingMode; backgroundUserId: number | null; cachedUserIds: number[]; preloadErrors: Record<number, string>
  profiles: import('./app-profiles.js').AndroidProfile[]; currentUserId: number | null; profilesError: string | null
  deviceId: string | null; userId: number | null; status: 'idle' | 'loading' | 'ready' | 'error'
  apps: AndroidApp[]; error: string | null; message: string; collectedAt: string | null
  elapsedMs: number | null; warnings: number; locale: string | null
}
export const emptyApps = (): AppsSnapshot => ({ progress: null, options: defaultAppsOptions(), loadingMode: 'selected', backgroundUserId: null, cachedUserIds: [], preloadErrors: {}, profiles: [], currentUserId: null, profilesError: null, deviceId: null, userId: null, status: 'idle', apps: [], removedApps: [], error: null, message: '', collectedAt: null, elapsedMs: null, warnings: 0, locale: null })
export function parseAppsOutput(output: string, expectedUser: number, helperVersion: string) {
  const lines = output.trim().split(/\r?\n/)
  if (lines.length < 2 || lines.length > 10002) throw new Error('Incomplete or oversized Apps response.')
  const objects = lines.map(line => { if (line.length > 200_000) throw new Error('Apps record exceeds its size limit.'); return JSON.parse(line) })
  const header = objects[0], complete = objects.at(-1)
  const failure = objects.find(v => v.type === 'error')
  if (failure) throw new Error(`Android helper: ${String(failure.message).slice(0, 500)}`)
  if (header.type !== 'header' || header.protocolVersion !== 1 || header.helperVersion !== helperVersion || header.userId !== expectedUser || header.iconSize !== 96) throw new Error('Incompatible Apps helper protocol or Android user.')
  if (complete.type !== 'complete' || !Number.isInteger(header.total) || header.total !== objects.length - 2 || complete.count !== header.total) throw new Error('Apps collection was interrupted; no partial list was accepted.')
  if (!Number.isFinite(complete.elapsedMs) || complete.elapsedMs < 0 || !Number.isInteger(complete.warnings) || complete.warnings < 0 || typeof header.locale !== 'string') throw new Error('Invalid Apps summary.')
  const seen = new Set<string>()
  const apps = objects.slice(1, -1).map((value): AndroidApp => {
    if (!value || value.type !== 'app' || typeof value.packageName !== 'string' || !/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/.test(value.packageName) || seen.has(value.packageName) || value.userId !== expectedUser) throw new Error('Invalid or duplicate application record.')
    seen.add(value.packageName)
    for (const key of ['label', 'versionName', 'sourceDir', 'installer']) if (!(typeof value[key] === 'string' && value[key].length <= 8192) && !(key !== 'label' && value[key] === null)) throw new Error(`Invalid application ${key}.`)
    for (const key of ['versionCode', 'uid', 'userId', 'firstInstallTime', 'lastUpdateTime', 'targetSdk', 'minSdk']) if (!Number.isSafeInteger(value[key]) || value[key] < 0) throw new Error(`Invalid application ${key}.`)
    if (Math.floor(value.uid / 100000) !== expectedUser) throw new Error('Application UID belongs to a different Android profile.')
    for (const key of ['apkSizeBytes', 'splitCount', 'dataBytes', 'cacheBytes']) if (value[key] !== undefined && value[key] !== null && (!Number.isSafeInteger(value[key]) || value[key] < 0)) throw new Error(`Invalid application ${key}.`)
    for (const key of ['iconSkipped', 'storageRequested', 'installed']) if (value[key] !== undefined && typeof value[key] !== 'boolean') throw new Error(`Invalid application ${key}.`)
    for (const key of ['enabled', 'system', 'updatedSystemApp', 'debuggable', 'suspended', 'stopped']) if (typeof value[key] !== 'boolean') throw new Error(`Invalid application ${key}.`)
    if (value.enabledState !== null && ![0, 1, 2, 3, 4].includes(value.enabledState)) throw new Error('Invalid application enabled state.')
    if (value.iconPng !== null) {
      if (typeof value.iconPng !== 'string' || value.iconPng.length > 150_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.iconPng)) throw new Error('Invalid application icon.')
      const png = Buffer.from(value.iconPng, 'base64')
      if (png.length < 33 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || png.subarray(12, 16).toString() !== 'IHDR' || png.readUInt32BE(16) !== 96 || png.readUInt32BE(20) !== 96) throw new Error('Application icon is not a 96×96 PNG.')
    }
    for (const key of ['iconType', 'iconError', 'labelError', 'sizeError', 'storageError']) if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key].length > 8192)) throw new Error('Invalid application diagnostic.')
    if (value.actionContext !== undefined) {
      const c = value.actionContext
      if (!c || typeof c.fingerprint !== 'string' || c.fingerprint.length > 1024 || !Number.isInteger(c.sdk) || ![0, 2000].includes(c.callerUid) || !['granted', 'denied', 'unknown'].includes(c.cachePermission)) throw new Error('Invalid package action context.')
    }
    delete value.actionEvidence
    return value as AndroidApp
  })
  return { apps, elapsedMs: complete.elapsedMs as number, warnings: complete.warnings as number, locale: header.locale as string }
}
