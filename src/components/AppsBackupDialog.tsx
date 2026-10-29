import { t as localeText } from '../lib/i18n'
import { t as translateUi } from '../lib/i18n'
import { message } from "../lib/i18n"
import { t } from "../lib/i18n"
import { useRestoreBusy, useRestoreStore } from '../store/useRestoreStore'
import { useState } from 'react'
import { AppWindow, Archive, CircleAlert, Download, FileCode2, Folder, LockKeyhole, ShieldAlert, X } from 'lucide-react'
import './apps-backup-dialog.css'
import { OperationChip } from './operation-chip/OperationChip'
import { OperationResultsFilter } from './OperationResultsFilter'
import { failureReasonLabel, isFailedResult, prioritizeFailedResults } from '../lib/operationResults'

import { useDetectDeviceRoot } from './DeviceRootStatus'
import { BadgeDialog } from './BadgeDialog'

import { useBackupStore } from '../store/useBackupStore'

import { useAppsStore } from '../store/useAppsStore'

import { useConnectionStore } from '../store/useConnectionStore'

import { useAppActionsStore } from '../store/useAppActionsStore'

import { requestBackend } from '../lib/backend'
import { backupParts, defaultBackupContents, type BackupContents, type PresetPreview } from '../../electron/app-backup-protocol'
import { PresetImportPreview } from './PresetImportPreview'
import { useAppStore } from '../store/useAppStore'

export function AppsBackupDialog() {

  const dialog = useBackupStore(s => s.dialog)

  return dialog ? <BackupDialogContent key={`${dialog.purpose}:${dialog.id}:${dialog.userId}:${dialog.packages.join(',')}`} context={dialog} /> : null

}

