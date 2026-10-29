import type { ApkAnalysis } from './database-protocol.js'
export type InspectorSlotId = 'before' | 'after'
export interface ManifestNode { name: string; attributes: Record<string, string>; children: ManifestNode[] }
export interface InspectedManifest {
  packageName: string; versionName: string; versionCode: string; split: string; minSdk: string; targetSdk: string
  application: Record<string, string>; permissions: { name: string; attributes: Record<string, string> }[]
  features: string[]; components: { kind: string; name: string; attributes: Record<string, string>; filters: string[] }[]
}
export interface ApkSignature {
  status: 'verified' | 'invalid' | 'unavailable'; signers: { name: string; sha256: string }[]
  schemes: string[]; diagnostics: string
}
export interface InspectedApk {
  path: string; name: string; label: string; bytes: number; sha256: string; inspectedAt: string
  manifest: InspectedManifest; signature: ApkSignature; analysis: ApkAnalysis | null; issues: string[]
  entries: { name: string; bytes: number; compressed: number; crc32: number }[]
  categories: Record<'code' | 'native' | 'resources' | 'assets' | 'other', number>; abis: string[]
}
export interface InspectorSlot { status: 'empty' | 'loading' | 'ready' | 'error'; message: string; result: InspectedApk | null }
export interface ApkInspectorState { revision: number; before: InspectorSlot; after: InspectorSlot }
export const emptyInspectorSlot = (): InspectorSlot => ({ status: 'empty', message: '', result: null })
export type ApkInspectorRequest = { type: 'inspector.open'; slot: InspectorSlotId; path?: string }
  | { type: 'inspector.clear' | 'inspector.cancel'; slot: InspectorSlotId }
  | { type: 'inspector.swap' | 'inspector.export' }
export function validateInspectorRequest(r: Record<string, unknown>) {
  if (r.type === 'inspector.swap' || r.type === 'inspector.export') return
  if (r.slot !== 'before' && r.slot !== 'after') throw new Error('Invalid APK slot.')
  if (r.type === 'inspector.open' && r.path !== undefined && (typeof r.path !== 'string' || !r.path || r.path.length > 32767 || /[\x00-\x1f]/.test(r.path))) throw new Error('Invalid APK path.')
}
export interface ApkChange { group: string; name: string; before: string; after: string; status: 'added' | 'removed' | 'changed' }
export function compareApks(before: InspectedApk, after: InspectedApk): ApkChange[] {
  const changes: ApkChange[] = []
  const value = (v: unknown): string => typeof v === 'string' ? v : JSON.stringify(v, Object.keys(v as object ?? {}).sort())
  const add = (group: string, name: string, a: string, b: string) => { if (a !== b) changes.push({ group, name, before: a, after: b, status: !a ? 'added' : !b ? 'removed' : 'changed' }) }
  const map = (group: string, a: Record<string, string>, b: Record<string, string>) => { for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) add(group, k, Object.hasOwn(a, k) ? a[k] : '', Object.hasOwn(b, k) ? b[k] : '') }
  const set = (group: string, a: string[], b: string[]) => map(group, Object.fromEntries(a.map(x => [x, 'Present'])), Object.fromEntries(b.map(x => [x, 'Present'])))
  for (const k of ['packageName', 'versionName', 'versionCode', 'split', 'minSdk', 'targetSdk'] as const) add('Metadata', k, before.manifest[k], after.manifest[k])
  add('Metadata', 'Label', before.label, after.label)
  add('Size', 'APK bytes', String(before.bytes), String(after.bytes))
  for (const k of Object.keys(before.categories) as (keyof InspectedApk['categories'])[]) add('Size', k + ' (compressed bytes)', String(before.categories[k]), String(after.categories[k]))
  add('Signature', 'Verification', before.signature.status, after.signature.status)
  set('Signature', before.signature.signers.map(s => s.sha256), after.signature.signers.map(s => s.sha256))
  set('Signature schemes', before.signature.schemes, after.signature.schemes)
  map('Application', before.manifest.application, after.manifest.application)
  const permissions = (apk: InspectedApk) => {
    const result: Record<string, string[]> = Object.create(null)
    for (const p of apk.manifest.permissions) (result[p.name] ??= []).push(value(p.attributes))
    return Object.fromEntries(Object.entries(result).map(([name, entries]) => [name, entries.sort().join(' | ')]))
  }
  map('Permissions', permissions(before), permissions(after))
  const components = (apk: InspectedApk) => Object.fromEntries(apk.manifest.components.map(c => [`${c.kind}: ${c.name}`, value(c.attributes) + (c.filters.length ? ' · ' + c.filters.join(' | ') : '')]))
  map('Components', components(before), components(after))
  set('Features', before.manifest.features, after.manifest.features)
  set('ABIs', before.abis, after.abis)
  for (const k of ['trackers', 'libraries', 'native'] as const) set(k === 'native' ? 'Native libraries' : k === 'trackers' ? 'Trackers' : 'Libraries', before.analysis?.[k].map(x => x.name) ?? [], after.analysis?.[k].map(x => x.name) ?? [])
  set('Domains', before.analysis?.addresses?.domains.map(x => x.value) ?? [], after.analysis?.addresses?.domains.map(x => x.value) ?? [])
  const entries = (apk: InspectedApk) => Object.fromEntries(apk.entries.map(e => [e.name, `${e.bytes} bytes · CRC32 ${e.crc32.toString(16).padStart(8, '0')}`]))
  map('Contents (size / CRC32)', entries(before), entries(after))
  return changes
}
