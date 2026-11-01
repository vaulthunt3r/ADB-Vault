import { useEffect, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { DeviceRecord } from '../../electron/contracts'
import { useConnectionStore } from '../store/useConnectionStore'

export function ForgetDeviceDialog({ device, close }: { device: DeviceRecord; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const submitting = useRef(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const { devices, busy, forget } = useConnectionStore()
  const current = devices.find(item => item.id === device.id)
  const canForget = !!current?.known && ['disconnected', 'offline'].includes(current.status)
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    const element = dialog.current
    element?.showModal(); cancel.current?.focus()
    return () => { element?.close(); if (previousFocus?.isConnected) previousFocus.focus() }
  }, [])
  return <dialog ref={dialog} className="locate-dialog" aria-labelledby="forget-device-title" aria-describedby="forget-device-description" onCancel={event => { event.preventDefault(); if (!submitting.current) close() }}>
    <form onSubmit={async event => {
      event.preventDefault()
      if (submitting.current || busy || !canForget) return
      submitting.current = true; setPending(true); setError('')
      try {
        if (await forget(device.id)) close()
        else setError("Could not remove this device. Try again; details are in Activity.")
      } finally { submitting.current = false; setPending(false) }
    }}>
      <div className="dialog-heading"><span className="dialog-icon"><Trash2 size={22} /></span></div>
      <h2 id="forget-device-title">{"Forget "}{device.name}?</h2>
      <p className="forget-device-address">{device.method} · {device.endpoint || device.serial}</p>
      <p id="forget-device-description">Remove this entry from Known devices in ADB Vault? Phone pairing and USB debugging authorization will remain unchanged.</p>
      {!canForget && !pending && <p role="status" className="field-error">This entry is no longer available to forget. If the device reconnected, disconnect it first.</p>}
      {error && <p role="alert" className="field-error">{error}</p>}
      <div className="dialog-footer"><button ref={cancel} type="button" className="button secondary" disabled={pending} onClick={close}>Cancel</button><button type="submit" className="button primary" disabled={pending || busy || !canForget}><Trash2 size={14} />{pending ? "Forgetting…" : "Forget device"}</button></div>
    </form>
  </dialog>
}
