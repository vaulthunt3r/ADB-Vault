import { open, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { dataRoots, type DataPart } from './app-data-backup.js'
import type { AndroidApp } from './apps-protocol.js'

export interface RestoreTree { sourceRoot: string; targetRoot: string; file: string; component: DataPart; private: boolean; preserveCache: boolean }
const number = (b: Buffer, start: number, length: number) => {
  const v = b.subarray(start, start + length)
  if (v[0] & 128) { let n = BigInt(v[0] & 127); for (const byte of v.subarray(1)) n = n * 256n + BigInt(byte); if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Oversized TAR number.'); return Number(n) }
  const s = v.toString('ascii').replace(/\0/g, '').trim()
  if (!/^[0-7]*$/.test(s)) throw new Error('Invalid TAR number.')
  return Number.parseInt(s || '0', 8)
}
const text = (b: Buffer) => b.subarray(0, b.indexOf(0) < 0 ? b.length : b.indexOf(0)).toString('utf8')
function safeName(name: string) {
  const clean = name.replace(/\/$/, '')
  if (!clean || Buffer.byteLength(clean) > 4096 || /[\\\x00-\x1f\x7f]/.test(clean) || clean.split('/').some(p => !p || p === '.' || p === '..' || p.startsWith('.adb-vault-restore-'))) throw new Error('Unsafe TAR path.')
  return clean
}
async function writeAll(handle: FileHandle, buffer: Buffer) { let n = 0; while (n < buffer.length) { const result = await handle.write(buffer, n, buffer.length - n); if (!result.bytesWritten) throw new Error('Could not stage TAR.'); n += result.bytesWritten } }
function header(name: string, bytes: number, directory: boolean, mode: number, mtime = 0) {
  const b = Buffer.alloc(512), parts = name.split('/'); let prefix = ''
  while (Buffer.byteLength(parts.join('/')) > 100 && parts.length > 1) prefix += (prefix ? '/' : '') + parts.shift()
  name = parts.join('/')
  if (Buffer.byteLength(name) > 100 || Buffer.byteLength(prefix) > 155) throw new Error('TAR path exceeds the supported USTAR limit.')
  b.write(name, 0); b.write(prefix, 345)
  const oct = (offset: number, length: number, n: number) => { const s = n.toString(8); if (s.length >= length) throw new Error('TAR entry exceeds supported size.'); b.write(s.padStart(length - 1, '0') + '\0', offset) }
  oct(100, 8, mode & 0o777); oct(108, 8, 0); oct(116, 8, 0); oct(124, 12, bytes); oct(136, 12, mtime)
  b.fill(32, 148, 156); b[156] = directory ? 53 : 48; b.write('ustar\0', 257); b.write('00', 263)
  b.write(b.reduce((n, byte) => n + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148)
  return b
}

// Repack only regular files/directories into fresh, root-specific relative archives.
// Never extract source paths, owners, links, devices, ACLs or extended attributes.
export async function prepareRestoreTrees(file: string, packageName: string, sourceUser: number, targetUser: number, component: DataPart, declaredRoots: string[], directory: string, signal: AbortSignal): Promise<RestoreTree[]> {
  const sourceApp = { packageName, userId: sourceUser } as AndroidApp
  const allowed = dataRoots(sourceApp, component), targets = dataRoots({ packageName, userId: targetUser } as AndroidApp, component)
  if (!declaredRoots.length || declaredRoots.length > 6 || new Set(declaredRoots).size !== declaredRoots.length) throw new Error('Missing or duplicate saved data roots.')
  const trees = declaredRoots.map((sourceRoot, i) => {
    const canonical = sourceUser === 0 ? sourceRoot.replace(/^\/data\/data\//, '/data/user/0/') : sourceRoot
    const index = allowed.indexOf(canonical)
    if (index < 0) throw new Error('Backup root is outside the selected application/profile.')
    return { sourceRoot, targetRoot: targets[index], file: path.join(directory, `${component}-${i}.restore.tar`), component, private: targets[index].startsWith('/data/'), preserveCache: component === 'data' }
  })
  if (new Set(trees.map(t => t.targetRoot)).size !== trees.length) throw new Error('Duplicate root aliases in data backup.')
  const input = await open(file, 'r'), outputs: FileHandle[] = []
  const seen = new Map<string, boolean>(), parents = new Set<string>(), rootSeen = new Set<number>()
  try {
    for (const tree of trees) { const out = await open(tree.file, 'wx', 0o600); outputs.push(out); await writeAll(out, header('payload', 0, true, 0o700)) }
    const size = (await input.stat()).size, h = Buffer.alloc(512); let offset = 0, zeros = 0, entries = 0, pendingName: string | undefined
    if (size < 1024 || size % 512) throw new Error('Incomplete TAR archive.')
    while (offset < size) {
      signal.throwIfAborted()
      if ((await input.read(h, 0, 512, offset)).bytesRead !== 512) throw new Error('Truncated TAR header.')
      offset += 512
      if (h.every(b => b === 0)) { zeros++; continue }
      if (zeros || ++entries > 200000) throw new Error('Invalid or oversized TAR archive.')
      if (h.reduce((n, b, i) => n + (i >= 148 && i < 156 ? 32 : b), 0) !== number(h, 148, 8)) throw new Error('TAR checksum mismatch.')
      const bytes = number(h, 124, 12), type = h[156]
      if (!Number.isSafeInteger(bytes) || bytes < 0 || offset + Math.ceil(bytes / 512) * 512 > size) throw new Error('Truncated TAR payload.')
      if (type === 76 || type === 120) {
        if (pendingName !== undefined || bytes > 65536) throw new Error('Unsupported TAR metadata chain.')
        const b = Buffer.alloc(bytes); if ((await input.read(b, 0, bytes, offset)).bytesRead !== bytes) throw new Error('Truncated TAR metadata.')
        if (type === 76) pendingName = text(b)
        else {
          let p = 0
          while (p < b.length) {
            const space = b.indexOf(32, p), lengthText = b.subarray(p, space).toString('ascii'), length = Number(lengthText)
            if (space < p || !/^\d+$/.test(lengthText) || length <= space - p + 2 || p + length > b.length || b[p + length - 1] !== 10) throw new Error('Invalid PAX record.')
            const record = b.subarray(space + 1, p + length - 1).toString('utf8'), equals = record.indexOf('='), key = record.slice(0, equals), value = record.slice(equals + 1)
            if (key === 'path') { if (pendingName !== undefined) throw new Error('Duplicate PAX path.'); pendingName = value }
            else if (!['mtime', 'atime', 'ctime', 'uid', 'gid', 'uname', 'gname'].includes(key)) throw new Error('Unsupported PAX metadata: ' + key)
            p += length
          }
        }
        offset += Math.ceil(bytes / 512) * 512; continue
      }
      const prefix = text(h.subarray(345, 500)), rawName = pendingName ?? (prefix ? prefix + '/' : '') + text(h.subarray(0, 100)); pendingName = undefined
      const name = safeName(rawName), isDir = type === 53
      const index = trees.findIndex(t => name === t.sourceRoot.slice(1) || name.startsWith(t.sourceRoot.slice(1) + '/'))
      if (index < 0) throw new Error('TAR member escapes the saved application roots.')
      const relative = name.slice(trees[index].sourceRoot.length).replace(/^\//, ''), key = `${index}/${relative}`
      // PackageManager owns the native-library link. Retain the installed app's link,
      // never follow or recreate its obsolete /data/app target from the backup.
      if (component === 'data' && trees[index].private && (relative === 'lib' || relative.startsWith('lib/'))) { offset += Math.ceil(bytes / 512) * 512; continue }
      if (![0, 48, 53].includes(type) || type === 53 && bytes !== 0) throw new Error('This data archive contains links or special files; restoration is blocked.')
      if (seen.has(key) || !isDir && parents.has(key)) throw new Error('Duplicate or conflicting TAR paths.')
      for (let parent = key.slice(0, key.lastIndexOf('/')); parent.includes('/'); parent = parent.slice(0, parent.lastIndexOf('/'))) { if (seen.get(parent) === false) throw new Error('A TAR parent is a file.'); parents.add(parent) }
      seen.set(key, isDir)
      if (!relative) { if (!isDir) throw new Error('Data root must be a directory.'); rootSeen.add(index) }
      else {
        if (component === 'data' && ['cache', 'code_cache'].includes(relative.split('/')[0])) throw new Error('Data archive unexpectedly includes cache.')
        await writeAll(outputs[index], header('payload/' + relative, bytes, isDir, number(h, 100, 8) | (isDir ? 0o700 : 0o600), number(h, 136, 12)))
        let remaining = bytes, position = offset
        const buffer = Buffer.alloc(Math.min(1024 * 1024, remaining))
        while (remaining) { signal.throwIfAborted(); const n = Math.min(buffer.length, remaining); if ((await input.read(buffer, 0, n, position)).bytesRead !== n) throw new Error('Truncated data file.'); await writeAll(outputs[index], buffer.subarray(0, n)); remaining -= n; position += n }
        if (bytes % 512) await writeAll(outputs[index], Buffer.alloc(512 - bytes % 512))
      }
      offset += Math.ceil(bytes / 512) * 512
    }
    if (zeros < 2 || pendingName !== undefined || rootSeen.size !== trees.length) throw new Error('Missing data roots or TAR end markers.')
    for (const output of outputs) await writeAll(output, Buffer.alloc(1024))
    return trees
  } finally { await input.close(); await Promise.all(outputs.map(o => o.close())) }
}
