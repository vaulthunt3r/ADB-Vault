import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Activity, AppWindow, Cable, Camera, ChevronDown, ClipboardList, FileDown, FileSearch, ListChecks, ListTodo, MonitorSmartphone, Moon, MoreVertical, RefreshCw, ScanLine, Settings2, SlidersHorizontal, Smartphone, Sun } from 'lucide-react'
import { isBusy, isReady, settledStatus } from '../../lib/components'
import { fittingToolbarActions, toolbarActions, toolbarConfig, type ToolbarActionId } from '../../lib/toolbar'
import { requestBackend } from '../../lib/backend'
import { useAppStore } from '../../store/useAppStore'
import { useAppearanceStore } from '../../store/useAppearanceStore'
import { readDeviceInfo, useConnectionStore } from '../../store/useConnectionStore'
import { useAppsStore } from '../../store/useAppsStore'
import { useApkInspectorStore } from '../../store/useApkInspectorStore'
import { useFilesStore } from '../../store/useFilesStore'
import { useHistoryStore } from '../../store/useHistoryStore'
import { useAndroidDiagnosticsStore, sameDiagnosticTarget } from '../../store/useAndroidDiagnosticsStore'
import { useToolbarStore } from '../../store/useToolbarStore'
import { useScreenStore } from '../../store/useScreenStore'
import { screenSessionMatchesDevice, type ScreenMode } from '../../../electron/screen-protocol'
import { DevicePowerDialog, usePowerBlocked } from '../DevicePowerActions'
import type { DeviceRecord } from '../../../electron/contracts'
import { usePhoneToolsStore } from '../../store/usePhoneToolsStore'
import { useRestoreStore } from '../../store/useRestoreStore'
import { useAppsOperations } from '../../lib/useAppsOperations'
import { openAppsBackup } from '../../lib/appPresets'
import { ToolbarActionIcon } from '../ToolbarActionIcon'
import { AppsProfilePicker } from '../AppsProfilePicker'
import { WorkspaceProgress } from './WorkspaceProgress'
import './toolbar.css'
import { Tooltip } from '../Tooltip'
import { ScreenSessionsDialog } from '../ScreenControls'

interface ToolbarAction { id: ToolbarActionId; label: string; hint: string; icon: ReactNode; disabled?: boolean; run: () => void }
function ToolbarButton({ action, labels }: { action: ToolbarAction; labels: boolean }) {
  return <Tooltip text={action.hint} disabled={action.disabled}>{id => <button className={`toolbar-card toolbar-action${labels ? " with-label" : ''}`} data-toolbar-action={action.id} aria-label={action.label} aria-describedby={id} disabled={action.disabled} onClick={action.run}>{action.icon}{labels && <span>{action.label}</span>}</button>}</Tooltip>
}
function positionPopover(node: HTMLDivElement | null, trigger: HTMLButtonElement) {
  if (!node) return
  const box = trigger.getBoundingClientRect()
  node.style.left = `${Math.max(8, Math.min(window.innerWidth - 320, box.right - 304))}px`
  node.style.top = `${box.bottom + 5}px`
}

