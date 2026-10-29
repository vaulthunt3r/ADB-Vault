import { useAppNotesStore } from '../store/useAppNotesStore'
import { useAdbConsoleStore } from '../store/useAdbConsoleStore'
import { useApkInspectorStore } from '../store/useApkInspectorStore'
import { usePhoneToolsStore } from '../store/usePhoneToolsStore'
import { useScreenStore, useScreenPreferences } from '../store/useScreenStore'
import { screenLaunch } from '../../electron/screen-protocol'
import { useNotificationStore } from '../store/useNotificationStore'
import { useConfirmationStore } from '../store/useConfirmationStore'
import { useHistoryStore } from '../store/useHistoryStore'
import { useAndroidDiagnosticsStore } from '../store/useAndroidDiagnosticsStore'
import { useFileSearchStore } from '../store/useFileSearchStore'
import { useFilesStore } from '../store/useFilesStore'
import { useRestoreStore } from '../store/useRestoreStore'
import { useFastbootStore } from '../store/useFastbootStore'
import { actionOperation, backupOperation, restoreOperation, identifyOperation, operationApplications, type ActivityOperation } from './activityOperation'
import type { BackendRequest, BackendSnapshot, ConnectionSnapshot } from '../../electron/contracts'
import { useAppStore } from '../store/useAppStore'
import { useConnectionStore } from '../store/useConnectionStore'
import { receiveApps, useAppsStore } from '../store/useAppsStore'
import { useAdbDiagnosticsStore } from '../store/useAdbDiagnosticsStore'
import { useBackupStore } from '../store/useBackupStore'
import { useAppActionsStore } from '../store/useAppActionsStore'
import { retainCheckingStatus } from './components'
import { useAppsSelectionStore } from '../store/useAppsSelectionStore'

function connection(snapshot: ConnectionSnapshot) {
  useAppsSelectionStore.getState().connectionChanged(snapshot)
  const previous = useConnectionStore.getState()
  useConnectionStore.setState({ ...snapshot,
    // Keep an expired/dismissed notice hidden when polling republishes the same error.
    errorNotice: !snapshot.error ? null : snapshot.error !== previous.error ? { text: snapshot.error } : previous.errorNotice,
    selectedDeviceId: snapshot.devices.some(d => d.id === previous.selectedDeviceId) ? previous.selectedDeviceId : snapshot.activeDeviceId || snapshot.devices[0]?.id || null })
  const app = useAppStore.getState()
  if (previous.activeDeviceId && !snapshot.devices.some(d => d.id === previous.activeDeviceId && d.status === 'connected') && app.section === 'apps' && app.appsView !== 'notes') {
    app.setSection('connection'); app.notify("The active device disconnected. Check its connection.")
  }
}
function recordOperations() {
  if (useAppStore.getState().historyManaged) return
  const action = useAppActionsStore.getState().action, backup = useBackupStore.getState().state, restore = useRestoreStore.getState().state
  const c = useConnectionStore.getState(), a = useAppsStore.getState()
  const record = (op: ActivityOperation | null) => { if (op) useAppStore.getState().recordOperation(identifyOperation(op, operationApplications(op, a))) }
  const device = (id: string) => c.devices.find(d => d.id === id)?.name || id
  const profile = (id: number) => a.profiles.find(p => p.id === id)?.name || `Profile ${id}`
  if (action) record(actionOperation(action, device(action.id), profile(action.userId)))
  if (backup) record(backupOperation(backup, device(backup.id), profile(backup.userId)))
  if (restore) record(restoreOperation(restore))
}
function snapshot(value: BackendSnapshot) {
  if (value.appNotes) useAppNotesStore.setState(value.appNotes)
  if (value.apkInspector) useApkInspectorStore.getState().receive(value.apkInspector)
  if (value.phoneTools) usePhoneToolsStore.getState().receive(value.phoneTools)
  if (value.adbConsole) useAdbConsoleStore.getState().receive(value.adbConsole)
  if (value.screenSessions) useScreenStore.setState({ sessions: value.screenSessions })
  useConfirmationStore.getState().receive(value.confirmation)
  useNotificationStore.getState().receive(value.notifications)
  if (value.history) useHistoryStore.getState().receive(value.history); if (value.androidDiagnostics) useAndroidDiagnosticsStore.setState(value.androidDiagnostics); if (value.fileSearch) useFileSearchStore.getState().receive(value.fileSearch); if (value.files) useFilesStore.getState().receive(value.files); useRestoreStore.setState({ state: value.restore ?? null }); useBackupStore.setState({ apkZstd: value.apkZstd === true, destination: value.exportDestination ?? { mode: 'ask', folder: null }, state: value.backup ?? null, preview: value.presetPreview ?? null }); useAppActionsStore.setState({ action: value.appAction ?? null }); useAppStore.setState(s => ({ components: retainCheckingStatus(value.components, s.components), stopAdbOnExit: value.stopAdbOnExit !== false })); connection(value.connection); receiveApps(value.apps); if (value.adbDiagnostics) useAdbDiagnosticsStore.setState({ diagnostics: value.adbDiagnostics }); recordOperations(); value.failureDiagnostics?.forEach(useAppStore.getState().recordDiagnostic) }
