import { AndroidDiagnosticActions } from './AndroidDiagnostics'
import { PhoneToolActions } from './PhoneTools'
import { DeviceInfoPanel } from './DeviceInfoPanel'
import { HintButton } from './Tooltip'
import { FastbootInspector } from './FastbootInspector'
import { useFastbootStore } from '../store/useFastbootStore'
import { DevicePowerActions } from './DevicePowerActions'
import { DeviceScreenActions } from './DeviceScreenActions'
import { useAppStore } from '../store/useAppStore'
import { RefreshCw, Smartphone, Unplug, ShieldCheck } from 'lucide-react'
import { LatticeLoader } from './operation-chip/OperationChip'
import type { DeviceStatus } from '../../electron/contracts'
import { DeviceRootBadge, RootAccessNote, useDetectDeviceRoot } from './DeviceRootStatus'
import { requestBackend } from '../lib/backend'
import { readDeviceInfo } from '../store/useConnectionStore'
import { useConnectionStore } from '../store/useConnectionStore'
export function ConnectionStatus({ status }: { status: DeviceStatus }) {
  return <span className={`status-badge ${status === 'connected' ? 'success' : status === 'unauthorized' ? 'warning' : status === 'offline' ? 'error' : ['recovery', 'sideload', 'bootloader'].includes(status) ? 'info' : 'neutral'}`}>{status[0].toUpperCase() + status.slice(1)}</span>
}
export function ConnectionInspector() {
  const state = useConnectionStore()
  const tab = useAppStore(s => s.inspectorTab)
  const device = state.devices.find(d => d.id === state.selectedDeviceId)
  const fastboot = useFastbootStore(s => s.selectedSerial)
  useDetectDeviceRoot(fastboot ? undefined : device)
  if (fastboot) return <FastbootInspector />
  return <><div className="inspector-section-label"><span className="eyebrow">{tab === 'details' ? "CONNECTION DETAILS" : "CONNECTION ACTIONS"}</span></div><div className="section-inspector-icon"><Smartphone size={25} /></div>{device ? <><h2 className="section-inspector-title">{device.name}</h2><div className="connection-statuses"><ConnectionStatus status={device.status} /><DeviceRootBadge device={device} /></div><p className="component-description">{device.status === 'unauthorized' ? "Unlock the phone and allow USB debugging for this computer." : device.status === 'offline' ? "The transport is present but ADB cannot communicate with the device." : device.status === 'disconnected' ? "Reconnect the cable or use the current wireless connection address." : "Device state reported by ADB."}</p>{tab === 'details' && <><RootAccessNote device={device} /><dl className="metadata">{[["Serial", device.serial], ["Android", device.android], ["Connection", device.method], ["Address", device.endpoint], ["Last seen", new Date(device.lastSeen).toLocaleString('en-US')]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><DeviceInfoPanel device={device} /></>}{tab === 'actions' && <><div className="recovery-actions">
        <DevicePowerActions key={device.id} device={device} />
        <PhoneToolActions device={device} />
        <AndroidDiagnosticActions device={device} /><DeviceScreenActions key={`screen-${device.id}`} device={device} />
        <HintButton hint="Check existing ADB or su root access. A root manager on the phone may ask for permission; this does not root the phone." className="button secondary" disabled={state.busy || !state.adbAvailable || device.status !== 'connected' || device.root?.status === 'checking'} onClick={() => void requestBackend({ type: 'connection.root', id: device.id, requestAccess: true })}>{device.root?.status === 'checking' ? <LatticeLoader /> : <ShieldCheck size={14} />}{device.root?.status === 'checking' ? "Checking root access…" : "Check root access"}</HintButton>
        <HintButton hint="Read the selected phone’s model, Android build, security patch and supported architectures again." className="button secondary" disabled={state.busy || !state.adbAvailable || device.status !== 'connected' || device.info?.status === 'loading'} onClick={() => void readDeviceInfo(device.id)}>{device.info?.status === 'loading' ? <LatticeLoader /> : <RefreshCw size={14} />}{device.info?.status === 'loading' ? "Reading device information…" : "Refresh device information"}</HintButton>
<HintButton hint="Retry the selected device’s ADB connection. Wireless debugging may require its current address." className="button primary" disabled={state.busy || !state.adbAvailable} onClick={() => void state.reconnect(device.id)}><RefreshCw size={14} />Reconnect device</HintButton><HintButton hint={device.method === 'USB' && !device.canDetach ? "This ADB backend cannot detach a single USB device. Unplug the cable to disconnect it." : "Disconnect the selected device from ADB. Saved connection history is kept."} className="button secondary" disabled={state.busy || !device.canDetach || device.status !== 'connected'} onClick={() => void state.disconnect(device.id)}><Unplug size={14} />Disconnect device</HintButton></div>{device.method === 'USB' && !device.canDetach && <p className="component-description">This ADB backend cannot detach a single USB device. Unplug its cable to disconnect.</p>}<RootAccessNote device={device} /></>}</> : <div className="inspector-empty"><h3>No device selected</h3><p>Connect a phone and select it to inspect the real device state.</p>{tab === 'actions' && <div className="recovery-actions"><PhoneToolActions /></div>}</div>}</>
}
