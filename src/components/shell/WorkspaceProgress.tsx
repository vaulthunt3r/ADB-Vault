import { message } from '../../lib/i18n'
import { t as localeText } from '../../lib/i18n'
import { t as translateUi } from '../../lib/i18n'
import { t } from "../../lib/i18n"
import { useAdbConsoleStore } from '../../store/useAdbConsoleStore'
import { useApkInspectorStore } from '../../store/useApkInspectorStore'
import { usePhoneToolsStore } from '../../store/usePhoneToolsStore'
import { phoneDataLabels } from '../../../electron/phone-tools-protocol'
import { useHistoryStore } from '../../store/useHistoryStore'
import { useMonitorStore } from '../../store/useMonitorStore'
import { useAndroidDiagnosticsStore } from '../../store/useAndroidDiagnosticsStore'
import { showFileSearch } from '../../lib/fileCategories'
import { useFileSearchStore } from '../../store/useFileSearchStore'
import { useFilesStore } from '../../store/useFilesStore'
import { fileActionLabel, fileTaskActive } from '../../../electron/files-protocol'
import { fileTaskStatus, fileTaskSummary, fileTaskMeasurement, transferText } from '../../lib/fileTaskProgress'
import { useRestoreBusy, useRestoreStore } from '../../store/useRestoreStore'
import { useEffect, useState, type ReactNode } from 'react'
import { Terminal, AppWindow, ArrowDownUp, Folder, Package, Smartphone, X } from 'lucide-react'
import { operationSummary } from '../../lib/activityOperation'
import { isFailedResult } from '../../lib/operationResults'
import { useBackupStore } from '../../store/useBackupStore'
import { useAppsStore } from '../../store/useAppsStore'
import { useAppStore } from '../../store/useAppStore'
import { useAppActionsStore } from '../../store/useAppActionsStore'
import { useConnectionStore } from '../../store/useConnectionStore'
import { BadgeDialog } from '../BadgeDialog'
import { OperationChip } from '../operation-chip/OperationChip'

