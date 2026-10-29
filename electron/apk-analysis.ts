import { Worker } from 'node:worker_threads'
import { apkSizeCategories, type ApkAnalysis } from './database-protocol.js'
import { SignatureMatcher, type SignatureDatabase, type Signature } from './signature-database.js'
import { analyzeAddresses, type AddressInventory } from './apk-addresses.js'
interface ScanInventory { classes: string[]; native: { apk: string; path: string; elf?: string }[]; artifacts: ApkAnalysis['artifacts']; addresses?: AddressInventory }
export function parseScan(output: string, packageName: string, userId: number): ScanInventory {
  if (output.length > 32_000_000) throw new Error('APK scan exceeds output limit.')
  const d = JSON.parse(output)
  const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 4096
  const num = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0
  if (d.type !== 'scan' || d.protocolVersion !== 1 || d.packageName !== packageName || d.userId !== userId || !num(d.uid) || Math.floor(d.uid / 100000) !== userId
    || !Array.isArray(d.classes) || d.classes.length > 250000 || !d.classes.every(text)
    || !Array.isArray(d.artifacts) || !d.artifacts.length || d.artifacts.length > 1024 || !d.artifacts.every((a: any) => a && text(a.path) && num(a.dexFiles) && num(a.classes) && typeof a.complete === 'boolean' && Array.isArray(a.errors) && a.errors.length <= 1024 && a.errors.every(text) && a.complete === (a.errors.length === 0))
    || !Array.isArray(d.native) || d.native.length > 10000 || !d.native.every((n: any) => n && text(n.apk) && text(n.path) && n.path.endsWith('.so') && (n.elf === undefined || text(n.elf)) && d.artifacts.some((a: any) => a.path === n.apk))) throw new Error('Invalid APK scan response.')
  let totalBytes = 0
  const paths = new Set<string>()
  for (const artifact of d.artifacts) {
    if (paths.has(artifact.path)) throw new Error('Duplicate APK scan artifact.')
    paths.add(artifact.path)
    if (artifact.size === undefined) continue // Older helpers have no size inventory.
    const size = artifact.size
    if (!size || (size.bytes !== null && !num(size.bytes)) || (size.error !== undefined && !text(size.error))) throw new Error('Invalid APK size response.')
    if (size.categories === null) {
      if (!text(size.error)) throw new Error('Missing APK size failure reason.')
    } else {
      if (!size.categories || Array.isArray(size.categories) || size.bytes === null || size.error !== undefined || Object.keys(size.categories).length !== apkSizeCategories.length
        || !apkSizeCategories.every(key => num(size.categories[key]))
        || apkSizeCategories.reduce((sum, key) => sum + size.categories[key], 0) !== size.bytes) throw new Error('Invalid APK size categories.')
    }
    totalBytes += size.bytes ?? 0
    if (!Number.isSafeInteger(totalBytes)) throw new Error('APK total size exceeds limit.')
  }
  if (d.addresses !== undefined) {
    const a = d.addresses
    if (!a || !num(a.files) || a.files > 200000 || !Array.isArray(a.issues) || a.issues.length > 30 || !a.issues.every(text)
      || !Array.isArray(a.candidates) || a.candidates.length > 2000 || !a.candidates.every((c: any) => c && text(c.value) && c.value.length <= 2048 && !/[\x00-\x1f\x7f]/.test(c.value)
        && Array.isArray(c.sources) && c.sources.length > 0 && c.sources.length <= 8 && c.sources.every((s: any) => s && text(s.apk) && text(s.entry) && d.artifacts.some((artifact: any) => artifact.path === s.apk)))) throw new Error('Invalid APK address scan response.')
  }
  return d
}
function matchClasses(classes: string[], signatures: Signature[]) {
  const matcher = new SignatureMatcher(signatures), results = new Map<number, { count: number; items: string[] }>()
  for (const name of new Set(classes)) for (const index of matcher.search(name)) {
    const result = results.get(index) ?? { count: 0, items: [] }
    result.count++
    if (result.items.length < 1000) result.items.push(name)
    results.set(index, result)
  }
  return [...results].map(([index, result]) => ({ ...signatures[index], ...result })).sort((a, b) => a.name.localeCompare(b.name))
}
// Called in a worker: even a pathological future native regex cannot block Electron's main thread.
export function analyzeInventory(inventory: ScanInventory, db: SignatureDatabase): ApkAnalysis {
  const names = [...new Set(inventory.native.map(n => n.path.split('/').at(-1)!))], recognized = new Set<string>()
  const native = db.native.flatMap(s => {
    const pattern = new RegExp(s.signature), matched = names.filter(name => pattern.test(name))
    for (const name of matched) recognized.add(name)
    return matched.length ? [{ ...s, count: matched.length, items: inventory.native.filter(n => matched.includes(n.path.split('/').at(-1)!)).map(n => `${n.apk.split('/').at(-1)} · ${n.path}${n.elf ? ` · ${n.elf}` : ''}`) }] : []
  })
  const incomplete = inventory.artifacts.some(a => !a.complete)
  const sizeIncomplete = inventory.artifacts.some(a => a.size?.categories === null)
  const addresses = inventory.addresses ? analyzeAddresses(inventory.addresses, incomplete) : undefined
  return { status: !incomplete && !sizeIncomplete && addresses?.status !== 'partial' ? 'complete' : 'partial', revision: db.revision, classes: new Set(inventory.classes).size, artifacts: inventory.artifacts, addresses,
    trackers: matchClasses(inventory.classes, db.trackers), libraries: matchClasses(inventory.classes, db.libraries), native, unidentifiedNative: names.filter(n => !recognized.has(n)), issues: inventory.artifacts.flatMap(a => a.errors.map(e => `${a.path}: ${e}`)) }
}
export function analyzeApks(output: string, packageName: string, userId: number, database: SignatureDatabase, signal: AbortSignal): Promise<ApkAnalysis> {
  if (signal.aborted) return Promise.reject(new Error('APK scan cancelled.'))
  return new Promise((resolve, reject) => {
    let settled = false
    const worker = new Worker(new URL('./apk-analysis-worker.js', import.meta.url), { workerData: { output, packageName, userId, database }, resourceLimits: { maxOldGenerationSizeMb: 256 } })
    const finish = (error?: Error, data?: ApkAnalysis) => { if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort); void worker.terminate(); error ? reject(error) : resolve(data!) }
    const abort = () => finish(new Error('APK scan cancelled.'))
    const timer = setTimeout(() => finish(new Error('Signature analysis timed out.')), 30000)
    signal.addEventListener('abort', abort, { once: true })
    worker.once('message', message => message.error ? finish(new Error(message.error)) : finish(undefined, message.data))
    worker.once('error', finish)
    worker.once('exit', code => { if (code !== 0) finish(new Error('Signature analysis worker stopped.')) })
  })
}