export function TopBar() {
  const section = useAppStore(s => s.section)
  const localApks = useAppStore(s => s.section === 'apps' && s.appsView === 'apk')
  const installedAppsView = useAppStore(s => s.appsView === 'installed')
  const localBusy = useApkInspectorStore(s => s.before.status === 'loading')
  const components = useAppStore(s => s.components)
  const componentsBusy = useAppStore(s => s.componentPending || s.bulkBusy || s.components.some(c => isBusy(c.status)))
  const connection = useConnectionStore(), apps = useAppsStore(), diagnostic = useAndroidDiagnosticsStore()
  const toolbar = useToolbarStore()
  const { pinned, operationPosition, showDevice } = toolbarConfig(toolbar, section)
  const screenSessions = useScreenStore(s => s.sessions)
  const labels = useAppearanceStore(s => s.toolbarLabels)
  const blockedWithoutAdb = usePowerBlocked(false), blocked = blockedWithoutAdb || !connection.adbAvailable
  const appOperations = useAppsOperations()
  const [powerDialog, setPowerDialog] = useState<{ device: DeviceRecord; shutdown: boolean } | null>(null)
  const [windowsOpen, setWindowsOpen] = useState(false)
  const [pending, setPending] = useState(false), submitting = useRef(false)
  const device = connection.devices.find(item => item.id === connection.activeDeviceId) ?? connection.devices.find(item => item.id === connection.selectedDeviceId)
  const connected = device?.status === 'connected'
  const available = connection.devices.filter(item => item.status === 'connected')
  const menu = useRef<HTMLDivElement>(null), deviceMenu = useRef<HTMLDivElement>(null)
  const menuId = useId(), deviceMenuId = useId()
  const [menuOpen, setMenuOpen] = useState(false), [deviceMenuOpen, setDeviceMenuOpen] = useState(false)
  const row = useRef<HTMLDivElement>(null), measurements = useRef<HTMLDivElement>(null)
  const [visibleCount, setVisibleCount] = useState(0)
  const scrcpy = components.find(component => component.id === 'scrcpy')
  const canMirror = !!scrcpy?.location && (isReady(settledStatus(scrcpy)) || settledStatus(scrcpy) === 'Update available')
  const fastboot = components.find(component => component.id === 'fastboot')
  const canFastboot = !!fastboot?.location && ['Installed', 'Detected', 'Update available'].includes(fastboot.status)
  const extra = (id: ToolbarActionId, run: () => void, disabled = false, hint?: string): ToolbarAction => {
    const metadata = toolbarActions.find(action => action.id === id)!
    return { id, label: metadata.label, hint: hint || metadata.description, icon: <ToolbarActionIcon id={id} />, disabled, run }
  }
  const screenAction = async (action: 'open' | 'screenshot' | 'wake' | 'sleep') => {
    if (!device || !connected || blocked || submitting.current) return
    submitting.current = true; setPending(true)
    try { await requestBackend({ type: 'connection.screen', id: device.id, serial: device.serial, transportId: device.transportId, action }) }
    finally { submitting.current = false; setPending(false) }
  }
  const openDiagnostics = (kind: 'logcat' | 'bugreport') => { if (device && connected) diagnostic.open(kind, device) }
  const screenApplication = section === 'apps' && installedAppsView && apps.status === 'ready' && apps.deviceId === device?.id && apps.userId !== null
    ? apps.apps.find(app => app.packageName === apps.selectedPackage && app.userId === apps.userId) : undefined
  const openScreenOptions = (mode?: ScreenMode) => {
    if (device && connected && !blocked && canMirror) useScreenStore.getState().open(device, undefined, mode,
      mode !== 'camera' && screenApplication ? { packageName: screenApplication.packageName, label: screenApplication.label, userId: screenApplication.userId } : undefined)
  }
  const cameraSession = device && screenSessions.find(s => s.mode === 'camera' && screenSessionMatchesDevice(s, device) && !s.stopping)
  const openSettings = () => {
    useAppStore.setState({ settingsTab: 'appearance' }); useAppStore.getState().setSection('settings')
    requestAnimationFrame(() => { const editor = document.getElementById('status-bar-settings'); editor?.scrollIntoView({ block: 'start' }); editor?.focus({ preventScroll: true }) })
  }
  const actions: ToolbarAction[] = [
    ...(section === 'components' ? [{ id: 'workspace' as const, label: "Check components", hint: "Check components", icon: <ListChecks />, disabled: componentsBusy, run: () => { void useAppStore.getState().detectAll() } }]
      : localApks ? [{ id: 'workspace' as const, label: "Open APK", hint: "Choose a local APK to inspect in slot A.", icon: <FileSearch />, disabled: localBusy, run: () => { void requestBackend({ type: 'inspector.open', slot: 'before' }) } }]
      : section === 'apps' ? [{ id: 'workspace' as const, label: "Refresh applications", hint: "Refresh applications", icon: <RefreshCw />, disabled: blocked || !connected || pending, run: () => { if (device) void apps.refresh(device.id) } }] : []),
    { id: 'screenshot', label: "Screenshot", hint: pending ? "Saving screenshot or opening screen…" : "Save the selected phone screen as a PNG image on this computer.", icon: <ScanLine />, disabled: !connected || blocked || pending, run: () => { void screenAction('screenshot') } },
    { id: 'mirror', label: "Mirror screen", hint: canMirror ? "View and control the selected phone in scrcpy." : "Install or locate scrcpy in Components first.", icon: <MonitorSmartphone />, disabled: !connected || blocked || pending || !canMirror, run: () => { void screenAction('open') } },
    { id: 'screenOptions', label: "Screen & recording", hint: "Choose capture mode, sound and recording options.", icon: <Settings2 />, disabled: !connected || blocked || pending || !canMirror, run: () => openScreenOptions() },
    { id: 'virtualDisplay', label: "Virtual display", hint: screenApplication ? `Open ${screenApplication.label} in a separate Android window.` : "Choose an application for a separate Android window.", icon: <AppWindow />, disabled: !connected || blocked || pending || !canMirror, run: () => openScreenOptions('virtual') },
    extra('openWindows', () => setWindowsOpen(true), false, screenSessions.length ? `${screenSessions.length} open. Configure touch controls or close a running window.` : "Open a virtual display first to configure touch controls."),
    { id: 'camera', label: "Camera", hint: "Choose a phone camera and preview or recording options.", icon: <Camera />, disabled: !connected || blocked || pending || !canMirror, run: () => openScreenOptions('camera') },
    { id: 'cameraControls', label: "Camera controls", hint: cameraSession ? "Show live controls for the selected phone’s camera." : "Start a camera preview on the selected phone first.", icon: <SlidersHorizontal />, disabled: !connected || !cameraSession, run: () => { if (cameraSession) void requestBackend({ type: 'connection.cameraPanel', sessionId: cameraSession.id }) } },
    { id: 'wake', label: "Wake screen", hint: "Wake the selected phone’s screen.", icon: <Sun />, disabled: !connected || blocked || pending, run: () => { void screenAction('wake') } },
    { id: 'sleep', label: "Sleep screen", hint: "Put the selected phone’s screen to sleep.", icon: <Moon />, disabled: !connected || blocked || pending, run: () => { void screenAction('sleep') } },
    ...(['logcat', 'bugreport'] as const).map(kind => ({ id: kind, label: kind === 'logcat' ? "Android logs" : "Bug report", hint: kind === 'logcat' ? "Open Android logs (Logcat)." : "Open diagnostic report options.", icon: kind === 'logcat' ? <ClipboardList /> : <FileDown />, disabled: !connected || (blocked && !(diagnostic.job?.status === 'running' && diagnostic.job.kind === kind && sameDiagnosticTarget(diagnostic.job.target, device))), run: () => openDiagnostics(kind) })),
    { id: 'tasks', label: "File tasks", hint: "Open the current file operation queue.", icon: <ListTodo />, run: () => { useHistoryStore.setState({ filesSession: null }); useFilesStore.setState({ taskPanel: true }) } },
    { id: 'activity', label: "Activity", hint: "Open the current session history.", icon: <Activity />, run: () => useAppStore.getState().openActivity() },
    { id: 'connection', label: "Connection", hint: "Open device connections.", icon: <Cable />, run: () => useAppStore.getState().setSection('connection') },
    ...(['restart', 'powerOff'] as const).map(id => extra(id, () => { if (device && connected) setPowerDialog({ device: structuredClone(device), shutdown: id === 'powerOff' }) }, !connected || blocked)),
    ...(['clipboard', 'contacts', 'calls', 'sms'] as const).map(id => extra(id, () => usePhoneToolsStore.getState().open(id, device), id !== 'clipboard' && !connected)),
    extra('root', () => { if (device) void requestBackend({ type: 'connection.root', id: device.id, requestAccess: true }) }, !connected || connection.busy || !connection.adbAvailable || device?.root?.status === 'checking'),
    extra('deviceInfo', () => { if (device) void readDeviceInfo(device.id) }, !connected || connection.busy || !connection.adbAvailable || device?.info?.status === 'loading'),
    extra('reconnect', () => { if (device) void connection.reconnect(device.id) }, !device || connection.busy || !connection.adbAvailable),
    extra('disconnect', () => { if (device) void connection.disconnect(device.id) }, !connected || connection.busy || !device?.canDetach, device?.method === 'USB' && !device.canDetach ? "This ADB backend cannot detach a single USB device. Unplug the cable to disconnect it." : undefined),
    extra('findDevices', () => { useAppStore.getState().setSection('connection'); void connection.scan() }, connection.manualScanning || connection.busy || !connection.adbAvailable),
    extra('fastboot', () => { useAppStore.getState().setSection('connection'); void requestBackend({ type: 'connection.fastboot.scan' }) }, !canFastboot || blockedWithoutAdb, !canFastboot ? "Install or locate Fastboot in Components first." : undefined),
    extra('localApks', () => useAppStore.getState().openLocalApks()),
    extra('install', () => useRestoreStore.getState().open('install'), appOperations.running || appOperations.blocked),
    extra('backup', () => openAppsBackup('marked', true), appOperations.running || appOperations.blocked),
    extra('restore', () => useRestoreStore.getState().open(), appOperations.running || appOperations.blocked),
  ]
  const chosen = pinned.flatMap(id => actions.find(action => action.id === id) ?? [])
  const metricKey = JSON.stringify([labels, chosen.map(action => [action.id, action.label])])
  useLayoutEffect(() => {
    const lane = row.current, shelf = measurements.current
    if (!lane || !shelf) return
    const measure = () => {
      const gap = parseFloat(getComputedStyle(lane).columnGap) || 0
      const widths = Array.from(shelf.children).map(node => node.getBoundingClientRect().width)
      setVisibleCount(fittingToolbarActions(widths, lane.clientWidth, gap))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(lane); observer.observe(shelf)
    let mounted = true
    void document.fonts.ready.then(() => { if (mounted) measure() })
    return () => { mounted = false; observer.disconnect() }
  }, [metricKey])
  const shown = chosen.slice(0, visibleCount), hidden = chosen.slice(visibleCount)
  const unpinned = actions.filter(action => !pinned.includes(action.id))
  const hasProfile = section === 'apps' && !localApks && !!connection.activeDeviceId && apps.deviceId === connection.activeDeviceId && apps.profiles.length > 0
  const profile = hasProfile ? <AppsProfilePicker deviceId={connection.activeDeviceId} /> : null
  function menuAction(action: ToolbarAction) {
    return <button type="button" key={action.id} data-overflow-action={action.id} className="toolbar-menu-action" disabled={action.disabled} title={action.hint} onClick={() => { menu.current?.hidePopover(); action.run() }}>{action.icon}<span>{action.label}</span></button>
  }
  return <><div className="topbar unified-toolbar" data-operation-position={operationPosition} aria-label="Workspace toolbar">
    {showDevice && <button type="button" className="toolbar-card toolbar-device" aria-label="Select phone" aria-haspopup="dialog" aria-controls={deviceMenuId} aria-expanded={deviceMenuOpen} popoverTarget={deviceMenuId} title={device ? `${device.name}\n${device.status} · ${device.method}\n${device.serial}` : "Connect or select a phone"} onClick={event => positionPopover(deviceMenu.current, event.currentTarget)}>
      <Smartphone /><span className="toolbar-device-copy"><strong>{device?.name || "No phone selected"}</strong><small><i className={connected ? 'connected' : ''} />{device ? `${connected ? "Connected" : device.status} · ${device.method}` : "Open Connection"}</small></span><ChevronDown />
    </button>}
    {hasProfile && <div className="toolbar-profile-slot">{profile}</div>}
    <div className="toolbar-action-lane" ref={row} aria-label="Quick actions">
      {shown.map(action => <ToolbarButton key={action.id} action={action} labels={labels} />)}
    </div>
    <WorkspaceProgress />
    <button type="button" className="toolbar-card toolbar-more" aria-label="More toolbar actions" title="More toolbar actions" aria-haspopup="dialog" aria-controls={menuId} aria-expanded={menuOpen} popoverTarget={menuId} onClick={event => positionPopover(menu.current, event.currentTarget)}><MoreVertical /></button>
    <div className="toolbar-measurements" aria-hidden="true" inert ref={measurements}>{chosen.map(action => <span key={action.id} className={`toolbar-card toolbar-action${labels ? " with-label" : ''}`}>{action.icon}{labels && <span>{action.label}</span>}</span>)}</div>
    <div popover="auto" id={deviceMenuId} ref={deviceMenu} className="toolbar-popover" role="dialog" aria-label="Select a phone" onToggle={event => setDeviceMenuOpen(event.newState === 'open')}><strong>Selected phone</strong>
      {available.map(item => <button className="toolbar-menu-action" key={item.id} aria-pressed={item.id === connection.activeDeviceId} disabled={blocked || pending} onClick={() => { deviceMenu.current?.hidePopover(); connection.selectDevice(item.id) }}><Smartphone /><span>{item.name}<small>{item.method} · {item.serial}</small></span></button>)}
      {!available.length && <p>No connected phones.</p>}
      <button className="toolbar-menu-action" onClick={() => { deviceMenu.current?.hidePopover(); useAppStore.getState().setSection('connection') }}><Cable /><span>Open Connection</span></button>
    </div>
    <div popover="auto" id={menuId} ref={menu} className="toolbar-popover" role="dialog" aria-label="Toolbar actions" onToggle={event => setMenuOpen(event.newState === 'open')}>
      {!showDevice && <button type="button" className="toolbar-menu-action" aria-label="Select phone" aria-haspopup="dialog" aria-controls={deviceMenuId} aria-expanded={deviceMenuOpen} onClick={event => { const trigger = event.currentTarget; positionPopover(deviceMenu.current, trigger); menu.current?.hidePopover(); deviceMenu.current?.showPopover() }}><Smartphone /><span>Select phone<small>{device ? `${device.name} · ${connected ? "Connected" : device.status} · ${device.method}` : "No phone selected"}</small></span><ChevronDown /></button>}
      {hasProfile && <div className="toolbar-profile-overflow">{profile}</div>}
      {hidden.length > 0 && <div className="toolbar-menu-group" aria-label="Pinned actions">{hidden.map(menuAction)}</div>}
      {unpinned.length > 0 && <div className="toolbar-menu-group" aria-label="Other actions">{unpinned.map(menuAction)}</div>}
      <button className="toolbar-menu-action toolbar-customize" onClick={() => { menu.current?.hidePopover(); openSettings() }}><Settings2 /><span>Customize status bar…</span></button>
    </div>
  </div>{powerDialog && <DevicePowerDialog device={powerDialog.device} shutdown={powerDialog.shutdown} close={() => setPowerDialog(null)} />}{windowsOpen && <ScreenSessionsDialog close={() => setWindowsOpen(false)} />}</>
}
