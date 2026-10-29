import { dialog } from "./localized-dialog.js"
import { BrowserWindow, shell } from 'electron'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { FileLocation } from './files-protocol.js'
import type { FileIO, FilesService } from './files.js'
import { readThumbnailBytes } from './file-thumbnail.js'
import type { ConfirmationContent } from './confirmation-protocol.js'

export async function openManagedFile(service: FilesService, location: FileLocation, withApp: boolean, storageRoot: string, confirm: (content: ConfirmationContent) => Promise<boolean>) {
  const io = service.io
  const entry = await io.stat(location)
  if (entry.kind !== 'file') throw new Error('Choose a regular file to open.')
  const owner = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
  const accepted = await confirm({ title: 'Open file', description: entry.name, confirmLabel: withApp ? 'Choose application…' : 'Open', tone: 'normal',
    context: [{ label: 'Location', value: location.path }],
    effects: [...(location.kind === 'device' ? ['A local copy will be downloaded. Edits are not sent back to the phone.'] : []), withApp ? 'Choose an application on this PC to open the file.' : 'The file will open in its default application on this PC.'],
  })
  if (!accepted) return
  let application: string | undefined
  if (withApp) { const pick = await dialog.showOpenDialog(owner, { title: 'Choose application', properties: ['openFile'], filters: [{ name: 'Application', extensions: ['exe'] }] }); if (pick.canceled) return; application = pick.filePaths[0] }
  let local = location.path
  if (location.kind === 'device') {
    const folder = path.join(storageRoot, 'file-open-copies', randomUUID()); await fs.mkdir(folder, { recursive: true })
    const name = entry.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '') || 'file'
    local = path.join(folder, name)
    try {
      const id = service.enqueue({ action: 'copy', source: { ...location, path: path.posix.dirname(location.path) }, destination: { kind: 'local', path: folder }, items: [{ path: location.path, fingerprint: entry.fingerprint }], conflict: 'ask', confirmed: true })
      const task = await service.waitForTask(id)
      if (task.status !== 'success') throw new Error(task.items[0]?.message || 'The local copy was not completed.')
      local = task.items[0].target!
    }
    catch (e) { await fs.rm(folder, { recursive: true, force: true }); throw e }
    if ((await fs.stat(local)).size !== entry.size) throw new Error('The local copy is incomplete. It was not opened.')
  }
  if (application) await new Promise<void>((resolve, reject) => { const p = spawn(application!, [local], { shell: false, windowsHide: false, detached: true, stdio: 'ignore' }); p.once('error', reject); p.once('spawn', () => { p.unref(); resolve() }) })
  else { const error = await shell.openPath(local); if (error) throw new Error(error) }
  return location.kind === 'device' ? 'Opened a local copy. Changes are not sent back to the phone: ' + local : undefined
}
export async function fileThumbnail(io: FileIO, location: FileLocation, fingerprint: string, signal: AbortSignal) {
  const bytes = await readThumbnailBytes(io, location, fingerprint, signal)
  if (!bytes || signal.aborted) return undefined
  const extension = path.extname(location.path).slice(1).toLowerCase()
  const mime = extension === 'jpg' ? 'jpeg' : extension
  // Chromium decodes all supported formats; no synchronous image decoding on the main process.
  return `data:image/${mime};base64,${bytes.toString('base64')}`
}