export async function requestBackend(request: BackendRequest, onError?: (message: string) => void): Promise<boolean> {
  if (!window.desktop) { const message = 'Start the Electron application with npm run dev. Real operations are unavailable in a browser preview.'; onError?.(message); useAppStore.getState().notify(message); return false }
  try {
    const actual = request.type === 'connection.screen' && request.action === 'open' && !request.options ? { ...request, options: screenLaunch(useScreenPreferences.getState().preferences) } : request
    const reply = await window.desktop.request(actual)
    if (reply.snapshot.fastboot) useFastbootStore.setState(reply.snapshot.fastboot)
    snapshot(reply.snapshot)
    if (!reply.ok) { onError?.(reply.error); if (reply.error !== reply.snapshot.connection.error || useAppStore.getState().section !== 'connection') useAppStore.getState().notify(reply.error); return false }
    if (reply.notice) useAppStore.getState().notify(reply.notice)
    return true
  } catch (error) { const message = `Desktop backend unavailable: ${error instanceof Error ? error.message : String(error)}`; onError?.(message); useAppStore.getState().notify(message); return false }
}
export function startBackend() {
  if (!window.desktop) return () => {}
  const unsubscribe = window.desktop.subscribe(event => {
    if (event.type === 'appNotes') { useAppNotesStore.setState(event.state); return }
    if (event.type === 'apkInspector') { useApkInspectorStore.getState().receive(event.state); return }
    if (event.type === 'phoneTools') { usePhoneToolsStore.getState().receive(event.state); return }
    if (event.type === 'adbConsole') { useAdbConsoleStore.getState().receive(event.state); return }
    if (event.type === 'screenSessions') { useScreenStore.setState({ sessions: event.sessions }); return }
    if (event.type === 'confirmation') { useConfirmationStore.getState().receive(event.state); return }
    if (event.type === 'notificationOpen') {
      if (event.destination === 'settings') useAppStore.setState({ settingsTab: 'notifications' })
      useAppStore.getState().setSection(event.destination)
      if (event.destination === 'activity') useAppStore.getState().openActivity()
      if (event.destination === 'files' && event.taskPanel) { useHistoryStore.setState({ filesSession: null }); useFilesStore.setState({ taskPanel: true }) }
      return
    }
    if (event.type === 'history') { useHistoryStore.getState().receive(event.overview); return }
    if (event.type === 'notice') { useAppStore.getState().notify(event.text); return }
    if (event.type === 'androidDiagnostics') { useAndroidDiagnosticsStore.setState(event.state); return }
    if (event.type === 'failureDiagnostic') { useAppStore.getState().recordDiagnostic(event.diagnostic); return }
    if (event.type === 'fileSearch') { useFileSearchStore.getState().receive(event.state); return }
    if (event.type === 'files') { useFilesStore.getState().receive(event.state); return }
    if (event.type === 'fastboot') { useFastbootStore.setState(event.state); return }
    if (event.type === 'restore') { const previous = useRestoreStore.getState(); useRestoreStore.setState({ state: event.state }); if (!previous.visible && event.state.status !== previous.state?.status && ['success', 'error', 'partial'].includes(event.state.status)) useAppStore.getState().notify(event.state.message) }
    else if (event.type === 'backup') useBackupStore.setState({ state: event.state })
    else if (event.type === 'appAction') useAppActionsStore.setState({ action: event.state })
    else if (event.type === 'components') useAppStore.setState(s => ({ components: retainCheckingStatus(event.components, s.components) }))
    else if (event.type === 'connection') connection(event.connection)
    else if (event.type === 'apps') receiveApps(event.apps)
    else if (event.type === 'adbDiagnostics') useAdbDiagnosticsStore.setState({ diagnostics: event.diagnostics })
    else {
      const device = event.device ? useConnectionStore.getState().devices.find(d => [d.id, d.serial, d.endpoint, ...(d.aliases || [])].includes(event.device!)) : undefined
      useAppStore.getState().log(event.text, event.tone, event.source, event.device, device?.name)
    }
    if (['restore', 'backup', 'appAction'].includes(event.type)) recordOperations()
  })
  void requestBackend({ type: 'snapshot' })
  return unsubscribe
}
