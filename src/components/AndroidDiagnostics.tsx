import { ActionIndicator } from './ui'
import { HintButton } from './Tooltip'
import { useMemo, useState } from 'react'
import { ClipboardList, FileDown } from 'lucide-react'
import type { DeviceRecord } from '../../electron/contracts'
import type { LogBuffer } from '../../electron/android-diagnostics-protocol'
import { useAndroidDiagnosticsStore, sameDiagnosticTarget } from '../store/useAndroidDiagnosticsStore'
import { useConnectionStore } from '../store/useConnectionStore'
import { usePowerBlocked } from './DevicePowerActions'
import { BadgeDialog } from './BadgeDialog'
import { requestBackend } from '../lib/backend'

export function AndroidDiagnosticActions({ device }: { device: DeviceRecord }) {
  const state = useAndroidDiagnosticsStore(), blocked = usePowerBlocked() || device.status !== 'connected'
  return <>{(['logcat', 'bugreport'] as const).map(kind => <HintButton key={kind} hint={kind === 'logcat' ? "Read a snapshot of Android Logcat, search or filter it, and save the results." : "Choose a destination and collect an Android diagnostic report. Collection can take several minutes."} className="button secondary" disabled={blocked && !(state.job?.status === 'running' && state.job.kind === kind && sameDiagnosticTarget(state.job.target, device))} onClick={() => state.open(kind, device)}>{kind === 'logcat' ? <ClipboardList size={14} /> : <FileDown size={14} />}{kind === 'logcat' ? "Android logs (Logcat)" : "Bug report"}<ActionIndicator /></HintButton>)}</>
}
export function AndroidDiagnosticsDialog() {
  const view = useAndroidDiagnosticsStore(s => s.view)
  return view ? <DiagnosticDialog key={`${view.kind}:${view.target.id}:${view.target.transportId}`} view={view} /> : null
}
function DiagnosticDialog({ view }: { view: NonNullable<ReturnType<typeof useAndroidDiagnosticsStore.getState>['view']> }) {
  const state = useAndroidDiagnosticsStore(), devices = useConnectionStore(s => s.devices)
  const [buffer, setBuffer] = useState<LogBuffer>('default'), [query, setQuery] = useState(''), [severity, setSeverity] = useState('all'), [page, setPage] = useState(0), [saving, setSaving] = useState(false)
  const connected = devices.some(d => d.status === 'connected' && sameDiagnosticTarget(d, view.target))
  const job = state.job?.kind === view.kind && sameDiagnosticTarget(state.job.target, view.target) ? state.job : null
  const running = job?.status === 'running', busy = state.pending || state.job?.status === 'running'
  const log = sameDiagnosticTarget(state.logcat?.target, view.target) ? state.logcat : null
  const rows = useMemo(() => (log?.lines || []).filter(line => (severity === 'all' || (severity === 'errors' ? ['E', 'F'].includes(line.level) : ['W', 'E', 'F'].includes(line.level))) && `${line.message} ${line.tag} ${line.pid}`.toLowerCase().includes(query.toLowerCase())), [log, severity, query])
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / 100) - 1))
  return <BadgeDialog title={view.kind === 'logcat' ? "Android logs · Logcat" : "Android bug report"} close={() => useAndroidDiagnosticsStore.setState({ view: null })}>
    <div className="android-diagnostic"><p>{view.name} · {view.target.serial}</p>
      {view.kind === 'logcat' ? <>
        <p className="component-description">Read up to 2,000 recent records. This is a snapshot; Refresh reads again. Android logs can contain personal information.</p>
        <div className="diagnostic-tools"><label>{"Buffer "}<select aria-label="Log buffer" value={buffer} disabled={busy} onChange={e => setBuffer(e.target.value as LogBuffer)}><option value="default">Application, system and crash</option><option value="crash">Crashes only</option></select></label><button className="button primary" disabled={busy || !connected} onClick={() => { setPage(0); void state.start('logcat', view.target, buffer) }}>{log ? "Refresh logs" : "Read logs"}</button></div>
        {log && <><p className="monitor-note">{"Read "}{new Date(log.capturedAt).toLocaleString('en-US')} · {log.buffer === 'crash' ? "Crash buffer" : "Application, system and crash buffers"} · {log.lines.length}{" records. Older records may have been overwritten by Android or excluded by the limit."}</p>
          <div className="diagnostic-tools"><input aria-label="Search Android logs" placeholder="Message, tag or PID…" value={query} onChange={e => { setQuery(e.target.value); setPage(0) }} /><select aria-label="Log severity" value={severity} onChange={e => { setSeverity(e.target.value); setPage(0) }}><option value="all">All levels</option><option value="warnings">Warnings and errors</option><option value="errors">Errors and fatal</option></select></div>
          <div className="android-log-lines" aria-label="Android log entries">{rows.slice(currentPage * 100, (currentPage + 1) * 100).map((line, index) => <div key={index} className={`android-log-line ${['E', 'F'].includes(line.level) ? 'log-error' : ''}`}><code>{line.time} {line.level || '·'} {line.pid && `PID ${line.pid}`} {line.tag}</code><pre>{line.message}</pre></div>)}{!rows.length && <p>{log.lines.length ? "No matching records." : "Android returned no records in this buffer."}</p>}</div>
          <div className="diagnostic-tools"><button className="button secondary" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Previous</button><span>{rows.length}{" records · Page "}{currentPage + 1} / {Math.max(1, Math.ceil(rows.length / 100))}</span><button className="button secondary" disabled={(currentPage + 1) * 100 >= rows.length} onClick={() => setPage(currentPage + 1)}>Next</button><button className="button secondary" disabled={saving || busy} onClick={async () => { setSaving(true); try { await requestBackend({ type: 'androidDiagnostics.exportLog', capturedAt: log.capturedAt }, error => useAndroidDiagnosticsStore.setState({ error, errorKind: view.kind, errorTarget: view.target })) } finally { setSaving(false) } }}>Save full snapshot…</button></div></>}
      </> : <><p>Save Android’s full diagnostic report as a ZIP archive on this computer.</p><p className="component-description">Includes system logs and device information and may contain personal data. Nothing is uploaded. Collection can take several minutes. Cancelling stops ADB Vault’s collection; Android may continue generating the report on the phone.</p><div className="diagnostic-tools"><button className="button primary" disabled={busy || !connected} onClick={() => void state.start('bugreport', view.target)}>Save bug report…</button>{job?.status === 'success' && job.output && <button className="button secondary" onClick={() => void requestBackend({ type: 'androidDiagnostics.reveal', jobId: job.id })}>Show saved report</button>}</div></>}
      {!connected && <p className="operation-error">This connection is no longer available. Reopen the action from the phone’s current connection.</p>}
      {state.error && state.errorKind === view.kind && sameDiagnosticTarget(state.errorTarget || undefined, view.target) && <p role="alert" className="operation-error">{state.error}</p>}
      {job && <div className={`android-diagnostic-status ${job.status === 'error' ? 'operation-error' : ''}`} role={job.status === 'error' ? 'alert' : 'status'}><strong>{job.status === 'running' ? "Collecting" : job.status === 'success' ? "Completed" : job.status === 'cancelled' ? "Cancelled" : "Collection failed"}</strong><p>{job.message}</p>{running && <button className="button secondary" onClick={() => void state.cancel()}>Cancel collection</button>}</div>}
      {busy && !running && <p>Another Android diagnostic collection is running.</p>}
    </div>
  </BadgeDialog>
}