interface Operation {
  id: string; label: string; message: string; completed?: number; total?: number; open: () => void
  unit?: 'bytes' | 'applications' | 'percent'; measure?: string; state?: string; stateText?: string; unknownText?: string
  runId?: string; startedAt?: string
}
function progressText(operation: Operation) {
  if (!(operation.total && operation.total > 0) || operation.completed === undefined) return undefined
  if (operation.unit === 'bytes') return `${operation.measure}: ${transferText(operation.completed, operation.total)}`
  const percent = Math.max(0, Math.min(100, Math.floor(operation.completed / operation.total * 100)))
  return operation.unit === 'percent' ? `${percent}%` : `${operation.measure ? operation.measure + ': ' : ''}${operation.completed} / ${operation.total}${operation.unit === 'applications' ? t(" applications") : t(" items")} · ${percent}%`
}
function ActiveOperation({ operation, observedAt, onOpen = operation.open, toolbar = false, trailing }: { operation: Operation; observedAt?: number; onOpen?: () => void; toolbar?: boolean; trailing?: ReactNode }) {
  const startedAt = operation.startedAt ? Date.parse(operation.startedAt) : NaN
  return <OperationChip layout={toolbar ? 'toolbar' : 'panel'} trailing={trailing} label={operation.label} message={operation.message} status={operation.state} statusText={operation.stateText}
    measurement={progressText(operation)} unknownText={operation.unknownText}
    progress={operation.total && operation.total > 0 && operation.completed !== undefined ? operation.completed / operation.total * 100 : undefined}
    progressLabel={operation.unit === 'bytes' ? `${operation.measure} progress` : t("Overall operation progress")}
    startedAt={Number.isFinite(startedAt) ? startedAt : observedAt} onOpen={onOpen}
    icon={operation.id === 'adb-console' ? <Terminal /> : operation.id.startsWith('files-') || operation.id === 'file-search' ? <Folder /> : operation.unit === 'applications' ? <AppWindow /> : operation.unit === 'percent' ? <Package /> : operation.id === 'connection' ? <Smartphone /> : <ArrowDownUp />} />
}
export function WorkspaceProgress() {
  const inspector = useApkInspectorStore()
  const phoneTool = usePhoneToolsStore(s => s.job)
  const consoleRun = useAdbConsoleStore(s => s.run)
  const diagnostic = useAndroidDiagnosticsStore(s => s.job)
  const search = useFileSearchStore(s => s.state)
  const files = useFilesStore(s => s.tasks.tasks)
  const restore = useRestoreStore(s => s.state), restoring = useRestoreBusy()
  const filePreparing = useRestoreStore(s => s.filePreparing)
  const backup = useBackupStore(s => s.state), apps = useAppsStore(), app = useAppStore()
  const action = useAppActionsStore(s => s.action), connection = useConnectionStore()
  const [showAll, setShowAll] = useState(false)
  const [cancellingApps, setCancellingApps] = useState(false)
  const cancelApps = async () => { if (cancellingApps) return; setCancellingApps(true); try { await useAppsStore.getState().cancel() } finally { setCancellingApps(false) } }
  const [observedStarts, setObservedStarts] = useState<Record<string, number>>({})
  const operations: Operation[] = []
  for (const slot of ['before', 'after'] as const) if (inspector[slot].status === 'loading') operations.push({ id: `apk-inspector-${slot}`, label: t("Inspecting APK {0}", [slot === 'before' ? t("A") : t("B")]), message: message(inspector[slot].message), unknownText: t("Local analysis"), open: app.openLocalApks })
  if (phoneTool?.status === 'running') operations.push({ id: 'phone-tool', runId: phoneTool.id, startedAt: phoneTool.startedAt,
    label: phoneTool.kind === 'clipboard' ? phoneTool.action === 'write' ? t("Sending clipboard text") : t("Reading clipboard text") : `${phoneTool.action === 'export' ? t("Exporting") : t("Reading")} ${t(phoneDataLabels[phoneTool.kind])}`,
    message: message(phoneTool.message), completed: phoneTool.completed, total: phoneTool.total, unknownText: t("Waiting for operation to finish"),
    open: () => usePhoneToolsStore.getState().open(phoneTool.kind, { ...phoneTool.target, name: phoneTool.deviceName }) })
  if (diagnostic?.status === 'running') operations.push({ id: 'android-diagnostic', label: diagnostic.kind === 'bugreport' ? t("Collecting bug report") : diagnostic.kind === 'logcat' ? t("Reading Android logs") : t("Reading battery usage"), message: message(diagnostic.message), unknownText: t("Total progress unavailable"), open: () => {
    if (diagnostic.kind === 'battery') { app.setSection('monitor'); useMonitorStore.setState({ tab: 'battery' }) }
    else useAndroidDiagnosticsStore.getState().open(diagnostic.kind, { ...diagnostic.target, name: diagnostic.deviceName })
  } })
  if (consoleRun && ['running', 'stopping'].includes(consoleRun.status)) operations.push({ id: 'adb-console', runId: consoleRun.id, startedAt: consoleRun.startedAt, label: t("Running ADB command"), message: `${consoleRun.deviceName} · ${consoleRun.command}`, state: consoleRun.status, unknownText: t("Waiting for command to finish"), open: () => app.setSection('console') })
  if (filePreparing) operations.push({ id: 'file-install', label: t("Preparing installation files"), message: apps.status === 'loading' ? t("Reading the destination profile…") : restore?.status === 'opening' ? message(restore.message) : t("Checking selected APK/APKS files…"), open: () => useRestoreStore.getState().open('install') })
  if (restoring && restore && !filePreparing) operations.push({ id: 'restore', label: restore.sourceKind === 'install' ? restore.status === 'opening' ? t("Checking installation files") : restore.status === 'confirming' ? t("Awaiting installation confirmation") : t("Installing applications") : restore.status === 'batch' ? t("Restoring applications") : restore.status === 'restoring' ? t("Restoring application files") : restore.status === 'installing' ? t("Installing application") : restore.status === 'confirming' ? t("Awaiting confirmation") : restore.status === 'opening' ? t("Opening backup") : t("Verifying backup"), message: message(restore.message), completed: restore.batch?.finished, total: restore.batch?.items.length, open: () => useRestoreStore.getState().open(restore.sourceKind === 'install' ? 'install' : 'restore') })
  if (backup?.status === 'running') operations.push({ id: 'backup', label: backup.operation === 'preset' ? t("Saving preset") : t("Backup in progress"), message: backup.items.find(item => item.status === 'running')?.label || message(backup.message), completed: backup.phase ? undefined : backup.completed, total: backup.phase ? undefined : backup.total, open: () => useBackupStore.getState().open({ purpose: backup.operation, id: backup.id, userId: backup.userId, name: backup.name, packages: backup.items.map(item => item.packageName), hidden: 0 }) })
  if (apps.status === 'loading' || apps.backgroundUserId !== null) operations.push({ id: 'apps', label: t("Reading applications"), message: apps.status === 'loading' ? apps.message.replace(/^Reading applications(?: and icons)?(?: and storage sizes)? for /, translateUi("Profile: ")) : translateUi("Loading profile {0}", [apps.backgroundUserId]), ...(apps.status === 'loading' ? apps.progress : {}), open: () => app.setSection('apps') })
  if (apps.badgeRead?.status === 'running') operations.push({ id: 'badges', label: t("Reading badges"), message: t("Collecting application information"), completed: apps.badgeRead.completed, total: apps.badgeRead.total, open: () => app.setSection('apps') })
  const actionEntry = app.activity.find(i => i.operation?.key === action?.operationId)
  if (action?.status === 'running') operations.push({ id: 'action', label: actionEntry?.operation?.title || t("Application action"), message: action.message, completed: action.completed, total: action.total, open: () => app.openActivity(actionEntry?.id) })
  for (const component of app.components.filter(c => ['Checking', translateUi("Downloading"), translateUi("Installing")].includes(c.status))) operations.push({ id: component.id, label: `${component.status} ${component.name}`, message: component.message || component.status, ...(component.status === 'Downloading' && component.progress > 0 ? { completed: component.progress, total: 100 } : {}), open: () => { app.setSection('components'); app.selectComponent(component.id, true) } })
  if (connection.manualScanning || connection.busy) operations.push({ id: 'connection', label: connection.manualScanning ? t("Scanning devices") : t("Connecting device"), message: connection.message || t("Please wait"), open: () => app.setSection('connection') })
  const priority = { conflict: 0, running: 1, paused: 2, queued: 3 }
  for (const task of files.filter(fileTaskActive).sort((a, b) => (priority[a.status as keyof typeof priority] ?? 4) - (priority[b.status as keyof typeof priority] ?? 4))) {
    const status = fileTaskStatus(task), transferring = ['copy', 'move'].includes(task.action)
    const measurement = transferring ? fileTaskMeasurement(task) : { completed: task.completed, total: task.items.length }
    const summary = 'measure' in measurement && measurement.measure === 'Total transferred' ? fileTaskSummary(task).replace(/ · [^·]+ transferred$/, '') : fileTaskSummary(task)
    operations.push({ id: 'files-' + task.id, startedAt: task.createdAt, label: t("{0} files", [fileActionLabel[task.action]]), message: `${summary} · ${task.current || task.source.path}`, ...measurement, state: status.state, stateText: status.text, unknownText: task.phase === 'scanning' ? t("Calculating overall size…") : t("Overall size not yet known"), open: () => { useHistoryStore.setState({ filesSession: null }); useFilesStore.setState({ taskPanel: true }) } })
  }
  if (search?.status === 'running') operations.push({ id: 'file-search', label: search.operation === 'index' ? t("Indexing files") : t("Searching files"), message: `${search.scanned} checked · ${search.matched} matches · ${search.current}`, open: showFileSearch })
  for (const operation of operations) {
    if (['restore', 'backup', 'apps', 'badges', 'action'].includes(operation.id)) operation.unit = 'applications'
    if (app.components.some(c => c.id === operation.id)) operation.unit = 'percent'
    if (operation.id === 'restore' && restore?.status === 'confirming') { operation.state = 'attention'; operation.stateText = 'Awaiting confirmation' }
    const run = operation.id === 'backup' ? backup : operation.id === 'restore' ? restore : operation.id === 'action' ? action : undefined
    if (run) { operation.runId = `${operation.id}:${run.operationId || run.startedAt || ''}`; operation.startedAt = run.startedAt }
    if (operation.id === 'android-diagnostic' && diagnostic) { operation.runId = diagnostic.id; operation.startedAt = diagnostic.startedAt }
    if (operation.id === 'file-search') operation.runId = search?.id
    if (operation.id === 'apps') operation.runId = `apps:${apps.deviceId}`
  }
  // Keep a clock per active run, including operations temporarily behind another one.
  const runKeys = operations.map(operation => operation.runId || operation.id).sort().join('\0')
  useEffect(() => {
    const now = Date.now()
    setObservedStarts(previous => Object.fromEntries(runKeys ? runKeys.split('\0').map(key => [key, previous[key] ?? now]) : []))
  }, [runKeys])
  const primary = operations[0]
  const cancelButton = (operation: Operation) => operation.id === 'phone-tool' ? <button type="button" aria-label={t("Cancel phone operation")} title={t("Cancel phone operation")} onClick={() => void usePhoneToolsStore.getState().cancel()}><X size={14} /></button> : operation.id === 'adb-console' ? <button type="button" aria-label={t("Stop console command")} title={t("Stop console command")} disabled={consoleRun?.status === 'stopping'} onClick={() => void useAdbConsoleStore.getState().stop()}><X size={14} /></button> : operation.id === 'apps' ? <button type="button" aria-label={t("Cancel collection")} title={t("Cancel application collection")} disabled={cancellingApps} onClick={() => void cancelApps()}><X size={14} /></button> : null
  const last = app.activity.find(i => i.id === app.lastOperationId)
  const lastId = last?.id, lastStatus = last?.operation?.status
  // Start the display interval only when no active operation covers the result.
  const showingResult = !primary && lastId !== undefined && lastStatus !== undefined
  useEffect(() => {
    if (!showingResult || lastId === undefined || !lastStatus) return
    const timer = window.setTimeout(() => {
      if (useAppStore.getState().lastOperationId === lastId) useAppStore.setState({ lastOperationId: null })
    }, isFailedResult({ status: lastStatus }) ? 15_000 : 8_000)
    return () => window.clearTimeout(timer)
  }, [showingResult, lastId, lastStatus])
  return <div className="workspace-progress" aria-label={t("Workspace operations")}>
    {primary ? <>
      <ActiveOperation toolbar key={primary.runId || primary.id} operation={primary} observedAt={observedStarts[primary.runId || primary.id]} trailing={<>{operations.length > 1 && <button type="button" aria-label={translateUi("More ({0})", [operations.length - 1])} title={localeText("Show all current operations")} onClick={() => setShowAll(true)}>+{operations.length - 1}</button>}{cancelButton(primary)}</>} />
    </> : last?.operation ? <OperationChip layout="toolbar" label={operationSummary(last.operation)} status={last.operation.status} statusText={last.operation.status} accessibleLabel="Last operation — open Activity" onOpen={() => app.openActivity(last.id)} trailing={<button type="button" aria-label={localeText("Dismiss last operation")} title={localeText("Dismiss last operation")} onClick={() => useAppStore.setState({ lastOperationId: null })}><X size={14} /></button>} /> : null}
    {showAll && <BadgeDialog title={t("Current operations")} close={() => setShowAll(false)}>{operations.length ? operations.map(operation => <div className="workspace-operation" key={operation.runId || operation.id}><ActiveOperation operation={operation} observedAt={observedStarts[operation.runId || operation.id]} trailing={cancelButton(operation)} onOpen={() => { setShowAll(false); operation.open() }} /></div>) : <p>{t("No operations running.")}</p>}</BadgeDialog>}
  </div>
}
