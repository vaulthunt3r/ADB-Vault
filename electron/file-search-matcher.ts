import { parentPort, workerData } from 'node:worker_threads'
import type { FileSearchQuery } from './file-search-protocol.js'
import type { FileEntry } from './files-protocol.js'

// Untrusted regular expressions run outside the Electron main thread. The owner
// terminates this worker on timeout or cancellation, including a stuck RegExp.
const q = workerData as FileSearchQuery
try {
  const flags = q.caseSensitive ? '' : 'i'
  const regex = q.nameMode === 'contains' ? null : new RegExp(q.nameMode === 'regex' ? q.name : '^' + q.name.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', flags)
  const needle = q.caseSensitive ? q.name : q.name.toLocaleLowerCase()
  parentPort!.on('message', ({ entries, text }: { entries?: FileEntry[]; text?: string }) => {
    if (text !== undefined) { parentPort!.postMessage((q.caseSensitive ? text : text.toLocaleLowerCase()).includes(q.caseSensitive ? q.text : q.text.toLocaleLowerCase())); return }
    parentPort!.postMessage(entries!.map(e =>
      (q.kind === 'any' || e.kind === q.kind) &&
      (q.minSize === undefined || e.kind === 'file' && e.size >= q.minSize) &&
      (q.maxSize === undefined || e.kind === 'file' && e.size <= q.maxSize) &&
      (q.after === undefined || e.modified >= q.after) && (q.before === undefined || e.modified <= q.before) &&
      (!q.name || (regex ? regex.test(e.name) : (q.caseSensitive ? e.name : e.name.toLocaleLowerCase()).includes(needle)))))
  })
  parentPort!.postMessage({ ready: true })
} catch (e) { parentPort!.postMessage({ error: e instanceof Error ? e.message : String(e) }) }
