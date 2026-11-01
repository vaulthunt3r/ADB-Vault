import { fileContentsLabel, type FileTask } from '../../electron/files-protocol'

export function fileSize(n: number) { if (n < 1024) return `${n} B`; const index = Math.min(4, Math.floor(Math.log(n) / Math.log(1024))); return `${(n / 1024 ** index).toFixed(index === 1 ? 0 : 1)} ${['B', 'KB', 'MB', 'GB', 'TB'][index]}` }
export function transferText(bytes: number, total: number) {
  return `${fileSize(bytes)} / ${fileSize(total)} · ${Math.max(0, Math.min(100, Math.floor(bytes / total * 100)))}%`
}
export function fileTaskStatus(task: FileTask) {
  if (task.stopRequested && ['running', 'paused', 'conflict'].includes(task.status)) return { state: 'stopping', text: "Stopping…" }
  if (task.status === 'conflict') return { state: 'attention', text: "Needs a decision" }
  if (task.status === 'paused') return { state: 'paused', text: "Paused" }
  if (task.status === 'queued') return { state: 'queued', text: "Queued" }
  if (task.status !== 'running') return { state: task.status, text: task.status }
  if (task.pauseRequested) return { state: 'running', text: task.phase === 'scanning' ? "Pausing…" : "Pausing after current file…" }
  const phases = { scanning: "Counting files and folders", preparing: "Preparing", transferring: "Transferring", verifying: "Verifying", finishing: "Finishing" }
  return { state: 'running', text: task.phase ? phases[task.phase] : "Running" }
}
export function fileTaskSummary(task: FileTask) {
  if (task.phase === 'scanning' && task.scan) return `${task.scan.files} files · ${task.scan.folders} folders found · ${fileSize(task.scan.bytes)}`
  const count = task.processedContents?.files
  const items = count === undefined ? `${task.completed} / ${task.items.length} selected items finished` : task.totalContents ? `${count} / ${task.totalContents.files} files · ${task.processedContents!.folders} / ${task.totalContents.folders} folders processed` : `${count} ${count === 1 ? 'file' : 'files'} processed`
  return items + (['copy', 'move'].includes(task.action) ? ` · ${fileSize(task.bytes)} transferred` : '')
}
export function fileTaskContentsText(task: FileTask) {
  if (!task.processedContents) return ''
  const done = task.processedContents, total = task.totalContents
  return total ? `Files processed: ${done.files} / ${total.files} · Folders fully processed: ${done.folders} / ${total.folders}` : fileContentsLabel(done)
}
export function fileTaskMeasurement(task: FileTask) {
  if (task.phase === 'scanning') return {}
  if (task.totalBytes && task.totalBytes > 0) return { completed: task.bytes, total: task.totalBytes, unit: 'bytes' as const, measure: "Total transferred" }
  if (task.totalContents && task.totalBytes === 0) return { completed: (task.processedContents?.files || 0) + (task.processedContents?.folders || 0), total: task.totalContents.files + task.totalContents.folders, measure: "Objects processed" }
  if (task.fileProgress && task.fileProgress.totalBytes > 0) return { completed: task.fileProgress.bytes, total: task.fileProgress.totalBytes, unit: 'bytes' as const, measure: "Current file" }
  return {}
}
