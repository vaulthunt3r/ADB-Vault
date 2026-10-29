import path from 'node:path'
import os from 'node:os'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { FileIO, validateFilePlan } from './files.js'
import { fileBase, nameProblem, type FileInstallSelection, type FileLocation } from './files-protocol.js'
import { prepareInstallSource } from './install-source.js'

export function validateFileInstallSelection(input: unknown): FileInstallSelection {
  const selection = input as FileInstallSelection
  if (!selection || !Array.isArray(selection.items) || !selection.items.length || selection.items.length > 500) throw new Error('Select 1–500 APK/APKS files.')
  validateFilePlan({ action: 'copy', source: selection.source, destination: selection.source, items: selection.items, conflict: 'ask', confirmed: true })
  if (selection.items.some(item => !/\.(apk|apks)$/i.test(item.path) || !item.fingerprint || item.name !== undefined)) throw new Error('Select only APK/APKS files, then refresh Files if the selection is outdated.')
  return selection
}

/** Read-only bridge into the existing installer. Phone originals are never changed. */
export async function prepareFileInstallSource(io: FileIO, input: FileInstallSelection, userId: number, signal: AbortSignal, progress: (text: string) => void) {
  const selection = validateFileInstallSelection(input), limit = 8 * 1024 ** 3
  const locations = selection.items.map(item => ({ ...selection.source, path: item.path }))
  const check = async (location: FileLocation, index: number) => {
    signal.throwIfAborted()
    const entry = await io.stat(location, signal)
    if (entry.kind !== 'file' || entry.fingerprint !== selection.items[index].fingerprint) throw new Error(`${fileBase(location.path)} changed since selection. Refresh Files and select it again.`)
    if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > limit) throw new Error('Installation files must be at most 8 GiB each.')
    return entry
  }
  let downloadDirectory: string | undefined, prepared: Awaited<ReturnType<typeof prepareInstallSource>> | undefined
  try {
    let total = 0
    for (const [index, location] of locations.entries()) { total += (await check(location, index)).size; if (total > 32 * 1024 ** 3) throw new Error('Installation selection exceeds 32 GiB.') }
    const paths: string[] = []
    if (selection.source.kind === 'device') downloadDirectory = await mkdtemp(path.join(os.tmpdir(), 'adb-vault-file-install-'))
    for (const [index, location] of locations.entries()) {
      const entry = await check(location, index)
      if (!downloadDirectory) { paths.push(location.path); continue }
      const folder = path.join(downloadDirectory, String(index)); await mkdir(folder)
      let name = entry.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      if (nameProblem(name, true)) name = `application-${index}${path.extname(name)}`
      const target: FileLocation = { kind: 'local', path: path.join(folder, name) }
      progress(`Reading ${index + 1} of ${locations.length}: ${entry.name}`)
      let bytes = 0, lastProgress = 0
      const oversized = new AbortController()
      await io.transfer(location, target, AbortSignal.any([signal, oversized.signal]), count => {
        bytes += count
        // FileIO's binary framing is counted before it is removed; allow a bounded trailer.
        if (bytes > entry.size + 4096) oversized.abort(new Error('Installation file grew during transfer.'))
        if (Date.now() - lastProgress > 250) { lastProgress = Date.now(); progress(`Reading ${index + 1} of ${locations.length}: ${entry.name} · ${Math.min(100, Math.floor(bytes / Math.max(1, entry.size) * 100))}%`) }
      })
      oversized.signal.throwIfAborted()
      await check(location, index)
      if ((await io.stat(target, signal)).size !== entry.size) throw new Error(`Incomplete transfer: ${entry.name}`)
      paths.push(target.path)
    }
    prepared = await prepareInstallSource(paths, userId, signal, progress)
    for (const [index, location] of locations.entries()) await check(location, index)
    return prepared
  } catch (error) {
    if (prepared) await rm(prepared.directory, { recursive: true, force: true })
    throw error
  } finally {
    // These paths are created exclusively by mkdtemp above, never supplied by the renderer.
    if (downloadDirectory) await rm(downloadDirectory, { recursive: true, force: true })
  }
}
