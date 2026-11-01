import { ActionIndicator } from './ui'
import { AppVirtualDisplayAction } from './AppVirtualDisplayAction'
import { ScreenSessions } from './ScreenControls'
import { useRestoreBusy, useRestoreStore } from '../store/useRestoreStore'
import { useEffect, useState } from 'react'
import { Network } from 'lucide-react'
import { useMonitorStore } from '../store/useMonitorStore'
import { useAppStore } from '../store/useAppStore'
import { Bell, Download, FolderOpen, Link, Pause, Play, Power, ScanSearch, Settings, Square, Trash2, X } from 'lucide-react'
import { LatticeLoader } from './operation-chip/OperationChip'
import { useAppsStore } from '../store/useAppsStore'
import { useBackupStore } from '../store/useBackupStore'
import { useAppActionsStore } from '../store/useAppActionsStore'
import { useConnectionStore } from '../store/useConnectionStore'
import { requestBackend } from '../lib/backend'
import type { AppActionId } from '../../electron/app-actions-protocol'
import { AppInspectorHeading } from './AppInspectorHeading'
import { useAppsSelectionStore } from '../store/useAppsSelectionStore'
import { AppsBatchActions } from './AppsBatchActions'
import { AppsClearActions } from './AppsClearActions'
import { KeepAppData, PackageActionBadge, PackageActionControls } from './PackageActionControls'
import { packageActionIds, type PackageAction, type PackageActionOptions } from '../../electron/package-actions-protocol'

