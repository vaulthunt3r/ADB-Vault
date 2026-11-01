import { useState } from 'react'
import type { BackupPart } from '../../electron/app-backup-protocol'
import { canRetryRestore, type RestoreState, type RestoreBatchRequest } from '../../electron/app-restore-protocol'
import { Download } from 'lucide-react'
import { OperationChip } from './operation-chip/OperationChip'
import { requestBackend } from '../lib/backend'

const labels: Record<BackupPart, string> = { apk: 'Application files (APK / APKS)', data: 'App data', cache: "Cache", obb: 'OBB', media: "Media" }
export function AppsBatchRestore({ state, blocked, privateAllowed, start }: { state: RestoreState; blocked: boolean; privateAllowed: boolean; start: (selection: RestoreBatchRequest) => void }) {
  const installing = state.sourceKind === 'install', verb = installing ? "Install" : "Restore"
  const [packages, setPackages] = useState<string[]>(state.batch?.items.map(i => i.packageName) || (installing ? state.applications.map(a => a.packageName) : []))
  const [components, setComponents] = useState<BackupPart[]>(state.batch ? [...new Set(state.batch.items.flatMap(i => i.components))] : ['apk'])
  const applications = state.applications.filter(a => a.components.length)
  const available = (Object.keys(labels) as BackupPart[]).filter(p => applications.some(a => a.components.includes(p)))
  const apkOnly = available.length === 1 && available[0] === 'apk'
  const selectedParts: BackupPart[] = apkOnly ? ['apk'] : components.filter(p => available.includes(p))
  const chosen = applications.filter(a => packages.includes(a.packageName))
  const applicable = chosen.filter(a => a.components.some(p => selectedParts.includes(p)))
  const unavailable = chosen.some(a => a.components.some(p => selectedParts.includes(p) && (p === 'data' || p === 'cache') && !privateAllowed))
  return <div className="restore-batch-selection">
    {!apkOnly && available.length > 0 && <fieldset className="restore-components" disabled={blocked}><legend>What to restore</legend>
      {available.map(p => <label key={p}><input type="checkbox" checked={selectedParts.includes(p)} disabled={(p === 'data' || p === 'cache') && !privateAllowed} onChange={e => setComponents(e.target.checked ? [...components, p] : components.filter(c => c !== p))} />{labels[p]}{(p === 'data' || p === 'cache') && <small>Requires root on the phone</small>}</label>)}
    </fieldset>}
    <div className="restore-batch-heading"><strong>{"Applications · Selected "}{chosen.length}{" of "}{applications.length}</strong><button className="button secondary" disabled={blocked} onClick={() => setPackages(packages.length === applications.length ? [] : applications.map(a => a.packageName))}>{packages.length === applications.length ? "Clear selection" : "Select all"}</button></div>
    <div className="restore-batch-list" role="group" aria-label={installing ? "Applications to install" : "Applications to restore"}>{applications.map(a => {
      const parts = a.components.filter(p => selectedParts.includes(p)), missing = selectedParts.filter(p => !a.components.includes(p))
      return <label key={a.packageName}><input type="checkbox" aria-label={`${verb} ${a.label}`} checked={packages.includes(a.packageName)} disabled={blocked} onChange={e => setPackages(e.target.checked ? [...packages, a.packageName] : packages.filter(p => p !== a.packageName))} /><span><strong>{a.label}</strong><code>{a.packageName} · {a.versionName || a.versionCode}</code>{!apkOnly && <small>{parts.length ? parts.map(p => labels[p]).join(', ') : selectedParts.length ? "Will be skipped" : "No components selected"}</small>}{packages.includes(a.packageName) && missing.length > 0 && <small>{"Not in backup: "}{missing.map(p => labels[p]).join(', ')}</small>}</span></label>
    })}</div>
    {!applications.length && <p>No completed application copies in this backup.</p>}
    <div className="restore-selection-action"><button className="button primary" disabled={blocked || !applicable.length || !selectedParts.length || unavailable} onClick={() => start({ packages: chosen.map(a => a.packageName), components: selectedParts })}>{verb}{" selected ("}{chosen.length})…</button></div>
  </div>
}
export function BatchRestoreResults({ state, busy, retryDisabled, retry }: { state: RestoreState; busy: boolean; retryDisabled: boolean; retry: () => void }) {
  const batch = state.batch!
  const label = state.sourceKind === 'install' ? "Installing applications" : "Restoring applications"
  return <div className="restore-batch-results">
    {busy && <><OperationChip layout="panel" label={label} status={batch.stopRequested ? 'stopping' : 'running'} statusText={batch.stopRequested ? "Stopping after current application…" : "Running"}
      progress={batch.items.length > 0 ? batch.finished / batch.items.length * 100 : undefined} progressLabel={label}
      measurement={`${batch.finished} of ${batch.items.length} processed`} message={state.message}
      startedAt={state.startedAt ? Date.parse(state.startedAt) : undefined} icon={<Download />} />
      <button className="button secondary" disabled={batch.stopRequested} onClick={() => void requestBackend({ type: 'apps.restoreCancel' })}>{batch.stopRequested ? "Stopping after current application…" : "Stop after current application"}</button></>}
    <ul className="backup-results">{batch.items.map(i => <li key={i.packageName}><strong>{i.label}</strong><code>{i.packageName}</code><span className={`backup-result-status ${i.status}`}>{i.status}</span><p className="backup-result-note">{i.completed.length ? `Completed: ${i.completed.map(p => labels[p]).join(', ')}. ` : ''}{i.message}</p>{i.recoveryPaths?.map(p => <code className="restore-source" key={p}>{p}</code>)}{i.uncertain && <p className="backup-result-error">Check the application on the phone before trying again.</p>}</li>)}</ul>
    {!busy && batch.items.some(canRetryRestore) && <button className="button secondary" disabled={retryDisabled} onClick={retry}>Retry unfinished…</button>}
  </div>
}
