import type { FileEntry, FileLocation } from '../../electron/files-protocol'
import { filesRequest, useFilesStore } from '../store/useFilesStore'

// Serialize user clipboard commands, including a quick Copy followed by Paste.
let pending: Promise<unknown> = Promise.resolve()
export function fileClipboardCommand<T>(command: () => Promise<T>): Promise<T> {
  const next = pending.then(command, command)
  pending = next.catch(() => {})
  return next
}
export async function writeFileClipboard(source: FileLocation, entries: FileEntry[], mode: 'copy' | 'move') {
  const reply = await filesRequest({ type: 'files.clipboard.write', mode, selection: { source, items: entries.map(e => ({ path: e.path, fingerprint: e.fingerprint })) } })
  useFilesStore.setState({ clipboard: reply.fileClipboard })
  return reply
}
export async function readFileClipboard() {
  const reply = await filesRequest({ type: 'files.clipboard.read' })
  useFilesStore.setState({ clipboard: reply.fileClipboard })
  if (!reply.fileClipboard) throw new Error('The clipboard contains no files. Copy or cut files first.')
  return reply.fileClipboard
}
