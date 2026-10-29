import { t as translateUi } from '../lib/i18n'
import { locale as uiLocale } from '../lib/i18n'
import { message } from "../lib/i18n"
import { t } from "../lib/i18n"
import { ActionIndicator } from '../components/ui'
import { useMemo, useState } from 'react'
import { Box, Cable, CircleAlert, Folder, Copy, Download, Grid2X2, Monitor, Search, Trash2, X } from 'lucide-react'
import { copyText } from '../lib/clipboard'
import { requestBackend } from '../lib/backend'
import { operationSummary } from '../lib/activityOperation'
import { activityMessageSummary } from '../lib/activityMessage'
import { failureReasonLabel, isFailedResult, prioritizeFailedResults } from '../lib/operationResults'
import { OperationResultsFilter } from '../components/OperationResultsFilter'
import { FailureDiagnosticDetails } from '../components/FailureDiagnosticDetails'
import { useAppStore, type ActivityItem } from '../store/useAppStore'
import { useAppActionsStore } from '../store/useAppActionsStore'
import { useAppsStore } from '../store/useAppsStore'
import { useConnectionStore } from '../store/useConnectionStore'
import { useBackupStore } from '../store/useBackupStore'
import { useRestoreBusy } from '../store/useRestoreStore'
import { useHistoryStore } from '../store/useHistoryStore'
import { HistorySessions } from '../components/HistorySessions'
import { ActivityApplication } from '../components/ActivityApplication'

