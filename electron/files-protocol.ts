export interface FileLocation { kind: 'local' | 'device'; path: string; id?: string; serial?: string; transportId?: string; hardwareId?: string; root?: boolean }
export interface FileEntry { name: string; path: string; kind: 'file' | 'directory' | 'link' | 'other'; size: number; modified: number; hidden?: boolean; mode?: string; uid?: string; gid?: string; fingerprint: string; access?: 'restricted' }
export interface FileListing { location: FileLocation; entries: FileEntry[]; parent: string; free?: number; warning?: string }
export interface FileStorage { kind: 'internal' | 'sd' | 'usb' | 'external'; name: string; path: string; readOnly?: boolean; userId?: number; primary?: boolean }
export type FileAction = 'copy' | 'move' | 'delete' | 'rename' | 'mkdir' | 'create' | 'chmod'
export interface FileInput { path: string; fingerprint: string; name?: string }
export interface FileInstallSelection { source: FileLocation; items: FileInput[] }
export interface FileClipboardSelection { preparationTaskId?: string; preparationError?: string; token: string; mode: 'copy' | 'move'; groups: { source: FileLocation; entries: FileEntry[] }[] }
export interface FilePlan { action: FileAction; source: FileLocation; destination?: FileLocation; items: FileInput[]; conflict: 'ask' | 'skip' | 'keep-both' | 'replace' | 'merge'; confirmed: true; mode?: string }
export interface FileTaskItem { path: string; target?: string; status: 'pending' | 'running' | 'success' | 'partial' | 'skipped' | 'error' | 'cancelled' | 'interrupted'; message?: string; uncertain?: boolean; merged?: boolean; skipped?: number }
export interface FileTaskContents { files: number; folders: number }
export interface FileTask { id: string; action: FileAction; source: FileLocation; destination?: FileLocation; previousStatus?: string; status: 'interrupted' | 'queued' | 'running' | 'paused' | 'conflict' | 'success' | 'partial' | 'error' | 'cancelled'; createdAt: string; endedAt?: string; items: FileTaskItem[]; completed: number; bytes: number; totalBytes?: number; processedContents?: FileTaskContents; totalContents?: FileTaskContents; skippedContents?: FileTaskContents; scan?: FileTaskContents & { bytes: number }; progressNote?: string; phase?: 'scanning' | 'preparing' | 'transferring' | 'verifying' | 'finishing'; fileProgress?: { bytes: number; totalBytes: number }; current: string; pauseRequested: boolean; stopRequested: boolean; conflict?: { source: string; destination: string; directory: boolean; mergeable?: boolean }; undoable?: boolean }
export interface FilesState { tasks: FileTask[]; revision: number }
export interface FileProperties { entry: FileEntry; bytes?: number; count?: number; error?: string }
export type FilesRequest =
  | { type: 'files.clipboard.write'; selection: FileInstallSelection; mode: 'copy' | 'move' }
  | { type: 'files.clipboard.read' }
  | { type: 'files.clipboard.paste'; token: string; destination: FileLocation; confirmed: true }
  | { type: 'files.list'; location: FileLocation; recursive?: boolean; pattern?: string }
  | { type: 'files.storages'; location: FileLocation }
  | { type: 'files.properties'; location: FileLocation; calculate?: boolean }
  | { type: 'files.enqueue'; plan: FilePlan }
  | { type: 'files.control'; id: string; action: 'cancel' | 'pause' | 'resume' | 'retry' | 'undo' }
  | { type: 'files.resolve'; id: string; choice: FilePlan['conflict']; all: boolean }
  | { type: 'files.chooseFolder' }
  | { type: 'files.network.connect'; address: string; prompt: boolean }
  | { type: 'files.network.scan' | 'files.network.scan.cancel'; requestId: string }
  | { type: 'files.open'; location: FileLocation; withApp?: boolean }
  | { type: 'files.preview'; location: FileLocation; fingerprint: string; requestId: string }
  | { type: 'files.preview.close'; requestId: string }
  | { type: 'files.thumbnail'; location: FileLocation; fingerprint: string; requestId: string }
  | { type: 'files.thumbnail.cancel'; requestId: string }

export const fileTaskActive = (t: FileTask) => ['queued', 'running', 'paused', 'conflict'].includes(t.status)
export const fileActionLabel: Record<FileAction, string> = { copy: 'Copy', move: 'Move', delete: 'Delete', rename: 'Rename', mkdir: 'New folder', create: 'New file', chmod: 'Change permissions' }
export const fileBase = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
export const fileJoin = (location: FileLocation, name: string) => location.path.replace(/[\\/]+$/, '') + (location.kind === 'device' || location.path.startsWith('/') ? '/' : '\\') + name
export function nameProblem(name: string, local = false): string | null {
  if (!name || name === '.' || name === '..' || /[\x00-\x1f/\\]/.test(name) || name.length > 255) return 'Enter a valid single file name.'
  if (local && (/[<>:"|?*]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))) return 'This name cannot be used on Windows.'
  return null
}
export function filePattern(pattern: string): RegExp {
  if (pattern.length > 200) throw new Error('The name pattern is too long.')
  return new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i')
}

export const fileSelectionLabel = (count: number) => `${count} selected ${count === 1 ? 'item' : 'items'}`
export const fileContentsLabel = (contents: FileTaskContents) => `Files processed: ${contents.files} · Folders fully processed: ${contents.folders}`