function BackupDialogContent({ context }: { context: NonNullable<ReturnType<typeof useBackupStore.getState>['dialog']> }) {

  const { state, destination, close } = useBackupStore()
  const activityId = useAppStore(store => store.activity.find(entry => entry.operation?.key === state?.operationId || entry.diagnostic?.operationId === state?.operationId)?.id)

  const apps = useAppsStore(), connection = useConnectionStore()

  const actionBusy = useAppActionsStore(s => s.action?.status === 'running')

  const [mode, setMode] = useState<'setup' | 'result' | 'import'>(state?.status === 'running' ? 'result' : 'setup')
  const [resultFilter, setResultFilter] = useState({ key: '', onlyFailed: false })
  const resultKey = `${state?.operationId}:${state?.startedAt}:${state?.id}:${state?.userId}`
  const errorCount = state?.items.filter(isFailedResult).length || 0
  const onlyFailed = resultFilter.key === resultKey && resultFilter.onlyFailed && errorCount > 0
  const filterResults = (value: boolean) => setResultFilter({ key: resultKey, onlyFailed: value })
  const [importPreview, setImportPreview] = useState<PresetPreview | null>(null)

  const [name, setName] = useState(context.name), [waiting, setWaiting] = useState(false)

  const [format, setFormat] = useState<'auto' | 'apk' | 'apks' | 'preset'>(context.purpose === 'preset' || (state?.status === 'running' && state.operation === 'preset') ? 'preset' : state?.status === 'running' && (state.format === 'apk' || state.format === 'apks') ? state.format : 'auto')

  const [zip, setZip] = useState(state?.status === 'running' && !!state.zip)

  const [contents, setContents] = useState<BackupContents>(state?.status === 'running' ? state.contents || defaultBackupContents() : defaultBackupContents())
  const [stopApps, setStopApps] = useState(false), [allowPartial, setAllowPartial] = useState(false)
  const extraData = backupParts.some(k => k !== 'apk' && contents[k])
  const rootPossible = connection.devices.find(d => d.id === context.id)?.root?.status !== 'not-detected'
  const contentsValid = backupParts.some(k => contents[k]) && (!extraData || stopApps) && (!(contents.data || contents.cache) || (!!apps.options.root && rootPossible))
  const partLabels = { apk: 'APK / APKS', data: translateUi("App data (internal + external)"), cache: t("Cache + code cache"), obb: 'OBB', media: t("Media") }

  const presetOnly = format === 'preset'

  const [packages, setPackages] = useState(context.packages)

  const [scope, setScope] = useState(context.scope)

  const hidden = scope && context.scopes ? context.scopes[scope].hidden : packages === context.packages ? context.hidden : 0

  const [error, setError] = useState<string | null>(null)

  const device = connection.devices.find(d => d.id === context.id), profile = apps.profiles.find(p => p.id === context.userId)

  const sameContext = apps.deviceId === context.id && apps.userId === context.userId && apps.status === 'ready' && connection.activeDeviceId === context.id && device?.status === 'connected'

  const busy = state?.status === 'running'
  const progressLabel = (state?.operation === 'preset' || (waiting && presetOnly)) ? busy || waiting ? t("Saving preset") : state?.status === 'complete' ? t("Preset saved") : t("Preset not saved") : busy && state.phase === 'archiving' ? t("Creating ZIP archive") : busy ? state.items.find(item => item.status === 'running')?.label || t("Preparing backup") : waiting ? t("Preparing backup") : state?.status === 'complete' ? t("Backup complete") : state?.status === 'partial' ? t("Backup finished with errors") : state?.status === 'cancelled' ? t("Backup cancelled") : t("Backup could not finish")
  const progressStatus = busy || waiting ? 'running' : state?.status === 'complete' ? 'success' : state?.status || 'error'
  const measured = state?.operation === 'backup' && !state.phase && state.total > 0

  const restoring = useRestoreBusy()
  const blocked = restoring || !sameContext || actionBusy || apps.badgeRead?.status === 'running' || busy || waiting
  useDetectDeviceRoot(device, blocked || presetOnly || mode !== 'setup')

  async function save() {

    filterResults(false); setError(null); setMode('result'); useBackupStore.setState({ state: null }); setWaiting(true)

    const ok = await requestBackend({ type: presetOnly ? 'apps.savePreset' : 'apps.backup', selection: { id: context.id, userId: context.userId, ...(presetOnly ? { name: name.trim() } : { folderName: name.trim() || context.name }), format: presetOnly ? 'auto' : format, ...(!presetOnly ? { contents, stopApps, allowPartial } : {}), ...(!presetOnly && zip ? { zip: true } : {}), packages } }, setError)

    setWaiting(false)

    if (!ok) setMode('setup')

  }

  const failed = state?.items.filter(item => item.status === 'error' || item.status === 'cancelled').map(item => item.packageName) || []

  async function loadPreset() {
    if (blocked) return
    setError(null); setWaiting(true)
    const previousToken = useBackupStore.getState().preview?.token
    try {
      const ok = await requestBackend({ type: 'apps.loadPreset', id: context.id, userId: context.userId }, setError)
      const preview = useBackupStore.getState().preview
      if (ok && preview && preview.token !== previousToken && preview.id === context.id && preview.userId === context.userId) {
        setImportPreview(preview); setMode('import')
      }
    } finally { setWaiting(false) }
  }

  const resultActions = state && <>
    {state.operationId && activityId !== undefined && (errorCount > 0 || state.status === 'error' || state.status === 'partial') && <button className="button secondary" onClick={() => {
      const store = useAppStore.getState()
      close(); store.openActivity(activityId); store.setSidebar('right', 'expanded')
    }}>{t("Show in Activity")}</button>}
    {busy && <button className="button secondary" onClick={() => void requestBackend({ type: 'apps.cancelBackup' })}>{t("Cancel backup")}</button>}
    {state.outputDirectory && <button className="button secondary" onClick={() => void requestBackend({ type: 'apps.openBackup' })}>{t("Open folder")}</button>}
    {!busy && failed.length > 0 && <button className="button secondary" disabled={!sameContext || state.id !== context.id || state.userId !== context.userId || actionBusy} onClick={() => {
      setScope(undefined); setPackages(failed); setName(state.name); setZip(!!state.zip)
      setContents(state.contents || defaultBackupContents()); setStopApps(false); setAllowPartial(!!state.allowPartial)
      setFormat(state.operation === 'preset' ? 'preset' : state.format === 'apk' || state.format === 'apks' ? state.format : 'auto')
      setMode('setup')
    }}>{t("Retry failed / cancelled…")}</button>}
    {!busy && <button className="button secondary" onClick={() => setMode('setup')}>{t("Back")}</button>}
  </>

  return <BadgeDialog title={mode === 'import' ? t("Import preset") : t("Export applications")} close={close} className={`app-backup-dialog backup-mode-${mode}`} heading={<header className="export-dialog-heading"><span className="export-dialog-symbol">{mode === 'import' || presetOnly ? <FileCode2 size={23} /> : <Download size={23} />}</span><div><h2 id="badge-dialog-title">{mode === 'import' ? t("Import preset") : t("Export applications")}</h2><p>{mode === 'import' ? t("Review the saved application selection.") : mode === 'result' ? t("Progress and results for this export.") : presetOnly ? t("Save an application selection to use later.") : t("Choose what to save from this phone.")}</p></div><button className="export-dialog-close" aria-label={localeText("Close export window")} onClick={close}><X size={18} /></button></header>} footer={mode === 'setup' ? <><button className="button primary" disabled={blocked || !packages.length || (presetOnly ? !name.trim() : !contentsValid)} onClick={() => void save()}>{localeText("Export…")}</button><button className="button secondary" disabled={blocked} onClick={() => void loadPreset()}>{waiting ? t("Reading preset…") : t("Import preset…")}</button><button className="button secondary" disabled={blocked} onClick={() => { close(); useRestoreStore.getState().open() }}>{localeText("Restore…")}</button></> : mode === 'result' ? resultActions : undefined}>

    <dl className="export-context"><div><dt>{t("Device")}</dt><dd>{device?.name || context.id}</dd></div><div><dt>{t("Profile")}</dt><dd>{profile?.name || t("Profile")}{t(" · ID ")}{context.userId}</dd></div></dl>

    {error && <p role="alert">{message(error)}</p>}

    {!sameContext && <p role="alert">{t("The selected device/profile is no longer active. Completed copies are kept.")}</p>}

    {mode === 'setup' && <div className="export-setup">
      <div className="export-settings" role="region" aria-label={t("Export settings")} tabIndex={0}>
        {presetOnly && scope && context.scopes && <fieldset className="backup-scope"><legend>{t("Save from")}</legend>{(['current', 'marked'] as const).map(value => <label key={value}><input type="radio" name="backup-scope" checked={scope === value} disabled={blocked} onChange={() => {
          const next = context.scopes![value]; setScope(value); setPackages(next.packages); setName(next.name); setError(null)
        }} />{value === 'current' ? t("Current filtered list") : t("Checked applications")} ({context.scopes![value].packages.length})</label>)}</fieldset>}

        <section className="export-options" aria-labelledby="export-options-title">
          <h3 id="export-options-title">{presetOnly ? t("Preset options") : t("Export options")}</h3>
          <div className="backup-form">
            <label>{presetOnly ? t("Preset name") : zip ? t("Archive name") : t("Folder name")}<input aria-label={presetOnly ? t("Preset name") : zip ? t("Archive name") : t("Folder name")} placeholder={context.name} maxLength={80} value={name} onChange={event => setName(event.target.value)} disabled={blocked} /></label>
            <label>{t("Export format")}<select aria-label={t("Export format")} aria-describedby="export-format-description" value={format} disabled={blocked} onChange={event => setFormat(event.target.value as typeof format)}><option value="auto">{t("Auto · APK + APKS")}</option><option value="apk">{t("APK · Single APK only")}</option><option value="apks">{t("APKS · Split APK only")}</option><option value="preset">{t("Preset · JSON")}</option></select></label>
          </div>
          <p id="export-format-description" className="export-hint">{presetOnly ? t("A fixed package list as JSON. No APK files, app data or cache are copied.") : !contents.apk ? t("No APK files will be copied. Selected app folders are saved as .tar archives.") : format === 'auto' ? t("Single APK → App name.apk. Split APK → App name.apks.") : format === 'apk' ? t("Single APK applications only. Split applications are skipped; base.apk is never saved separately.") : t("Split applications only, with all APK parts in App name.apks. Single APK applications are skipped.")}</p>
          {!presetOnly && <label className="export-zip"><input type="checkbox" checked={zip} disabled={blocked} onChange={event => setZip(event.target.checked)} /><Archive size={15} aria-hidden="true" />{t("Pack into ZIP")}</label>}
        </section>

        {!presetOnly && <fieldset className="export-contents"><legend>{t("Include in backup")}</legend><div className="export-parts">{backupParts.map(key => {
          const privatePart = key === 'data' || key === 'cache'
          const unavailable = privatePart && (!apps.options.root || !rootPossible)
          return <label key={key} className={`export-part${contents[key] ? " selected" : ''}${unavailable ? " unavailable" : ''}`}>
            <input type="checkbox" aria-label={partLabels[key]} aria-describedby={`export-part-${key}${privatePart ? t(" export-root-note") : ''}`} checked={contents[key]} disabled={blocked || (unavailable && !contents[key])} onChange={event => setContents({ ...contents, [key]: event.target.checked })} />
            <span><strong>{partLabels[key]}</strong><small id={`export-part-${key}`}>{({ apk: t("Installation files"), data: translateUi("Settings, databases and app files"), cache: t("Temporary files, saved separately"), obb: t("Downloaded game assets"), media: t("App photos, recordings and downloads") })[key]}</small></span>
            {privatePart && <span className="export-root-tag" title={unavailable ? !rootPossible ? t("Root was not detected on this phone.") : t("Enable root in Settings → Apps.") : t("Requires root access on the phone.")}><LockKeyhole size={11} aria-hidden="true" />{t("Root")}</span>}
          </label>
        })}</div></fieldset>}

        {!presetOnly && <p id="export-root-note" className="export-access-note"><LockKeyhole size={14} aria-hidden="true" /><span>{!rootPossible ? t("Root was not detected. App data and cache require root on the phone.") : !apps.options.root ? t("App data and cache require root on the phone. Enable root in Settings → Apps to select them.") : t("Access is checked when you export; the phone may ask you to allow Shell/ADB.")}</span></p>}

        {!presetOnly && extraData && <section className="export-file-options" aria-labelledby="export-file-options-title">
          <h3 id="export-file-options-title">{t("Before copying files")}</h3>
          {packages.some(pkg => apps.apps.find(app => app.packageName === pkg)?.system) && <p className="export-warning" role="alert"><ShieldAlert size={16} aria-hidden="true" /><span>{t("System applications are selected. Stopping them can temporarily affect device functions.")}</span></p>}
          <label><input type="checkbox" checked={stopApps} disabled={blocked} onChange={event => setStopApps(event.target.checked)} />{t("Stop selected apps before copying their files (required)")}</label>
          <p className="export-hint">{t("Apps remain stopped after copying. Saved data archives are not encrypted.")}</p>
          <label><input type="checkbox" checked={allowPartial} disabled={blocked} onChange={event => setAllowPartial(event.target.checked)} />{t("Keep copying available components if another component fails")}</label>
        </section>}

        <details className="export-details"><summary>{presetOnly ? t("About presets") : t("Backup details")}</summary>
          {presetOnly ? <p>{t("A preset stores a fixed list of packages, not a live filter. Existing presets are kept; duplicate names get a suffix.")}</p> : <>
            <p>{zip ? t("The ZIP contains the selected backup files and one report.") : t("Backup files are saved in the device / profile / folder name directory, with one report per backup.")}{t(" Existing files are kept; duplicate names get a suffix.")}</p>
            <p>{t("APKS uses the SAI archive layout. APK-only backups do not include app data.")}</p>
            {!rootPossible && <p>{t("If root is hidden or was just enabled, recheck it in Connection → Actions.")}</p>}
            {extraData && <><p>{t("Core Android UIDs and shared-UID apps are not supported for data backup yet. Data excludes cache; select Cache separately. External folders use primary emulated storage only, not removable SD cards or shared DCIM/Downloads.")}</p><p>{t("Data, cache, OBB and media are saved as separate .tar files. Hardware-bound Android KeyStore credentials are not included; restoring app files may still require signing in again.")}</p></>}
          </>}
        </details>
        {state?.operation === (presetOnly ? 'preset' : 'backup') && <button className="text-button export-last-result" onClick={() => setMode('result')}>{t("View last result")}</button>}
      </div>

      <aside className="export-selection" aria-label={t("Export selection and destination")}>
        <div className="export-selection-heading"><h3>{t("Applications")}</h3><span>{packages.length}</span></div>
        <p className="export-selection-count">{packages.length}{t(" selected ")}{packages.length === 1 ? t("application") : t("applications")}{hidden > 0 ? t(" · {0} hidden by filters are included", [hidden]) : ''}</p>
        {scope === 'current' && <p className="export-hint">{t("All results of the current filters and search are included, including rows outside the visible area. Table checkboxes are not changed.")}</p>}
        <ul className="export-application-list" aria-label={t("Applications to save")} tabIndex={packages.length > 4 ? 0 : undefined}>{packages.map(pkg => {
          const app = apps.apps.find(a => a.packageName === pkg)
          return <li key={pkg}><span className="export-app-icon">{app?.iconPng ? <img src={`data:image/png;base64,${app.iconPng}`} alt="" loading="lazy" /> : <AppWindow size={24} aria-hidden="true" />}</span><div><strong title={app?.label || pkg}>{app?.label || pkg}</strong><code title={pkg}>{pkg}</code></div></li>
        })}</ul>
        <section className="export-destination" aria-labelledby="export-destination-title"><h3 id="export-destination-title"><Folder size={15} aria-hidden="true" />{t("Destination")}</h3><code>{destination.mode === 'fixed' ? destination.folder : t("Choose folder when exporting")}</code><p>{presetOnly ? t("Device / profile / preset name.json") : zip ? t("Device / profile / archive name.zip") : t("Device / profile / folder name")}</p><small>{t("Change in Settings → Apps.")}</small></section>
      </aside>
    </div>}

    {mode === 'import' && importPreview && <PresetImportPreview key={importPreview.token} preview={importPreview} blocked={blocked} back={() => { setMode('setup'); setImportPreview(null) }} applied={() => { close(); useAppStore.getState().notify("Selection restored from preset.", 4000) }} />}

    {mode === 'result' && <>

      <div className="backup-progress-card" aria-live="polite">
        <OperationChip layout="panel" label={progressLabel} status={progressStatus} statusText={busy || waiting ? t("Running") : progressLabel}
          progress={measured ? state.completed / state.total * 100 : undefined} progressLabel={localeText("Backup progress")}
          measurement={measured ? `${state.completed} / ${state.total} applications · ${Math.min(100, Math.floor(state.completed / state.total * 100))}%` : undefined}
          startedAt={state?.startedAt ? Date.parse(state.startedAt) : undefined} icon={<Download />} />
        <p role="status">{state?.message || t("Choose a destination to continue.")}</p>
        {state && state.operation !== 'preset' && <div className="backup-progress-summary"><span>{state.items.filter(item => item.artifacts ? item.artifacts.length > 0 : item.status === 'success').length}{t(" with saved files")}</span>{state.items.some(item => item.status === 'skipped') && <span>{state.items.filter(item => item.status === 'skipped').length}{t(" skipped")}</span>}{errorCount > 0 && <button className="text-button result-failure-toggle" aria-pressed={onlyFailed} onClick={() => filterResults(!onlyFailed)} title={t("Show failed applications and their reasons")}><CircleAlert size={14} aria-hidden="true" />{errorCount}{t(" failed")}</button>}<span>{state.total}{t(" applications in this backup")}</span></div>}
      </div>
      {state && <>
        {state.archivePath && <code className="backup-path">{t("ZIP: ")}{state.archivePath}</code>}
        {state.presetPath && <code className="backup-path">{t("Preset: ")}{state.presetPath}</code>}

        <div className="backup-results-heading"><h3>{t("Applications")}</h3><OperationResultsFilter total={state.items.length} failed={errorCount} onlyFailed={onlyFailed} onChange={filterResults} /></div><ul className="backup-items backup-results" aria-label={t("Backup results")}>{prioritizeFailedResults(state.items, onlyFailed).map(item => <li key={item.packageName} className={isFailedResult(item) ? 'result-failure-row' : undefined}><strong>{item.label}</strong><code>{item.packageName}</code><span className={`backup-result-status ${item.status}`}>{failureReasonLabel(item) || ({ pending: t("Waiting"), running: t("In progress"), success: state.operation === 'preset' ? t("Included") : t("Saved"), skipped: t("Skipped"), error: t("Failed"), cancelled: t("Cancelled") })[item.status]}</span>{item.message && <p className={item.status === 'error' ? 'backup-result-error' : 'backup-result-note'}>{message(item.message)}</p>}{item.parts?.map(part => <p key={part.component} className={part.status === 'error' ? 'backup-result-error' : 'backup-result-note'}>{t(partLabels[part.component])}: {t(part.status)}{part.message ? ` - ${message(part.message)}` : ''}</p>)}</li>)}</ul>
      </>}

      {busy && state?.operation !== 'preset' && <p className="backup-note">{t("Closing this window keeps the export running. Cancel stops remaining work; completed copies are retained as files if ZIP packaging has not finished.")}</p>}

    </>}

  </BadgeDialog>

}

