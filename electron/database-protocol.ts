export const databaseIds = ['db-trackers', 'db-libraries', 'db-native', 'db-bloatware'] as const
export type DatabaseId = typeof databaseIds[number]
export const isDatabaseId = (id: string): id is DatabaseId => (databaseIds as readonly string[]).includes(id)
export interface ScanMatch { name: string; signature: string; kind?: string; website?: string; tracker?: boolean; count: number; items: string[] }
export interface ApkAddressSource { apk: string; entry: string }
export interface ApkAddress { value: string; sources: ApkAddressSource[] }
export const apkSizeCategories = ['code', 'native', 'resources', 'assets', 'other'] as const
export type ApkSizeCategory = typeof apkSizeCategories[number]
export interface ApkSize { bytes: number | null; categories: Record<ApkSizeCategory, number> | null; error?: string }
export interface ApkAddresses {
  status: 'complete' | 'partial'; files: number; issues: string[]
  domains: ApkAddress[]; urls: ApkAddress[]
}
export interface ApkAnalysis {
  status: 'running' | 'complete' | 'partial' | 'error'; revision: string; error?: string
  classes: number; artifacts: { path: string; dexFiles: number; classes: number; complete: boolean; errors: string[]; size?: ApkSize }[]
  trackers: ScanMatch[]; libraries: ScanMatch[]; native: ScanMatch[]; unidentifiedNative: string[]; issues: string[]
  addresses?: ApkAddresses
}
