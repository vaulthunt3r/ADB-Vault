import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { requestBackend } from '../lib/backend'
import { useConnectionStore } from '../store/useConnectionStore'

export function ReconnectDeviceDialog({ close, onUsed }: { close: () => void; onUsed?: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const started = useRef(false), submitting = useRef(false)
  const [pending, setPending] = useState(true), [error, setError] = useState(''), [selected, setSelected] = useState('')
  const discovery = useConnectionStore(s => s.discovery)
  const candidate = discovery?.candidates.find(c => c.token === selected)
  const search = async () => {
    submitting.current = true; setPending(true); setSelected(''); setError('')
    try {
      if (await requestBackend({ type: 'connection.find' })) {
        const candidates = useConnectionStore.getState().discovery?.candidates || []
        if (candidates.length === 1) setSelected(candidates[0].token)
      } else setError("Search failed. Check ADB and try again.")
    } finally { submitting.current = false; setPending(false) }
  }
  useEffect(() => {
    if (!returnFocus.current) returnFocus.current = document.activeElement as HTMLElement | null
    const element = dialog.current
    element?.showModal()
    if (!started.current) { started.current = true; void search() }
    return () => { element?.close(); if (returnFocus.current?.isConnected) returnFocus.current.focus() }
  }, [])
  return <dialog ref={dialog} className="locate-dialog" aria-labelledby="reconnect-title" onCancel={e => { e.preventDefault(); if (!submitting.current) close() }}>
    <h2 id="reconnect-title">Find devices</h2>
    <p>{pending ? "Checking known devices and current wireless addresses…" : discovery?.message || ''}</p>
    {!pending && !error && <div className="reconnect-candidates">{discovery?.candidates.map(c => <label className="reconnect-candidate" key={c.token}><input type="radio" name="reconnect-device" checked={selected === c.token} onChange={() => setSelected(c.token)} /><span><strong>{c.name}</strong><span>{c.method} · {c.address}</span><span>{c.connected ? "Already connected — use this device" : "Available on the network — connect and verify identity"}</span></span></label>)}</div>}
    {error && <p role="alert" className="field-error">{error}</p>}
    <div className="dialog-footer"><button className="button secondary" disabled={pending} onClick={close}>Cancel</button><button className="button secondary" disabled={pending} onClick={() => void search()}><RefreshCw size={14} />Search again</button><button className="button primary" disabled={pending || !candidate || !!error} onClick={async () => {
      if (!candidate || submitting.current) return
      submitting.current = true; setPending(true); setError('')
      try {
        if (await requestBackend({ type: 'connection.confirmReconnect', token: candidate.token })) {
          useConnectionStore.setState({ selectedDeviceId: useConnectionStore.getState().activeDeviceId })
          onUsed?.()
          close()
        }
        else setError(useConnectionStore.getState().error || "Could not use this result. Search again; the address may have changed.")
      } finally { submitting.current = false; setPending(false) }
    }}>{candidate?.connected ? "Use device" : "Connect device"}</button></div>
  </dialog>
}
