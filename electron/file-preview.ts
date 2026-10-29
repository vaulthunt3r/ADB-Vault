import * as fs from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import type { FileIO } from './files.js'
import type { FileLocation } from './files-protocol.js'
import { previewType, type FilePreview } from './file-preview-protocol.js'

const quote = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'"
interface PreviewSession { controller: AbortController; done: Promise<FilePreview>; token: string; handle?: FileHandle; folder?: string; mime?: string; size?: number; streams: Set<Readable> }

/** Only explicitly opened files receive an unguessable URL. No paths are accepted by the protocol. */
export class FilePreviewService {
  private sessions = new Map<string, PreviewSession>()
  constructor(private io: FileIO) {}
  async open(id: string, location: FileLocation, fingerprint: string) {
    if (this.sessions.has(id) || this.sessions.size >= 4) throw new Error('Close the current preview first.')
    const session: PreviewSession = { controller: new AbortController(), token: randomUUID(), done: undefined!, streams: new Set() }
    this.sessions.set(id, session)
    session.done = this.prepare(session, location, fingerprint)
    try { return await session.done } catch (error) { await this.close(id); throw error }
  }
  private async prepare(s: PreviewSession, location: FileLocation, fingerprint: string): Promise<FilePreview> {
    const signal = s.controller.signal, type = previewType(location.path)
    if (!type) throw new Error('No built-in viewer for this format. Choose Open with…')
    const [kind, mime] = type, entry = await this.io.stat(location, signal)
    if (entry.kind !== 'file' || entry.fingerprint !== fingerprint) throw new Error('File changed. Refresh the folder and open it again.')
    const limit = kind === 'text' ? 2 * 1024 ** 2 : kind === 'image' ? 64 * 1024 ** 2 : 2 * 1024 ** 3
    if ((kind === 'text' || kind === 'image' || location.kind === 'device') && entry.size > limit) throw new Error(`This file exceeds the ${limit / 1024 ** 2} MiB preview limit. Choose Open with…`)
    let local = location.path
    if (location.kind === 'device') {
      s.folder = await fs.mkdtemp(path.join(os.tmpdir(), 'adb-vault-preview-'))
      local = path.join(s.folder, 'content')
      let received = 0
      await this.io.command(location, `test -f ${quote(location.path)} && test ! -L ${quote(location.path)} && head -c ${entry.size + 1} -- ${quote(location.path)}`, signal, local, bytes => {
        received += bytes
        if (received > entry.size + 4096) s.controller.abort(new Error('File grew while downloading.'))
      }, 30 * 60_000)
      this.io.device(location)
    }
    signal.throwIfAborted()
    s.handle = await fs.open(local, 'r')
    const stat = await s.handle.stat()
    if (!stat.isFile() || stat.size !== entry.size || (await this.io.stat(location, signal)).fingerprint !== fingerprint) throw new Error('File changed while preparing the preview.')
    s.size = stat.size; s.mime = mime
    if (kind === 'text') {
      const bytes = Buffer.alloc(Math.min(limit + 1, stat.size + 1))
      let count = 0
      while (count < bytes.length) { signal.throwIfAborted(); const r = await s.handle.read(bytes, count, bytes.length - count, count); if (!r.bytesRead) break; count += r.bytesRead }
      if (count !== stat.size) throw new Error('File changed while reading.')
      const data = bytes.subarray(0, count)
      const encoding = data[0] === 0xff && data[1] === 0xfe ? 'utf-16le' : data[0] === 0xfe && data[1] === 0xff ? 'utf-16be' : 'utf-8'
      return { kind, text: new TextDecoder(encoding, { fatal: true }).decode(data) }
    }
    signal.throwIfAborted()
    return { kind, url: `vault-media://preview/${s.token}` }
  }
  async respond(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const s = [...this.sessions.values()].find(s => url.hostname === 'preview' && url.pathname === '/' + s.token && !url.search && !url.hash)
    if (!s?.handle || s.size === undefined || s.controller.signal.aborted || !['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 404 })
    const size = s.size, range = request.headers.get('range')
    let start = 0, end = size - 1
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (!m || !m[1] && !m[2]) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
      start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2])); end = m[1] && m[2] ? Math.min(size - 1, Number(m[2])) : size - 1
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    }
    const headers: Record<string, string> = { 'Content-Type': s.mime!, 'Content-Length': String(Math.max(0, end - start + 1)), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" }
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
    if (request.method === 'HEAD' || !size) return new Response(null, { status: range ? 206 : 200, headers })
    // Cancelling a media range must not close the session's shared handle.
    // FileHandle.createReadStream destroys that handle on cancellation even
    // with autoClose:false. Read by position so overlapping seeks are isolated.
    const handle = s.handle, sessionSignal = s.controller.signal
    const stream = Readable.from((async function* () {
      for (let position = start; position <= end;) {
        request.signal.throwIfAborted(); sessionSignal.throwIfAborted()
        const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, end - position + 1))
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, position)
        request.signal.throwIfAborted(); sessionSignal.throwIfAborted()
        if (!bytesRead) throw new Error('File ended before the requested preview range was read.')
        position += bytesRead
        yield chunk.subarray(0, bytesRead)
      }
    })(), { objectMode: false, highWaterMark: 64 * 1024, signal: request.signal })
    s.streams.add(stream); stream.once('close', () => s.streams.delete(stream)); stream.once('end', () => s.streams.delete(stream))
    return new Response(Readable.toWeb(stream, { strategy: { highWaterMark: 64 * 1024, size: chunk => chunk.byteLength } }) as ReadableStream<Uint8Array>, { status: range ? 206 : 200, headers })
  }
  async close(id: string) {
    const s = this.sessions.get(id); if (!s) return
    this.sessions.delete(id); s.controller.abort()
    await s.done.catch(() => {})
    for (const stream of s.streams) stream.destroy()
    await s.handle?.close().catch(() => {})
    if (s.folder) await fs.rm(s.folder, { recursive: true, force: true }).catch(() => {})
  }
  async shutdown() { await Promise.all([...this.sessions.keys()].map(id => this.close(id))) }
}
