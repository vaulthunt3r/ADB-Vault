import { Cable, CircleHelp, LoaderCircle, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useDeviceStore } from '../store/useDeviceStore'
import type { ConnectionStatus } from '../lib/deviceData'

export function DeviceStatus({ status }: { status: ConnectionStatus }) {
  return <span className={`status-badge ${status === 'connected' ? 'success' : status === 'connecting' ? 'active' : ['failed', 'offline'].includes(status) ? 'error' : status === 'unauthorized' ? 'warning' : 'neutral'}`}>{status === 'connecting' && <LoaderCircle size={12} className="spin" />}<span>{status[0].toUpperCase() + status.slice(1)}</span></span>
}
export function DemoFootnote({ children = 'All actions are simulated. No real device or computer files are changed.' }: { children?: ReactNode }) {
  return <div className="workspace-footnote"><CircleHelp size={14} /><span>{children}</span></div>
}
export function DeviceRequired() {
  const setSection = useAppStore(state => state.setSection)
  const devices = useDeviceStore(state => state.devices)
  const selectDevice = useDeviceStore(state => state.selectDevice)
  const connected = devices.filter(device => device.status === 'connected')
  return <div className="device-required"><Cable size={34} strokeWidth={1.4} /><h2>{connected.length ? "Choose an active device" : "Connect a device to get started"}</h2><p>Apps and files are available after a simulated connection.</p>{connected.length ? connected.map(device => <button className="button secondary" key={device.id} onClick={() => selectDevice(device.id)}>{"Use "}{device.name}</button>) : <button className="button primary" onClick={() => setSection('connection')}>Open Connection</button>}</div>
}
export function OperationFeedback({ scope }: { scope: 'apps' | 'files' }) {
  const { operation, operationError, appFailure, fileFailure, setFailure } = useDeviceStore()
  return <><div className="demo-result-control"><span className="demo-pill">DEMO</span><label htmlFor={`${scope}-result`}>Operation result</label><select id={`${scope}-result`} value={(scope === 'apps' ? appFailure : fileFailure) ? 'failure' : 'success'} disabled={!!operation} onChange={event => setFailure(scope, event.target.value === 'failure')}><option value="success">Success</option><option value="failure">Simulate failure</option></select></div>{operation?.scope === scope && <div className="operation-feedback" role="status"><LoaderCircle size={15} className="spin" /><span>{operation.label}</span><progress aria-label="Operation progress" value={operation.progress} max={100} /><span>{operation.progress}%</span></div>}{operationError?.scope === scope && <div role="alert" className="operation-error"><TriangleAlert size={16} /><span>{operationError.message}</span></div>}</>
}
