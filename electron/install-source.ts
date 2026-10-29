import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { ZipFile } from 'yazl'
import { openRestoreZip } from './restore-zip.js'
import { readApkIdentity } from './apk-identity.js'

const limit = 8 * 1024 ** 3
async function copy(input: Readable, output: string | undefined, signal: AbortSignal, budget: { bytes: number }) {
  let bytes = 0; const hash = createHash('sha256')
  const meter = new Transform({ transform(chunk, _encoding, done) {
    bytes += chunk.length; budget.bytes += chunk.length
    if (bytes > limit || budget.bytes > 32 * 1024 ** 3) { done(new Error('Installation files exceed the size limit (8 GiB per file, 32 GiB per selection).')); return }
    hash.update(chunk); done(null, output ? chunk : undefined)
  } })
  if (output) await pipeline(input, meter, createWriteStream(output, { flags: 'wx', mode: 0o600 }), { signal })
  else await pipeline(input, meter, { signal })
  return { bytes, sha256: hash.digest('hex') }
}
async function identity(file: string, signal: AbortSignal) {
  const apk = await openRestoreZip(file, signal, 'apk')
  try { return readApkIdentity(await apk.buffer('AndroidManifest.xml', 8_000_000)) } finally { apk.close() }
}
// Normalize local installers into a private manifest for the existing verified install queue.
// Originals are never changed; archive entry names are never used as filesystem paths.
export async function prepareInstallSource(paths: string[], userId: number, signal: AbortSignal, progress: (text: string) => void) {
  if (!paths.length || paths.length > 500 || new Set(paths).size !== paths.length) throw new Error('Choose 1–500 distinct APK/APKS files.')
  const directory = await mkdtemp(path.join(os.tmpdir(), 'adb-vault-install-')), items = [], packages = new Set<string>(), budget = { bytes: 0 }
  try {
    for (const [index, input] of paths.entries()) {
      signal.throwIfAborted()
      const label = path.basename(input), extension = path.extname(input).toLowerCase()
      progress(`Checking ${index + 1} of ${paths.length}: ${label}`)
      try {
        const info = await lstat(input)
        if (!['.apk', '.apks'].includes(extension) || !info.isFile() || info.isSymbolicLink() || info.size > limit) throw new Error('Choose a regular APK or APKS file (up to 8 GiB).')
        const local = path.join(directory, `${index}.input`)
        const original = await copy(createReadStream(input), local, signal, budget)
        const parts: { file: string; local: string; sha256: string; bytes: number; identity: ReturnType<typeof readApkIdentity> }[] = []
        if (extension === '.apk') {
          const id = await identity(local, signal)
          if (id.split) throw new Error('This is a split APK. Choose the complete APKS archive, including its base APK.')
          parts.push({ file: 'base.apk', local, ...original, identity: id })
        } else {
          const archive = await openRestoreZip(local, signal)
          try {
            if (archive.names.some(n => n.toLowerCase() === 'toc.pb')) throw new Error('Bundletool APK sets are not supported here yet. Choose a single device APK set or a standalone APK.')
            const names = archive.names.filter(n => n.toLowerCase().endsWith('.apk'))
            if (!names.length || names.length > 128) throw new Error('An APKS archive must contain 1–128 APK parts.')
            for (const [partIndex, name] of names.entries()) {
              const target = path.join(directory, `${index}-part-${partIndex}.apk`)
              const digest = await copy(await archive.stream(name, limit), target, signal, budget)
              const id = await identity(target, signal)
              parts.push({ file: id.split ? `split-${partIndex}.apk` : 'base.apk', local: target, ...digest, identity: id })
            }
          } finally { archive.close() }
        }
        const base = parts.find(p => !p.identity.split), splits = new Set(parts.map(p => p.identity.split))
        if (!base || splits.size !== parts.length || parts.some(p => p.identity.packageName !== base.identity.packageName || p.identity.versionCode !== base.identity.versionCode)) throw new Error('APKS must contain one base and distinct splits from the same package and version.')
        if (parts.reduce((sum, p) => sum + p.bytes, 0) > limit) throw new Error('The uncompressed APK set exceeds 8 GiB.')
        if (packages.has(base.identity.packageName)) throw new Error(`More than one installer was selected for ${base.identity.packageName}. Choose one version.`)
        packages.add(base.identity.packageName)
        const format = extension === '.apk' ? 'apk' : 'apks', file = `${index}.${format}`, artifact = path.join(directory, file)
        let digest = original
        if (format === 'apk') digest = await copy(createReadStream(local), artifact, signal, { bytes: 0 })
        else {
          const zip = new ZipFile()
          const output = zip.outputStream as Readable
          zip.on('error', error => output.destroy(error))
          for (const p of parts) zip.addFile(p.local, p.file, { compress: false })
          const writing = copy(output, artifact, signal, { bytes: 0 }); zip.end(); digest = await writing
        }
        items.push({ packageName: base.identity.packageName, label, sourceVersionCode: base.identity.versionCode, sourceVersionName: null, archiveFormat: format,
          artifacts: [{ component: 'apk', file, ...digest }], files: parts.map(p => ({ file: format === 'apk' ? file : p.file, sha256: p.sha256, bytes: p.bytes })) })
        for (const temporary of new Set([local, ...parts.map(p => p.local)])) await rm(temporary, { force: true })
      } catch (error) { throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`) }
    }
    const file = path.join(directory, 'manifest.json')
    await writeFile(file, JSON.stringify({ format: 'adb-vault-app-backup', version: 3, device: { name: 'Local installation files' }, profile: { id: userId, name: 'Installation target' }, createdAt: new Date().toISOString(), items }), { flag: 'wx', mode: 0o600 })
    return { directory, file }
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error }
}