export function AppsActions() {
  const { apps, selectedPackage, deviceId, userId, status, badgeRead, details } = useAppsStore()
  const [pendingScan, setPendingScan] = useState<string | null>(null)
  const [methodOptions, setMethodOptions] = useState<PackageActionOptions>({})
  const [keepData, setKeepData] = useState(false)
  useEffect(() => { setMethodOptions({}); setKeepData(false) }, [deviceId, userId])
  const action = useAppActionsStore(s => s.action)
  const selectedCount = useAppsSelectionStore(s => s.packages.size)
  const { devices, activeDeviceId } = useConnectionStore()
  const app = apps.find(item => item.packageName === selectedPackage)
  const device = devices.find(item => item.id === deviceId)
  const restoring = useRestoreBusy()
  const backupBusy = useBackupStore(s => s.state?.status === 'running')
  const busy = action?.status === 'running'
  const contextReady = !!window.desktop && !!deviceId && status === 'ready' && device?.status === 'connected' && activeDeviceId === deviceId && userId !== null && !busy && !restoring && !backupBusy && badgeRead?.status !== 'running'
  const enabled = contextReady && !!app
  const scanKey = JSON.stringify([deviceId, userId, selectedPackage])
  const appDetails = details?.deviceId === deviceId && details?.userId === userId && details?.packageName === selectedPackage ? details : null
  const scanning = pendingScan === scanKey || appDetails?.data?.analysis?.status === 'running'
  const scanBusy = pendingScan !== null || details?.status === 'loading' || details?.data?.analysis?.status === 'running'
  const scan = async () => {
    if (!enabled || scanBusy || !deviceId || userId === null || !app) return
    setPendingScan(scanKey)
    try { await requestBackend({ type: 'apps.scan', id: deviceId, userId, packageName: app.packageName }) }
    finally { setPendingScan(null) }
  }
  const perform = (id: AppActionId) => { if (enabled) void requestBackend({ type: 'apps.action', action: id, id: deviceId!, userId: userId!, packageName: app!.packageName, ...(packageActionIds.includes(id as PackageAction) ? { options: { ...methodOptions, ...(id === 'uninstall' ? { keepData } : {}) } } : {}) }) }
  const showResult = action && (busy || (action.id === deviceId && action.userId === userId && (!app || action.packageName === app.packageName)))
  const launchResult = action?.action === 'launch' && action.id === deviceId && action.userId === userId && action.packageName === app?.packageName ? action : null
  return <><span className="eyebrow">APP ACTIONS</span>
    {badgeRead?.status === 'running' && <p className="apps-filter-help">Badge information is being read. Finish or cancel it in Filter before running an action.</p>}
    {device && <ScreenSessions deviceId={device.id} />}
    {selectedCount > 0 ? <AppsBatchActions ready={contextReady} /> : app ? <>
      <AppInspectorHeading app={app} />
      <div className="apps-action-group"><h3>Analyze</h3>
        <button className="button secondary" disabled={!enabled} onClick={() => { useMonitorStore.setState({ tab: 'network', networkView: 'connections', paused: false, networkFilter: { deviceId: deviceId!, userId: userId!, packageName: app.packageName } }); useAppStore.getState().setSection('monitor') }}><Network size={15} />Network connections</button>
        <button className="button secondary" disabled={!enabled || scanBusy} title="Analyze APK size, trackers, libraries, domains and URLs. Results appear in About application → APK analysis." onClick={() => void scan()}>{scanning ? <LatticeLoader /> : <ScanSearch size={15} />}{scanning ? "Scanning APKs…" : "Scan APKs"}</button>
      </div>
      <div className="apps-action-group"><h3>Open on device</h3>
        <AppVirtualDisplayAction app={app} ready={enabled} />
        <button className="button secondary" disabled={!enabled || !app.enabled || app.suspended} title={!app.enabled || app.suspended ? "Enable or resume this app before launching it" : "Open the launcher or an available standalone main/preferences screen in this Android profile. Service-only packages may have no screen to open."} onClick={() => perform('launch')}>{launchResult?.status === 'running' ? <LatticeLoader /> : <Play size={15} />}{launchResult?.status === 'running' ? "Opening application…" : "Launch application"}</button>
        {launchResult && <div className={`apps-action-result apps-launch-result ${launchResult.status}`} role={launchResult.status === 'error' ? 'alert' : 'status'} aria-live="polite"><p>{launchResult.message}</p></div>}
        <button className="button secondary" title="Open this application's settings on the Android device" disabled={!enabled} onClick={() => perform('settings')}><Settings size={15} />Open app settings</button>
        <button className="button secondary" title="Open notification settings on the device for this profile (Android 8+)" disabled={!enabled} onClick={() => perform('notifications')}><Bell size={15} />Notification settings</button>
        <button className="button secondary" title="Open supported-link defaults on the device for this profile (Android 12+)" disabled={!enabled} onClick={() => perform('open-links')}><Link size={15} />Open by default</button>
      </div>
      <div className="apps-action-group"><h3>Save to computer</h3>
        <button className="button secondary" disabled={!enabled} onClick={() => useBackupStore.getState().open({ purpose: 'backup', id: deviceId!, userId: userId!, packages: [app.packageName], hidden: 0, name: "Selected 1" })}><Download size={15} />Back up this app<ActionIndicator /></button>
        <p>Includes the base APK and all installed splits. Choose APK, data, cache, OBB and media in the export window.</p>
      </div>
      <PackageActionControls value={methodOptions} onChange={setMethodOptions} disabled={!enabled} />
      <div className="apps-action-group"><AppsClearActions key={`${deviceId}:${userId}:${app.packageName}`} chosen={[app]} ready={enabled} options={methodOptions} /></div>
      <div className="apps-action-group"><h3>Manage this profile</h3>
        <button className="button secondary" disabled={!enabled} onClick={() => perform('force-stop')}><Square size={15} />Force stop</button>
        <button className="button secondary" disabled={!enabled || !app.enabled && !app.suspended} title={app.suspended ? "Unfreeze: remove Android suspension set through ADB. Administrator or other app restrictions may remain." : "Freeze: block opening the app and hide notifications using Android suspension. Keeps app data; background services may continue."} onClick={() => perform(app.suspended ? 'unsuspend' : 'suspend')}>{app.suspended ? <Play size={15} /> : <Pause size={15} />}{app.suspended ? "Unfreeze application" : "Freeze application"}</button>
        <p>Freeze uses Android’s Suspended state. It keeps app data; background services may continue.</p>
        <button className="button secondary" disabled={!enabled} onClick={() => perform(app.enabled ? 'disable' : 'enable')}><Power size={15} />{app.enabled ? "Disable application" : "Enable application"}</button>
        <PackageActionBadge apps={[app]} action={app.enabled ? 'disable' : 'enable'} options={methodOptions} />
        <KeepAppData checked={keepData} disabled={!enabled} onChange={setKeepData} />
        <button className="button secondary app-action-destructive" disabled={!enabled} onClick={() => perform('uninstall')}><Trash2 size={15} />Uninstall from profile</button>
        <PackageActionBadge apps={[app]} action="uninstall" options={{ ...methodOptions, keepData }} />
      </div>
    </> : <p className="component-description">Select an application to open it, export its APK files or manage it in the selected profile.</p>}
    <div className="apps-action-group"><h3>Restore from computer</h3><button className="button secondary" disabled={!contextReady} onClick={() => useRestoreStore.getState().open()}><FolderOpen size={15} />Restore application<ActionIndicator /></button><p>Open a saved copy, verify it and install its APK/APKS into this profile.</p></div>
    {showResult && !action.batch && !launchResult && <div className={`apps-action-result ${action.status}`} role={action.status === 'error' ? 'alert' : 'status'} aria-live="polite">
      {busy && action.packageName !== app?.packageName && <strong>{action.packageName}</strong>}
      <p>{action.message}</p>
      {busy && action.action === 'export' && <>
        <progress aria-label="APK export progress" max={action.total || 1} value={action.total ? action.completed || 0 : undefined} />
        {action.total && <small>{action.completed || 0} / {action.total}{" APK files"}</small>}
        <button className="button secondary" onClick={() => void requestBackend({ type: 'apps.cancelAction' })}><X size={14} />Cancel export</button>
      </>}
      {action.status === 'success' && action.exportPath && <><code>{action.exportPath}</code><button className="button secondary" onClick={() => void requestBackend({ type: 'apps.openExport' })}><FolderOpen size={15} />Open export folder</button></>}
    </div>}
  </>
}
