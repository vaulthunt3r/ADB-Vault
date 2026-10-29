import { createRequire } from 'node:module'
import type { EventEmitter } from 'node:events'
import type { Readable } from 'node:stream'

interface Entry { fileName: string; uncompressedSize: number; compressedSize: number; crc32: number; externalFileAttributes: number; generalPurposeBitFlag: number }
interface Zip extends EventEmitter { readEntry(): void; close(): void; openReadStream(entry: Entry, callback: (error: Error | null, stream: Readable) => void): void }
const yauzl = createRequire(import.meta.url)('yauzl') as { open(file: string, options: object, callback: (error: Error | null, zip: Zip) => void): void }

// Read entries by name; archive paths are never used as extraction destinations.
export async function openRestoreZip(file: string, signal?: AbortSignal, entryNames: 'portable' | 'apk' = 'portable') {
  signal?.throwIfAborted()
  const zip = await new Promise<Zip>((resolve, reject) => yauzl.open(file, { lazyEntries: true, autoClose: false, strictFileNames: true, validateEntrySizes: true }, (error, value) => error ? reject(error) : resolve(value)))
  const entries = new Map<string, Entry>(), names = new Set<string>()
  let failure: Error | undefined
  zip.on('error', error => { failure = error })
  try {
    await new Promise<void>((resolve, reject) => {
      const abort = () => { cleanup(); reject(new Error('Verification cancelled.')) }
      const cleanup = () => { signal?.removeEventListener('abort', abort); zip.removeListener('error', onError) }
      const onError = (error: Error) => { cleanup(); reject(error) }
      signal?.addEventListener('abort', abort, { once: true })
      zip.once('error', onError)
      zip.once('end', () => { cleanup(); resolve() })
      zip.on('entry', (entry: Entry) => {
        try {
          signal?.throwIfAborted()
          const name = entry.fileName, parts = name.replace(/\/$/, '').split('/')
          const mode = (entry.externalFileAttributes >>> 16) & 0xf000
          // APK resource names are case-sensitive and remain inside the original APK.
          // Backup/APKS filenames keep portable, case-insensitive collision checks.
          const key = entryNames === 'apk' ? name : name.toLowerCase()
          const reason = !name || name.length > 1024 || /[\\:\x00-\x1f]/.test(name) || parts.some(p => !p || p === '.' || p === '..') ? 'invalid path'
            : names.has(key) ? 'duplicate entry name'
            : mode && mode !== 0x8000 && mode !== 0x4000 ? 'unsupported file type'
            : entry.generalPurposeBitFlag & 1 ? 'encrypted entry'
            : !Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || entry.uncompressedSize > 64 * 1024 ** 3 ? 'invalid or oversized entry'
            : names.size >= 100000 ? 'too many entries' : null
          if (reason) throw new Error(`Unsupported or unsafe ZIP entry ${JSON.stringify(name)}: ${reason}.`)
          names.add(key); entries.set(name, entry); zip.readEntry()
        } catch (error) { cleanup(); reject(error) }
      })
      zip.readEntry()
    })
    signal?.throwIfAborted()
  } catch (error) { zip.close(); throw error }
  return {
    names: [...entries.keys()],
    entries: [...entries.values()].map(e => ({ name: e.fileName, bytes: e.uncompressedSize, compressed: e.compressedSize, crc32: e.crc32 })),
    close: () => zip.close(),
    async stream(name: string, limit: number) {
      signal?.throwIfAborted()
      if (failure) throw failure
      const entry = entries.get(name)
      if (!entry || entry.fileName.endsWith('/') || entry.uncompressedSize > limit) throw new Error(`Missing or oversized archive file: ${name}`)
      return new Promise<Readable>((resolve, reject) => zip.openReadStream(entry, (error, stream) => error ? reject(error) : resolve(stream)))
    },
    async buffer(name: string, limit: number): Promise<Buffer> {
      const stream = await this.stream(name, limit), chunks: Buffer[] = []; let size = 0
      try { for await (const chunk of stream) { signal?.throwIfAborted(); size += chunk.length; if (size > limit) throw new Error('Archive entry exceeds its limit.'); chunks.push(chunk) } } finally { stream.destroy() }
      return Buffer.concat(chunks)
    },
  }
}
