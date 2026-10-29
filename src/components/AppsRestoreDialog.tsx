import { locale as uiLocale } from '../lib/i18n'
import { message } from "../lib/i18n"
import { t } from "../lib/i18n"
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
  return <BadgeDialog title={installing ? t("Install applications") : t("Restore application")} close={close} className="app-backup-dialog app-restore-dialog" footer={<>
    <button className="button secondary" disabled={blocked} onClick={() => { setOpened(v => v + 1); if (installing && fileSelection) void openFileInstallation(fileSelection); else void request({ type: installing ? 'apps.installOpen' : 'apps.restoreOpen', id: apps.deviceId!, userId: apps.userId! }) }}>{installing ? fileSelection ? t("Check selected files…") : t("Choose files…") : t("Open backup…")}</button>
  </>}>
    <div className="restore-context-row"><p className="backup-context">{t("Destination: ")}{device?.name || t("No connected device")} · {apps.profiles.find(p => p.id === apps.userId)?.name || t("Profile")}{t(" · ID ")}{apps.userId ?? '—'}</p><RestoreHelp installing={installing} /></div>
    {installing && fileSelection && apps.deviceId === device?.id && <AppsProfilePicker deviceId={apps.deviceId} />}
    {filePreparing && <div className="apps-action-result" role="status"><OperationChip layout="panel" label={t("Preparing installation files")} message={apps.status === 'loading' ? t("Reading the destination profile…") : currentState?.sourceKind === 'install' && currentState.status === 'opening' ? message(currentState.message) : t("Preparing selected installation files…")} /><button className="button secondary" onClick={cancelFilePreparation}>{t("Cancel preparation")}</button></div>}
    {fileError && <p role="alert">{fileError}</p>}
    {error && <p role="alert">{message(error)}</p>}
    {state && state.status !== 'choosing' && <div className={`apps-action-result ${state.status}`} role={['error', 'partial'].includes(state.status) ? 'alert' : 'status'} aria-live="polite">{state.packageName && <strong>{state.applications.find(a => a.packageName === state.packageName)?.label || state.packageName}</strong>}{!busy && <p>{message(state.message)}</p>}{state.recoveryPaths?.map(p => <code className="restore-source" key={p}>{p}</code>)}
      {busy && !state.batch && <OperationChip layout="panel" label={state.status === 'installing' ? t("Installing application") : state.status === 'restoring' ? t("Restoring application data") : installing ? t("Checking installation files") : t("Opening backup")} message={message(state.message)} startedAt={state.startedAt ? Date.parse(state.startedAt) : undefined} />}
      {state.batch && <BatchRestoreResults state={state} busy={busy || waiting} retryDisabled={blocked || !sameContext} retry={() => void request({ type: 'apps.restoreRetry' })} />}
      {['verifying', 'opening'].includes(state.status) && <button className="button secondary" onClick={() => void requestBackend({ type: 'apps.restoreCancel' })}>{t("Cancel verification")}</button>}
    </div>}
    {state?.source && <>
      {!installing && <><dl className="restore-metadata"><dt>{t("Source device")}</dt><dd>{state.sourceDevice}</dd><dt>{t("Source profile")}</dt><dd>{state.sourceProfile}</dd><dt>{t("Saved")}</dt><dd>{state.createdAt ? new Date(state.createdAt).toLocaleString(uiLocale()) : '—'}</dd></dl>
      <code className="restore-source">{state.source}</code></>}
      <AppsBatchRestore key={`${state.source}:${opened}`} state={state} blocked={blocked || !sameContext} privateAllowed={!!apps.options.root && device?.root?.status !== 'not-detected'} start={plan => void request({ type: 'apps.restoreBatch', plan })} />
      {!sameContext && <p role="alert">{t("The device or profile changed. ")}{installing ? t("Choose the files again") : t("Open this backup again")}{t(" for the current destination.")}</p>}
    </>}
    {!state?.source && !busy && !fileError && <p className="backup-note">{installing ? t("Choose one or several APK/APKS files to begin.") : t("Choose a backup JSON or ZIP to begin.")}</p>}
  </BadgeDialog>
}
