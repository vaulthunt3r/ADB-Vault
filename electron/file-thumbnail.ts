import * as fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { FileIO } from './files.js'
import type { FileLocation } from './files-protocol.js'
import { thumbnailImage, thumbnailMaxBytes } from './file-thumbnail-protocol.js'

const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'"

/** Read-only, bounded preview input. Uses the existing pinned transport and Shell/root access. */
export async function readThumbnailBytes(io: FileIO, location: FileLocation, fingerprint: string, cancel: AbortSignal): Promise<Buffer | undefined> {
  const signal = AbortSignal.any([cancel, AbortSignal.timeout(60_000)])
  signal.throwIfAborted()
  if (!/\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(location.path)) return
  const entry = await io.stat(location, signal)
  if (!thumbnailImage(entry) || entry.fingerprint !== fingerprint) return
  let folder: string | undefined
  try {
    let local = location.path
    if (location.kind === 'device') {
      folder = await fs.mkdtemp(path.join(os.tmpdir(), 'adb-vault-thumbnail-'))
      local = path.join(folder, 'image')
      const oversized = new AbortController()
      let received = 0
      const p = quote(location.path)
      // Bound the remote read even if a file grows after stat. The stream completion frame is verified by FileIO.
      await io.command(location, `test -f ${p} && test ! -L ${p} && head -c ${thumbnailMaxBytes + 1} -- ${p}`, AbortSignal.any([signal, oversized.signal]), local, bytes => {
        received += bytes
        if (received > thumbnailMaxBytes + 4096) oversized.abort()
      }, 55_000)
      io.device(location)
    }
    signal.throwIfAborted()
    const handle = await fs.open(local, 'r')
    let bytes: Buffer
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size !== entry.size) return
      bytes = Buffer.alloc(entry.size + 1)
      let count = 0
      while (count < bytes.length) {
        signal.throwIfAborted()
        const read = await handle.read(bytes, count, bytes.length - count, count)
        if (!read.bytesRead) break
        count += read.bytesRead
      }
      if (count !== entry.size) return
      bytes = bytes.subarray(0, count)
    } finally { await handle.close() }
    if ((await io.stat(location, signal)).fingerprint !== fingerprint) return
    signal.throwIfAborted()
    return bytes
  } finally { if (folder) await fs.rm(folder, { recursive: true, force: true }) }
}
