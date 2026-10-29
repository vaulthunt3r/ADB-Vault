import { parentPort, workerData } from 'node:worker_threads'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { openRestoreZip } from './restore-zip.js'
import { inspectManifest } from './apk-manifest.js'
import { inspectDex } from './apk-dex.js'
import { analyzeInventory } from './apk-analysis.js'
import type { SignatureDatabase } from './signature-database.js'
import type { InspectedApk } from './apk-inspector-protocol.js'
import type { AddressInventory } from './apk-addresses.js'

export async function inspectApkContents(file: string, database?: SignatureDatabase) {
  const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk)
  const zip = await openRestoreZip(file, undefined, 'apk')
  try {
    if (zip.entries.length > 30000) throw new Error('APK exceeds the 30,000 entry inspection limit.')
    const manifest = inspectManifest(await zip.buffer('AndroidManifest.xml', 8_000_000))
    const categories: InspectedApk['categories'] = { code: 0, native: 0, resources: 0, assets: 0, other: 0 }
    for (const e of zip.entries) {
      if (!Number.isSafeInteger(e.compressed) || e.compressed < 0) throw new Error('Invalid APK entry size.')
      const category = /^classes(?:\d+)?\.dex$/.test(e.name) ? 'code' : /^lib\/.*\.so$/.test(e.name) ? 'native' : e.name === 'resources.arsc' || e.name.startsWith('res/') ? 'resources' : e.name.startsWith('assets/') ? 'assets' : 'other'
      categories[category] += e.compressed
    }
    const classes: string[] = [], errors: string[] = [], addresses: AddressInventory = { files: 0, candidates: [], issues: [] }, candidates = new Map<string, AddressInventory['candidates'][number]>()
    const issue = (s: string) => { if (!addresses.issues.includes(s)) addresses.issues.push(s) }
    const scan = (text: string, entry: string) => {
      const found = text.match(/https?:\/\/[^\s<>"'`\\\x00-\x1f]{1,2040}|\b(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z]{2,24}\b/gi) ?? []
      for (const value of found) {
        const existing = candidates.get(value)
        if (existing) { if (existing.sources.length < 8 && !existing.sources.some(s => s.entry === entry)) existing.sources.push({ apk: 'base.apk', entry }); continue }
        if (candidates.size >= 2000) { issue('Address candidate limit reached; results are partial.'); break }
        candidates.set(value, { value, sources: [{ apk: 'base.apk', entry }] })
      }
    }
    const dex = zip.entries.filter(e => /^classes(?:\d+)?\.dex$/.test(e.name))
    let budget = 0
    for (const entry of dex) {
      try {
        budget += entry.bytes
        if (entry.bytes > 128_000_000 || budget > 256_000_000) throw new Error('DEX byte budget exceeded.')
        const names = inspectDex(await zip.buffer(entry.name, 128_000_000), value => scan(value, entry.name))
        if (classes.length + names.length > 250000) throw new Error('Class definition limit exceeded.')
        for (const name of names) classes.push(name)
        addresses.files++
      } catch (error) { errors.push(`${entry.name}: ${String(error)}`) }
    }
    budget = 0
    for (const entry of zip.entries.filter(e => /^(?:assets|res\/raw)\/.*\.(?:json|txt|xml|html|js|properties|csv|conf)$/i.test(e.name))) {
      budget += entry.bytes
      if (entry.bytes > 2_000_000 || budget > 16_000_000) { issue('Some text assets exceed the address scan budget.'); continue }
      try { scan((await zip.buffer(entry.name, 2_000_000)).toString('utf8'), entry.name); addresses.files++ } catch { issue('Some text assets could not be read.') }
    }
    addresses.candidates = [...candidates.values()]
    const native = zip.entries.filter(e => /^lib\/[^/]+\/[^/]+\.so$/.test(e.name)).map(e => ({ apk: 'base.apk', path: e.name }))
    const analysis = database ? analyzeInventory({ classes, native, artifacts: [{ path: 'base.apk', dexFiles: dex.length, classes: classes.length, complete: errors.length === 0, errors }], addresses }, database) : null
    return { sha256: hash.digest('hex'), manifest, entries: zip.entries, categories, abis: [...new Set(native.map(n => n.path.split('/')[1]))].sort(), analysis, issues: database ? errors : [...errors, 'Detection databases unavailable; library, tracker and address analysis was not performed.'] }
  } finally { zip.close() }
}
if (parentPort) inspectApkContents(workerData.file, workerData.database).then(result => parentPort!.postMessage({ result }), error => parentPort!.postMessage({ error: String(error) }))
