import { Worker } from 'node:worker_threads'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SignatureDatabase } from './signature-database.js'
import { bundledDatabaseDirectory, loadDatabase } from './databases.js'
import { apkLabel, verifyApk } from './apk-inspector-tools.js'
import { emptyInspectorSlot, type ApkInspectorState, type InspectorSlotId, type InspectedApk, type InspectorSlot } from './apk-inspector-protocol.js'
type Contents = Pick<InspectedApk, 'sha256' | 'manifest' | 'entries' | 'categories' | 'abis' | 'analysis' | 'issues'>
function contents(file: string, database: SignatureDatabase | undefined, signal: AbortSignal): Promise<Contents> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./apk-inspector-worker.js', import.meta.url), { workerData: { file, database }, resourceLimits: { maxOldGenerationSizeMb: 384 } })
    let finished = false
    const finish = (error?: Error, result?: Contents) => { if (finished) return; finished = true; clearTimeout(timer); signal.removeEventListener('abort', abort); void worker.terminate().then(() => error ? reject(error) : resolve(result!)) }
    const abort = () => finish(new Error('APK inspection cancelled.'))
    const timer = setTimeout(() => finish(new Error('APK contents analysis timed out.')), 90000)
    signal.addEventListener('abort', abort, { once: true })
    worker.once('message', m => m.error ? finish(new Error(m.error)) : finish(undefined, m.result))
    worker.once('error', finish); worker.once('exit', code => { if (!finished) finish(new Error(`APK analysis worker exited (${code}).`)) })
  })
}
export class ApkInspectorService {
  state: ApkInspectorState = { revision: 0, before: emptyInspectorSlot(), after: emptyInspectorSlot() }
  private jobs = new Map<InspectorSlotId, { controller: AbortController; done: Promise<void> }>()
  private closing = false
  readonly tools: string
  constructor(private root: string, private database: () => SignatureDatabase | undefined, private publish: (state: ApkInspectorState) => void, tools?: string) {
    const external = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
    this.tools = tools ?? (external && existsSync(path.join(external, 'inspector-tools')) ? path.join(external, 'inspector-tools') : fileURLToPath(new URL('../inspector-tools/', import.meta.url)))
  }
  get busy() { return this.jobs.size > 0 }
  private update(slot: InspectorSlotId, state: InspectorSlot) { this.state = { ...this.state, revision: this.state.revision + 1, [slot]: state }; this.publish(this.state) }
  open(slot: InspectorSlotId, source: string) {
    if (this.closing) throw new Error('APK inspector is closing.')
    if (this.jobs.has(slot)) throw new Error('Cancel the current APK analysis before opening another file in this slot.')
    if (!path.isAbsolute(source) || path.extname(source).toLowerCase() !== '.apk') throw new Error('Choose a local .apk file. APK bundles must be unpacked first.')
    const controller = new AbortController()
    this.update(slot, { status: 'loading', result: null, message: 'Copying APK for local inspection…' })
    const job = { controller, done: Promise.resolve() }; this.jobs.set(slot, job)
    job.done = this.inspect(slot, path.resolve(source), controller.signal).catch(error => this.update(slot, { status: 'error', result: null, message: controller.signal.aborted ? 'Inspection cancelled.' : String(error) })).finally(() => this.jobs.delete(slot))
  }
  cancel(slot: InspectorSlotId) { this.jobs.get(slot)?.controller.abort() }
  clear(slot: InspectorSlotId) { if (this.jobs.has(slot)) throw new Error('Cancel inspection before clearing the slot.'); this.update(slot, emptyInspectorSlot()) }
  swap() { if (this.busy) throw new Error('Wait for APK inspection before swapping files.'); this.state = { revision: this.state.revision + 1, before: this.state.after, after: this.state.before }; this.publish(this.state) }
  async shutdown() { this.closing = true; for (const job of this.jobs.values()) job.controller.abort(); await Promise.all([...this.jobs.values()].map(job => job.done)) }
  private async inspect(slot: InspectorSlotId, source: string, signal: AbortSignal) {
    const initial = await stat(source)
    if (!initial.isFile() || initial.size < 8 || initial.size > 2 * 1024 ** 3) throw new Error('APK must be a regular file between 8 bytes and 2 GiB.')
    const cache = path.join(this.root, 'apk-inspector'); await mkdir(cache, { recursive: true })
    const temporary = await mkdtemp(path.join(cache, 'inspect-')), file = path.join(temporary, 'input.apk')
    try {
      let bytes = 0
      const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) { bytes += chunk.length; callback(bytes > initial.size ? new Error('APK grew during copying.') : null, chunk) } })
      await pipeline(createReadStream(source), limit, createWriteStream(file, { flags: 'wx' }), { signal })
      const current = await stat(source), copied = await stat(file)
      if (initial.size !== copied.size || current.size !== initial.size || current.mtimeMs !== initial.mtimeMs || current.ino !== initial.ino) throw new Error('APK changed during copying. Open it again after the other application finishes writing.')
      signal.throwIfAborted(); this.update(slot, { status: 'loading', result: null, message: 'Reading manifest, verifying signature and scanning APK contents…' })
      const database = this.database() ?? await loadDatabase(bundledDatabaseDirectory).catch(() => undefined)
      const results = await Promise.allSettled([contents(file, database, signal), verifyApk(file, this.tools, signal), apkLabel(file, this.tools, signal)])
      signal.throwIfAborted()
      for (const r of results) if (r.status === 'rejected') throw r.reason
      const data = (results[0] as PromiseFulfilledResult<Contents>).value, signature = (results[1] as PromiseFulfilledResult<InspectedApk['signature']>).value, label = (results[2] as PromiseFulfilledResult<{ label: string; issue: string }>).value
      if (label.issue) data.issues.push(label.issue)
      this.update(slot, { status: 'ready', message: 'Local inspection complete.', result: { ...data, signature, label: label.label || data.manifest.packageName, name: path.basename(source), path: source, bytes: copied.size, inspectedAt: new Date().toISOString() } })
    } finally { await rm(temporary, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }).catch(() => {}) }
  }
}