export const activitySourceLabel = (source: string) => source[0].toUpperCase() + source.slice(1)
function WorkspaceLabel({ source }: { source: ActivityItem['source'] }) {
  const Icon = { components: Box, connection: Cable, apps: Grid2X2, files: Folder, system: Monitor }[source]
  return <span className="activity-workspace"><Icon size={14} strokeWidth={1.8} aria-hidden="true" />{activitySourceLabel(source)}</span>
}
const deviceLabel = (item: ActivityItem) => item.deviceName || item.device || '—'
const result = (item: ActivityItem) => item.interrupted ? 'interrupted' : item.operation?.status || item.diagnostic?.status || item.tone
const hasIssue = (item: ActivityItem) => ['warning', 'interrupted'].includes(result(item)) || isFailedResult({ status: result(item) })
const shortId = (item: ActivityItem) => (item.operation?.key || item.diagnostic?.operationId)?.slice(0, 8) || item.id.toString(16).padStart(8, '0')
const resultLabel = (value: string) => ({ interrupted: t("Interrupted — verify result"), info: t("Info"), warning: translateUi("Warning / error"), running: t("Running"), success: t("Completed"), partial: t("Partial"), error: t("Failed"), cancelled: t("Cancelled"), skipped: t("Skipped"), pending: t("Pending") } as Record<string, string>)[value] || value
const activityText = (item: ActivityItem) => [
  `${item.sessionId || 'current'}\t${item.time}\t${item.operation?.key || shortId(item)}\t${activitySourceLabel(item.source)}\t${deviceLabel(item)}\t${result(item)}\t${item.text}`,
  ...(item.deviceName && item.deviceName !== item.device ? [translateUi("Device identifier: {0}", [item.device])] : []),
  ...(item.message ? [item.message] : []),
  ...(item.diagnostic ? [item.diagnostic.cause, item.diagnostic.appLabel || '', item.diagnostic.packageName || '', item.diagnostic.stage, translateUi("Diagnostic report: {0}", [item.diagnostic.id])] : []),
  ...(item.operation ? [translateUi("Profile: {0} · ID {1}", [item.operation.profileName, item.operation.userId]), item.operation.message,
    ...item.operation.items.map(i => `${i.label}\t${i.packageName}\t${i.status}\t${i.message}${i.uncertain ? t("\nOutcome uncertain. Check the application on the phone before retrying.") : ''}`)] : []),
].join('\n')
async function copyEntry(item: ActivityItem) {
  try { await copyText(activityText(item)); useAppStore.getState().notify("Copied") }
  catch { useAppStore.getState().notify("Could not copy the event. Select and copy its text manually.") }
}
export function ActivityInspector() {
  const { activity: currentActivity, selectedActivityId, inspectorTab } = useAppStore()
  const h = useHistoryStore(), activity = h.activitySession ? h.archives[h.activitySession]?.activity || [] : currentActivity
  const item = activity.find(entry => entry.id === selectedActivityId)
  const failures = item?.operation?.items.filter(isFailedResult) || []
  const rawMessage = item?.operation?.message || item?.diagnostic?.message || item?.message || item?.text || ''
  const message = failures.length === 1 ? failures[0].message || rawMessage : rawMessage
  const summary = failures.length > 1 && item?.operation ? operationSummary(item.operation) : activityMessageSummary(message)
  return <>
    <div className="inspector-section-label"><span className="eyebrow">{t("EVENT ")}{inspectorTab === 'details' ? t("DETAILS") : t("ACTIONS")}</span></div>
    {item ? inspectorTab === 'details' ? <>
      <dl className="metadata">
        <div><dt>{t("ID")}</dt><dd><code>{shortId(item)}</code></dd></div>
        <div><dt>{t("Started")}</dt><dd>{new Date(item.time).toLocaleString(uiLocale())}</dd></div>
        {item.endedAt && <div><dt>{t("Finished")}</dt><dd>{new Date(item.endedAt).toLocaleString(uiLocale())}</dd></div>}
        <div><dt>{t("Workspace")}</dt><dd><WorkspaceLabel source={item.source} /></dd></div>
        <div><dt>{t("Device")}</dt><dd title={item.operation?.deviceId || item.device}>{deviceLabel(item)}</dd></div>
        {item.operation && <div><dt>{t("Profile")}</dt><dd>{item.operation.profileName}{t(" · ID ")}{item.operation.userId}</dd></div>}
        <div><dt>{t("Result")}</dt><dd>{resultLabel(result(item))}</dd></div>
      </dl>
      <section aria-label={t("Event summary")}>
        {failures.length > 0 && <div className="activity-failed-apps" aria-label={t("Failed applications")}>{failures.slice(0, 5).map((app, i) => <ActivityApplication key={`${app.packageName}-${i}`} item={app} />)}{failures.length > 5 && <small>+{failures.length - 5}{t(" more in Application results below")}</small>}</div>}
        <p className="event-message">{summary}</p>
        {item.operation?.items.some(entry => entry.uncertain) && <p className="warning-text">{t("Outcome uncertain. Check the affected applications on the phone before retrying.")}</p>}
        {(failures.length > 0 || summary !== rawMessage.trim()) && <p className="component-description">{t("Original output and per-application results are in Operation details below.")}</p>}
      </section>
      {item.diagnostic && <FailureDiagnosticDetails key={item.diagnostic.id} diagnostic={item.diagnostic} />}
    </> : <div className="detail-actions">
      <button className="button secondary" onClick={() => void copyEntry(item)}><Copy size={14} />{t("Copy event")}</button>
      {item.diagnostic && <button className="button secondary" disabled={!item.diagnostic.saved} title={item.diagnostic.saveError} onClick={() => void requestBackend({ type: 'diagnostics.export', id: item.diagnostic!.id })}><Download size={14} />{t("Save diagnostics")}<ActionIndicator picker /></button>}
    </div> : <p className="component-description">{t("Select an event to read its details.")}</p>}
    <p className="component-description">{t("Last 500 entries across all workspaces. Previous sessions are stored separately on this PC. The latest 50 failure reports are saved automatically.")}</p>
  </>
}
function OperationControls({ item }: { item: ActivityItem }) {
  const action = useAppActionsStore(s => s.action), apps = useAppsStore(), connection = useConnectionStore()
  const backupBusy = useBackupStore(s => s.state?.status === 'running'), restoreBusy = useRestoreBusy()
  if (!action || !item.operation || item.operation.kind !== 'action' || item.operation.key !== action.operationId) return null
  const ready = action.status !== 'running' && !backupBusy && !restoreBusy && apps.status === 'ready' && apps.badgeRead?.status !== 'running' && apps.deviceId === action.id && apps.userId === action.userId && connection.activeDeviceId === action.id && connection.devices.some(d => d.id === action.id && d.status === 'connected')
  return <>
    {action.status === 'running' && (action.batch || action.action === 'export') && <button className="button secondary" disabled={action.batch?.stopRequested} onClick={() => void requestBackend({ type: 'apps.cancelAction' })}>{action.batch ? action.batch.stopRequested ? t("Stopping after current application…") : t("Stop after current application") : t("Cancel export")}</button>}
    {action.batch && action.status !== 'running' && action.batch.items.some(i => ['error', 'cancelled'].includes(i.status) && !i.uncertain) && <button className="button secondary" disabled={!ready} title={t("Retry only failed or unstarted applications with a known outcome. Confirmation is required again.")} onClick={() => void requestBackend({ type: 'apps.retryBatchAction' })}>{t("Retry unfinished…")}</button>}
    {action.status === 'success' && action.exportPath && <button className="button secondary" onClick={() => void requestBackend({ type: 'apps.openExport' })}>{t("Open export folder")}</button>}
  </>
}
export function ActivitySection() {
  const { activity: currentActivity, selectedActivityId, clearActivity } = useAppStore()
  const h = useHistoryStore(), archived = !!h.activitySession
  const activity = h.activitySession ? h.archives[h.activitySession]?.activity || [] : currentActivity
  const [search, setSearch] = useState(''), [source, setSource] = useState('all'), [tone, setTone] = useState('all')
  const [resultFilter, setResultFilter] = useState<{ id: number | null; onlyFailed: boolean }>({ id: null, onlyFailed: false })
  const matching = useMemo(() => {
    const query = search.toLocaleLowerCase()
    return activity.filter(item => (source === 'all' || item.source === source) && (!query || activityText(item).toLocaleLowerCase().includes(query)))
  }, [activity, source, search])
  const issues = matching.filter(hasIssue).length
  const shown = matching.filter(item => tone === 'all' || result(item) === tone || (tone === 'warning' && hasIssue(item)))
  const selected = activity.find(i => i.id === selectedActivityId)
  const failedCount = selected?.operation?.items.filter(isFailedResult).length || 0
  const onlyFailed = resultFilter.id === selectedActivityId && resultFilter.onlyFailed && failedCount > 0
  function selectEvent(item: ActivityItem, failures = false) {
    setResultFilter({ id: item.id, onlyFailed: failures })
    useAppStore.setState({ selectedActivityId: item.id })
    useAppStore.getState().showInspector('details')
  }
  function exportEvents() {
    const url = URL.createObjectURL(new Blob([shown.map(activityText).join('\n\n')], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = `adb-vault-activity-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <section className="section-content activity-section" aria-label={t("Activity")}>
    <div className="activity-heading"><h1>{t("Activity")}</h1><span>{t("Operation history")}</span>{(issues > 0 || tone === 'warning') && <button className="button secondary activity-issues-toggle" aria-pressed={tone === 'warning'} title={t("Show warnings and failed or partially completed operations")} onClick={() => setTone(tone === 'warning' ? 'all' : 'warning')}><CircleAlert size={14} aria-hidden="true" />{t("Issues (")}{issues})</button>}</div>
    <HistorySessions view="activity" />
    <div className="activity-toolbar">
      <label>{t("Workspace")}<select aria-label={t("Event workspace")} value={source} onChange={e => setSource(e.target.value)}>{['all', 'components', 'connection', 'apps', 'files', 'system'].map(value => <option key={value} value={value}>{value === 'all' ? t("All workspaces") : activitySourceLabel(value)}</option>)}</select></label>
      <label>{t("Result")}<select aria-label={t("Event result")} value={tone} onChange={e => setTone(e.target.value)}>{['all', 'running', 'success', 'partial', 'error', 'cancelled', 'interrupted', 'info', 'warning'].map(value => <option key={value} value={value}>{value === 'all' ? t("All results") : resultLabel(value)}</option>)}</select></label>
      <div className="component-search"><Search size={15} /><input aria-label={t("Search activity")} placeholder={t("Operation, app or message…")} value={search} onChange={e => setSearch(e.target.value)} /></div>
      <span>{shown.length}{t(" of ")}{activity.length}</span><button className="button secondary" disabled={!shown.length} onClick={exportEvents}><Download size={14} />{t("Export shown")}</button>{!archived && <button className="button secondary" title={t("Clear activity in the current session only")} aria-label={t("Clear session history")} disabled={!activity.length || activity.some(i => i.operation?.status === 'running')} onClick={clearActivity}><Trash2 size={14} /></button>}
    </div>
    <div className="activity-table-scroll" role="region" aria-label={t("Session events")} tabIndex={0}>
      <table className="activity-table"><thead><tr><th aria-label={t("Timeline")} /><th>{t("ID")}</th><th>{t("Operation")}</th><th>{t("Result")}</th><th>{t("Workspace")}</th><th>{t("Device")}</th><th>{t("Time")}</th></tr></thead><tbody>{shown.map(item => <tr key={item.id} className={`${selectedActivityId === item.id ? 'selected' : ''} ${isFailedResult({ status: result(item) }) ? 'result-failure-row' : ''}`}>
        <td className="activity-rail"><span className={`activity-node ${result(item)}`} /></td><td><code className="activity-id" title={item.operation?.key}>{shortId(item)}</code></td>
        <td><button className="event-select" aria-label={t("Event: {0}", [item.text])} aria-pressed={selectedActivityId === item.id} onClick={() => selectEvent(item)}><span>{item.text}</span>{item.operation?.items.some(isFailedResult) && <span className="activity-event-app"><ActivityApplication item={item.operation.items.find(isFailedResult)!} compact />{item.operation.items.filter(isFailedResult).length > 1 && <small>+{item.operation.items.filter(isFailedResult).length - 1}</small>}</span>}</button></td>
        <td>{item.operation?.items.some(isFailedResult) ? <button className={`text-button activity-result activity-failure-link ${result(item)}`} aria-label={t("Show {0} failed applications: {1}", [item.operation.items.filter(isFailedResult).length, item.text])} onClick={() => selectEvent(item, true)}><CircleAlert size={13} aria-hidden="true" />{resultLabel(result(item))} · {item.operation.items.filter(isFailedResult).length}{t(" failed")}</button> : <span className={`activity-result ${result(item)}`}>{resultLabel(result(item))}</span>}</td><td><WorkspaceLabel source={item.source} /></td><td className="activity-device" title={item.operation?.deviceId || item.device}>{deviceLabel(item)}</td><td className="activity-time" title={new Date(item.time).toLocaleString(uiLocale())}>{new Date(item.time).toLocaleTimeString(uiLocale())}</td>
      </tr>)}</tbody></table>
      {!shown.length && <p className="empty-device-list">{activity.length ? t("No matching events.") : t("No events yet. Operations will appear here as they happen.")}</p>}
    </div>
    {selected && <div key={selected.id} className="activity-detail" role="region" aria-label={t("Operation details")}>
      <div className="activity-detail-heading"><strong>{selected.operation ? operationSummary(selected.operation) : selected.text}</strong><button className="text-button" title={t("Copy operation with all results")} aria-label={t("Copy operation")} onClick={() => void copyEntry(selected)}><Copy size={14} /></button><button className="text-button" aria-label={t("Close operation details")} onClick={() => useAppStore.setState({ selectedActivityId: null })}><X size={14} /></button></div>
      <div className="activity-detail-body"><p className="activity-detail-context">{new Date(selected.time).toLocaleString(uiLocale())} · {activitySourceLabel(selected.source)}{selected.device && ` · ${deviceLabel(selected)}`}{selected.operation && t(" · {0} · ID {1}", [selected.operation.profileName, selected.operation.userId])}</p><p className="event-message">{selected.operation?.message || selected.message || selected.text}</p>
        {selected.operation && <><OperationResultsFilter total={selected.operation.items.length} failed={failedCount} onlyFailed={onlyFailed} onChange={value => setResultFilter({ id: selected.id, onlyFailed: value })} /><table className="activity-items" aria-label={t("Application results")}><thead><tr><th>{t("Application")}</th><th>{t("Result")}</th><th>{t("Message")}</th></tr></thead><tbody>{prioritizeFailedResults(selected.operation.items, onlyFailed).map((i, index) => <tr key={`${i.packageName}-${index}`} className={isFailedResult(i) ? 'result-failure-row' : undefined}><td><ActivityApplication item={i} /></td><td><span className={`activity-result ${i.status}`}>{failureReasonLabel(i) || resultLabel(i.status)}</span></td><td>{message(i.message)}{i.uncertain && <p className="warning-text">{t("Outcome uncertain. Check the application on the phone before retrying.")}</p>}</td></tr>)}</tbody></table></>}
      </div><div className="activity-detail-controls">{!archived && <OperationControls item={selected} />}</div>
    </div>}
    <p className="workspace-footnote">{t("Up to 500 events per session · Last 30 sessions · Newest first")}</p>
  </section>
}
