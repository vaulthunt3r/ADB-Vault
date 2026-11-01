import { useState } from 'react'
import { BadgeDialog } from './BadgeDialog'
import { OperationChip } from './operation-chip/OperationChip'
import { useRestoreBusy, useRestoreStore } from '../store/useRestoreStore'
import { useAppsStore } from '../store/useAppsStore'
import { useConnectionStore } from '../store/useConnectionStore'
import { useBackupStore } from '../store/useBackupStore'
import { useAppActionsStore } from '../store/useAppActionsStore'
import { requestBackend } from '../lib/backend'
import type { BackendRequest } from '../../electron/contracts'
import { AppsBatchRestore, BatchRestoreResults } from './AppsBatchRestore'
import { RestoreHelp } from './RestoreHelp'
import { AppsProfilePicker } from './AppsProfilePicker'
import { cancelFilePreparation, openFileInstallation } from '../lib/fileInstall'

export function AppsRestoreDialog() {
  const visible = useRestoreStore(s => s.visible)
  return visible ? <RestoreContent /> : null
}
function RestoreContent() {
  const { state: currentState, close, mode, fileSelection, filePreparing, fileError } = useRestoreStore(), busy = useRestoreBusy()
  const installing = mode === 'install'
  const state = !filePreparing && !fileError && (currentState?.sourceKind === 'install') === installing ? currentState : null
  const apps = useAppsStore(), connection = useConnectionStore()
  const backupBusy = useBackupStore(s => s.state?.status === 'running'), actionBusy = useAppActionsStore(s => s.action?.status === 'running')
  const [waiting, setWaiting] = useState(false), [error, setError] = useState(''), [opened, setOpened] = useState(0)
  const device = connection.devices.find(d => d.id === (filePreparing ? connection.activeDeviceId : apps.deviceId))
  const ready = !!window.desktop && !!device && device.status === 'connected' && connection.activeDeviceId === device.id && apps.status === 'ready' && apps.userId !== null
  const blocked = !ready || busy || waiting || backupBusy || actionBusy || connection.busy || apps.badgeRead?.status === 'running'
  const sameContext = !!state && state.id === device?.id && state.userId === apps.userId
  async function request(value: BackendRequest) { setWaiting(true); setError(''); try { await requestBackend(value, setError) } finally { setWaiting(false) } }
  return <BadgeDialog title={installing ? "Install applications" : "Restore application"} close={close} className="app-backup-dialog app-restore-dialog" footer={<>
    <button className="button secondary" disabled={blocked} onClick={() => { setOpened(v => v + 1); if (installing && fileSelection) void openFileInstallation(fileSelection); else void request({ type: installing ? 'apps.installOpen' : 'apps.restoreOpen', id: apps.deviceId!, userId: apps.userId! }) }}>{installing ? fileSelection ? "Check selected files…" : "Choose files…" : "Open backup…"}</button>
  </>}>
    <div className="restore-context-row"><p className="backup-context">{"Destination: "}{device?.name || "No connected device"} · {apps.profiles.find(p => p.id === apps.userId)?.name || "Profile"}{" · ID "}{apps.userId ?? '—'}</p><RestoreHelp installing={installing} /></div>
    {installing && fileSelection && apps.deviceId === device?.id && <AppsProfilePicker deviceId={apps.deviceId} />}
    {filePreparing && <div className="apps-action-result" role="status"><OperationChip layout="panel" label="Preparing installation files" message={apps.status === 'loading' ? "Reading the destination profile…" : currentState?.sourceKind === 'install' && currentState.status === 'opening' ? currentState.message : "Preparing selected installation files…"} /><button className="button secondary" onClick={cancelFilePreparation}>Cancel preparation</button></div>}
    {fileError && <p role="alert">{fileError}</p>}
    {error && <p role="alert">{error}</p>}
    {state && state.status !== 'choosing' && <div className={`apps-action-result ${state.status}`} role={['error', 'partial'].includes(state.status) ? 'alert' : 'status'} aria-live="polite">{state.packageName && <strong>{state.applications.find(a => a.packageName === state.packageName)?.label || state.packageName}</strong>}{!busy && <p>{state.message}</p>}{state.recoveryPaths?.map(p => <code className="restore-source" key={p}>{p}</code>)}
      {busy && !state.batch && <OperationChip layout="panel" label={state.status === 'installing' ? "Installing application" : state.status === 'restoring' ? "Restoring application data" : installing ? "Checking installation files" : "Opening backup"} message={state.message} startedAt={state.startedAt ? Date.parse(state.startedAt) : undefined} />}
      {state.batch && <BatchRestoreResults state={state} busy={busy || waiting} retryDisabled={blocked || !sameContext} retry={() => void request({ type: 'apps.restoreRetry' })} />}
      {['verifying', 'opening'].includes(state.status) && <button className="button secondary" onClick={() => void requestBackend({ type: 'apps.restoreCancel' })}>Cancel verification</button>}
    </div>}
    {state?.source && <>
      {!installing && <><dl className="restore-metadata"><dt>Source device</dt><dd>{state.sourceDevice}</dd><dt>Source profile</dt><dd>{state.sourceProfile}</dd><dt>Saved</dt><dd>{state.createdAt ? new Date(state.createdAt).toLocaleString('en-US') : '—'}</dd></dl>
      <code className="restore-source">{state.source}</code></>}
      <AppsBatchRestore key={`${state.source}:${opened}`} state={state} blocked={blocked || !sameContext} privateAllowed={!!apps.options.root && device?.root?.status !== 'not-detected'} start={plan => void request({ type: 'apps.restoreBatch', plan })} />
      {!sameContext && <p role="alert">{"The device or profile changed. "}{installing ? "Choose the files again" : "Open this backup again"}{" for the current destination."}</p>}
    </>}
    {!state?.source && !busy && !fileError && <p className="backup-note">{installing ? "Choose one or several APK/APKS files to begin." : "Choose a backup JSON or ZIP to begin."}</p>}
  </BadgeDialog>
}
