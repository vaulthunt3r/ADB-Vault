import { ZipFile } from 'yazl'
import { writeFile, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'

export const sha = data => ({ sha256: createHash('sha256').update(data).digest('hex'), bytes: data.length })
export function manifest(packageName = 'org.example.notes', versionCode = 7, split = '', utf8 = true) {
  const strings = ['manifest', 'package', packageName, 'http://schemas.android.com/apk/res/android', 'versionCode', 'split', split]
  const chunks = strings.map(s => { const b = Buffer.from(s, utf8 ? 'utf8' : 'utf16le'); const prefix = Buffer.alloc(utf8 ? 2 : 2); if (utf8) { prefix[0] = s.length; prefix[1] = b.length } else prefix.writeUInt16LE(s.length); return Buffer.concat([prefix, b, Buffer.alloc(utf8 ? 1 : 2)]) })
  const start = 28 + strings.length * 4, pool = Buffer.alloc((start + chunks.reduce((n, c) => n + c.length, 0) + 3) & ~3)
  pool.writeUInt16LE(1); pool.writeUInt16LE(28, 2); pool.writeUInt32LE(pool.length, 4); pool.writeUInt32LE(strings.length, 8); pool.writeUInt32LE(utf8 ? 256 : 0, 16); pool.writeUInt32LE(start, 20)
  let pos = 0; chunks.forEach((c, i) => { pool.writeUInt32LE(pos, 28 + i * 4); c.copy(pool, start + pos); pos += c.length })
  const attrs = [{ ns: 0xffffffff, name: 1, type: 3, value: 2 }, { ns: 3, name: 4, type: 0x10, value: versionCode }, ...(split ? [{ ns: 0xffffffff, name: 5, type: 3, value: 6 }] : [])]
  const root = Buffer.alloc(36 + attrs.length * 20); root.writeUInt16LE(0x102); root.writeUInt16LE(16, 2); root.writeUInt32LE(root.length, 4); root.writeUInt32LE(0xffffffff, 12); root.writeUInt32LE(0xffffffff, 16); root.writeUInt32LE(0, 20); root.writeUInt16LE(20, 24); root.writeUInt16LE(20, 26); root.writeUInt16LE(attrs.length, 28)
  attrs.forEach((a, i) => { const p = 36 + i * 20; root.writeUInt32LE(a.ns, p); root.writeUInt32LE(a.name, p + 4); root.writeUInt32LE(0xffffffff, p + 8); root.writeUInt16LE(8, p + 12); root[p + 15] = a.type; root.writeUInt32LE(a.value, p + 16) })
  const header = Buffer.alloc(8); header.writeUInt16LE(3); header.writeUInt16LE(8, 2); header.writeUInt32LE(8 + pool.length + root.length, 4)
  return Buffer.concat([header, pool, root])
}
export async function zip(entries) {
  const archive = new ZipFile(), parts = []
  const done = new Promise((resolve, reject) => { archive.outputStream.on('data', c => parts.push(c)); archive.outputStream.on('end', () => resolve(Buffer.concat(parts))); archive.outputStream.on('error', reject) })
  for (const [name, data] of entries) archive.addBuffer(data, name)
  archive.end(); return done
}
export async function backupFixture(options = {}) {
  const root = await mkdtemp(path.join(options.parent || os.tmpdir(), 'adb-vault-restore-test-'))
  const apk = await zip([['AndroidManifest.xml', manifest(options.actualPackage, options.actualVersion, '', options.utf8 !== false)]])
  const files = [['base.apk', apk]]
  if (options.split) files.push(['split-01.apk', await zip([['AndroidManifest.xml', manifest('org.example.notes', 7, 'config.en')]])])
  const artifact = options.split ? await zip([...files, ['meta.sai_v1.json', Buffer.from('{}')]]) : apk
  const name = options.split ? 'Notes.apks' : 'Notes.apk'
  const report = { format: 'adb-vault-app-backup', version: 3, createdAt: new Date().toISOString(), device: { name: 'Source phone', identity: 'original' }, profile: { id: 0, name: 'Owner' }, items: [{ packageName: 'org.example.notes', label: 'Notes', status: 'success', sourceVersionCode: 7, sourceVersionName: '1.7', archiveFormat: options.split ? 'apks' : 'apk', artifact: name, artifactIntegrity: sha(artifact), artifacts: [{ component: 'apk', file: name, ...sha(artifact) }], files: files.map(([file, data]) => ({ file: options.split ? file : name, ...sha(data) })) }] }
  const manifestPath = path.join(root, 'manifest.json'); await writeFile(manifestPath, JSON.stringify(report)); await writeFile(path.join(root, name), artifact)
  return { root, report, manifestPath, artifact, name, files, save: () => writeFile(manifestPath, JSON.stringify(report)) }
}

export function tar(entries) {
  const chunks = []
  for (const { name, type = '0', data = Buffer.alloc(0), mode = 0o600 } of entries) {
    const h = Buffer.alloc(512); h.write(name); h.write(mode.toString(8).padStart(7, '0') + '\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116); h.write(data.length.toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136); h.fill(32, 148, 156); h[156] = type.charCodeAt(0); h.write('ustar\0', 257); h.write('00', 263); h.write(h.reduce((n, b) => n + b, 0).toString(8).padStart(6, '0') + '\0 ', 148)
    chunks.push(h, data, Buffer.alloc((512 - data.length % 512) % 512))
  }
  return Buffer.concat([...chunks, Buffer.alloc(1024)])
}
