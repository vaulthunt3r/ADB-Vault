import { LoaderCircle, Search, Usb } from 'lucide-react'
import { useFastbootStore } from '../store/useFastbootStore'
import { useAppStore } from '../store/useAppStore'
import { requestBackend } from '../lib/backend'
import { usePowerBlocked } from './DevicePowerActions'
import { FastbootHelp } from './FastbootHelp'

export function FastbootDevices() {
  const state = useFastbootStore()
  const component = useAppStore(s => s.components.find(c => c.id === 'fastboot'))
  const available = !!component?.location && ['Installed', 'Detected', 'Update available'].includes(component.status)
  const blocked = usePowerBlocked(false)
  return <article className="connection-method" aria-labelledby="fastboot-heading">
    <div className="method-intro"><div className="method-heading"><Usb size={18} /><h2 id="fastboot-heading">Fastboot · USB</h2><FastbootHelp /></div><p>Find phones already in Fastboot to read information or return to Android.</p></div>
    <div className="method-controls">
      <div className="fastboot-search-action"><button className="button secondary" disabled={!available || blocked} title={!available ? "Install or locate Fastboot in Components first." : "Search USB Fastboot devices without changing ADB connections."} onClick={() => void requestBackend({ type: 'connection.fastboot.scan' })}>{state.busy ? <LoaderCircle size={14} className="spin" /> : <Search size={14} />}Find Fastboot devices</button></div>
      {state.devices.map(device => <div className={`usb-live-device fastboot-device ${state.selectedSerial === device.serial ? 'selected' : ''}`} key={device.serial}><button className="device-select" aria-label={`Select Fastboot ${device.serial}`} aria-pressed={state.selectedSerial === device.serial} disabled={blocked} onClick={() => {
        useFastbootStore.setState({ selectedSerial: device.serial })
        useAppStore.getState().showInspector('details')
        if (!device.inspectedAt) void requestBackend({ type: 'connection.fastboot.inspect', serial: device.serial, token: device.token })
      }}><Usb size={20} /><span><strong>{device.fields.product || device.serial}</strong><span>{device.serial}</span></span></button><span className="status-badge info">{device.fields['is-userspace'] === 'yes' ? "Fastbootd" : device.fields['is-userspace'] === 'no' ? "Bootloader" : "Fastboot"}</span></div>)}
      {state.error ? <p className="field-error" role="alert">{state.error}</p> : state.message && <p className="connection-field-hint" role="status">{state.message}</p>}
      {state.checkedAt && <p className="connection-field-hint">{"Last search: "}{new Date(state.checkedAt).toLocaleTimeString('en-US')}{" · Refresh with Find Fastboot devices"}</p>}
    </div>
  </article>
}
