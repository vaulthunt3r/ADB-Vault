import { fileSourceLabel } from '../../electron/file-locations'
import { useEffect, useRef, useState } from 'react'
import { ListTodo, Pause, Play, RotateCcw, X } from 'lucide-react'
import { fileActionLabel, fileTaskActive, fileSelectionLabel, type FileTask } from '../../electron/files-protocol'
import { filesRequest, useFilesStore } from '../store/useFilesStore'
import { useAppStore } from '../store/useAppStore'
import { useConnectionStore } from '../store/useConnectionStore'
import { useHistoryStore } from '../store/useHistoryStore'
import { HistorySessions } from './HistorySessions'
import { resolveFileReadLocation } from '../../electron/file-places'
import { IconButton } from './ui'
import { OperationChip } from './operation-chip/OperationChip'
import { fileSize, fileTaskStatus, fileTaskContentsText, fileTaskSummary, transferText } from '../lib/fileTaskProgress'
export { fileSize } from '../lib/fileTaskProgress'

export function FileTasks() {
  const { taskPanel, tasks: currentTasks } = useFilesStore(), ref = useRef<HTMLElement>(null)
  const history = useHistoryStore(), archived = !!history.filesSession
  const tasks = history.filesSession ? { tasks: history.archives[history.filesSession]?.tasks || [] } : currentTasks
  const [error, setError] = useState('')
  const close = () => useFilesStore.setState({ taskPanel: false })
  useEffect(() => { if (taskPanel) ref.current?.focus() }, [taskPanel])
  if (!taskPanel) return null
  const control = async (t: FileTask, action: 'pause' | 'resume' | 'cancel' | 'retry' | 'undo') => { try { setError(''); await filesRequest({ type: 'files.control', id: t.id, action }) } catch (e) { setError(String(e)) } }
  const inspect = (location: FileTask['source']) => {
    try { const fresh = resolveFileReadLocation({ ...location, root: false }, useConnectionStore.getState().devices); useFilesStore.getState().navigate(useFilesStore.getState().active, fresh, true); close(); useAppStore.getState().setSection('files') }
    catch (e) { setError(String(e)) }
  }
  return <aside className="file-tasks" aria-label="File tasks" tabIndex={-1} ref={ref} onKeyDown={e => { if (e.key === 'Escape') close() }}>
    <header><ListTodo size={18} /><h2>File tasks</h2><span>{archived ? `${tasks.tasks.length} saved` : `${tasks.tasks.filter(fileTaskActive).length} active`}</span><IconButton label="Close file tasks" onClick={close}><X size={16} /></IconButton></header>
    <HistorySessions view="files" />
    {error && <p role="alert" className="file-error">{error}</p>}
    <div className="file-task-list">{!tasks.tasks.length && <p className="file-empty">No file tasks yet.</p>}{[...tasks.tasks].reverse().map(t => <article key={t.id} className="file-task">
      <FileTaskProgress task={t} />
      <div className="file-task-path">{fileSourceLabel(t.source)} · {t.source.path}{t.destination && <><br />→ {fileSourceLabel(t.destination)} · {t.destination.path}</>}</div>
      <small>{"Selected items finished: "}{t.completed} / {t.items.length}{t.bytes > 0 && !(t.totalBytes && t.totalBytes > 0 && t.phase !== 'scanning') ? ` · ${fileSize(t.bytes)} transferred` : ''}</small>
      {t.phase === 'scanning' && <p className="file-task-content-count">{fileTaskSummary(t)}{" · Calculating overall size…"}</p>}
      {t.processedContents && t.phase !== 'scanning' && <p className="file-task-content-count" title="A folder is counted only after all its contents have been processed. Counts include nested and selected folders. Skipped objects are excluded from the totals. Final results are listed below.">{fileTaskContentsText(t)}</p>}
      {t.skippedContents && <p className="file-task-content-count">{"Skipped: "}{t.skippedContents.files}{" files · "}{t.skippedContents.folders}{" folders"}</p>}
      {t.progressNote && <p className="warning-text">{t.progressNote}</p>}
      {t.phase !== 'scanning' && t.fileProgress && t.fileProgress.totalBytes > 0 && <div className="file-transfer-meter"><OperationChip layout="panel" label="Current file" status={fileTaskStatus(t).state} statusText={fileTaskStatus(t).text} progress={t.fileProgress.bytes / t.fileProgress.totalBytes * 100} measurement={transferText(t.fileProgress.bytes, t.fileProgress.totalBytes)} progressLabel="Current file progress" icon={<ListTodo />} /></div>}
      {['copy', 'move'].includes(t.action) && t.phase !== 'scanning' && (!(t.totalBytes && t.totalBytes > 0) && (t.totalContents && t.totalBytes === 0 ? t.totalContents.files + t.totalContents.folders === 0 && <p className="file-task-content-count">No objects left to transfer.</p> : fileTaskActive(t) && <p className="file-task-content-count">Overall size: not yet known</p>))}
      {t.status === 'interrupted' && <p className="warning-text">{"Interrupted — verify the result. Last saved state: "}{t.previousStatus || ""}. Counts describe the last saved progress; prepared files may not have reached their final destination. Pending items were not confirmed as started.</p>}
      {t.conflict && !archived && <FileConflict key={t.conflict.source + t.conflict.destination} task={t} />}
      {archived ? <div className="file-task-controls"><button className="button secondary" onClick={() => inspect(t.source)}>Inspect source</button>{t.destination && <button className="button secondary" onClick={() => inspect(t.destination!)}>Inspect destination</button>}</div> : <>
      <div className="file-task-controls">{fileTaskActive(t) ? <><button className="button secondary" disabled={t.status === 'conflict' || t.stopRequested} onClick={() => void control(t, t.pauseRequested ? 'resume' : 'pause')}>{t.pauseRequested ? <Play size={14} /> : <Pause size={14} />}{t.pauseRequested ? "Resume" : "Pause"}</button><button className="button secondary" disabled={t.stopRequested} title="Completed changes are kept. Incomplete transfers are cleaned up where possible." onClick={() => void control(t, 'cancel')}><X size={14} />{t.stopRequested ? "Stopping…" : "Stop"}</button></> : <>{t.items.some(i => ['error', 'cancelled'].includes(i.status) && !i.uncertain && !i.merged) && <button className="button secondary" onClick={() => void control(t, 'retry')}><RotateCcw size={14} />Retry unfinished</button>}{t.undoable && <button className="button secondary" title="Available only while the affected objects have not changed and the original paths are free." disabled={tasks.tasks.some(fileTaskActive)} onClick={() => void control(t, 'undo')}><RotateCcw size={14} />Undo</button>}</>}</div>
      </>}
      <details><summary>Object results</summary>{t.items.map((i, n) => <div className="file-task-result" key={n}><span>{i.status}</span><code>{i.path}</code>{i.target && <code>→ {i.target}</code>}{i.message && <p>{i.message}</p>}{i.uncertain && <p className="warning-text">Outcome uncertain. Check both locations before retrying.</p>}</div>)}</details>
    </article>)}</div>
    <footer><span>{archived ? "Read-only history. Inspect both locations and select remaining files again to retry. Up to 100 tasks per session." : "Pause takes effect between files. Tasks continue when this panel is closed."}</span><button className="text-button" onClick={() => { close(); useAppStore.getState().setSection('activity'); void history.select('activity', history.filesSession) }}>Open Activity</button></footer>
  </aside>
}
function FileTaskProgress({ task }: { task: FileTask }) {
  const status = fileTaskStatus(task)
  const totalObjects = task.totalContents ? task.totalContents.files + task.totalContents.folders : 0
  const processedObjects = (task.processedContents?.files || 0) + (task.processedContents?.folders || 0)
  // The task header always measures the whole task, never one of its files.
  const bytesKnown = task.phase !== 'scanning' && task.totalBytes !== undefined && task.totalBytes > 0
  const objectsKnown = task.phase !== 'scanning' && task.totalBytes === 0 && totalObjects > 0
  return <OperationChip layout="panel" label={`${fileActionLabel[task.action]} · ${fileSelectionLabel(task.items.length)}`}
    status={status.state} statusText={status.text} message={task.current}
    progress={bytesKnown ? task.bytes / task.totalBytes! * 100 : objectsKnown ? processedObjects / totalObjects * 100 : undefined}
    measurement={bytesKnown ? `Total: ${transferText(task.bytes, task.totalBytes!)}` : objectsKnown ? `${processedObjects} / ${totalObjects} objects processed` : undefined}
    progressLabel={bytesKnown ? "Total transferred progress" : "Objects processed progress"}
    startedAt={Date.parse(task.createdAt)} icon={<ListTodo />} />
}
function FileConflict({ task }: { task: FileTask }) {
  const [all, setAll] = useState(false), [error, setError] = useState(''), conflict = task.conflict!
  async function resolve(choice: 'skip' | 'keep-both' | 'replace' | 'merge') { try { setError(''); await filesRequest({ type: 'files.resolve', id: task.id, choice, all }) } catch (e) { setError(String(e)) } }
  return <div className="file-conflict" role="group" aria-label="Existing destination"><strong>Destination already exists</strong><code>{conflict.destination}</code><label><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} />{"Apply to remaining "}{conflict.mergeable ? "folder" : conflict.directory ? "file/folder" : "file"}{" conflicts"}</label><div className="file-task-controls"><button className="button secondary" onClick={() => void resolve('skip')}>Skip</button><button className="button secondary" onClick={() => void resolve('keep-both')}>Keep both</button>{conflict.mergeable && <button className="button primary" title="Combine folder contents. Existing files are resolved separately." onClick={() => void resolve('merge')}>Merge folders</button>}<button className="button secondary" disabled={conflict.directory} title={conflict.directory ? "Folder replacement is not supported." : "Replace the existing file with the complete new copy."} onClick={() => void resolve('replace')}>Replace</button></div>{error && <p role="alert">{error}</p>}</div>
}
