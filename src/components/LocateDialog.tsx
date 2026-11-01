import { useEffect, useRef, useState } from 'react'
import { FolderOpen, Info, Search, X } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { IconButton } from './ui'

export function LocateDialog() {
  const { locateId, setLocateId, components, locate } = useAppStore()
  const [path, setPath] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false), [browsing, setBrowsing] = useState(false)
  const submitting = useRef(false), generation = useRef(0)
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const component = components.find(item => item.id === locateId)
  const adb = locateId === 'adb'
  useEffect(() => {
    if (locateId) {
      generation.current++; submitting.current = false; setPending(false); setBrowsing(false)
      const previousFocus = document.activeElement as HTMLElement | null
      setPath(''); setError(''); dialog.current?.showModal(); input.current?.focus()
      return () => { generation.current++; dialog.current?.close(); previousFocus?.focus() }
    }
  }, [locateId])
  async function browse(kind: 'folder' | 'adb-file') {
    const current = generation.current; setBrowsing(true)
    try { const location = await window.desktop?.locate(kind); if (location && current === generation.current) { setPath(location); setError('') } }
    catch { if (current === generation.current) setError("Could not open the picker. Enter the path below.") }
    finally { if (current === generation.current) setBrowsing(false) }
  }
  const close = () => { if (!submitting.current) setLocateId(null) }
  async function submit() {
    if (submitting.current || browsing || !locateId) return
    const selected = path.trim().replace(/^"([^"]+)"$/, '$1')
    if (!/^(?:[a-zA-Z]:[\\/]|\\\\[^\\]+\\[^\\]+)/.test(selected) || /[<>"|?*\x00-\x1f]/.test(selected) || selected.slice(2).includes(':')) { setError(adb ? "Enter the full path to adb.exe or its folder." : "Enter an absolute Windows folder path, such as C:\\Android\\platform-tools."); return }
    const current = generation.current; submitting.current = true; setPending(true); setError('')
    try { await locate(locateId, selected, message => { if (current === generation.current) setError(message) }) }
    finally { submitting.current = false; if (current === generation.current) setPending(false) }
  }
  return <dialog ref={dialog} className="locate-dialog" aria-labelledby="locate-title" onCancel={event => { event.preventDefault(); close() }} onClick={event => {
    if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close() }
  }}><form aria-busy={pending} onSubmit={event => { event.preventDefault(); void submit() }}>
    <div className="dialog-heading"><span className="dialog-icon"><FolderOpen size={22} /></span><IconButton label="Close manual location dialog" disabled={pending} onClick={close}><X size={17} /></IconButton></div>
    <h2 id="locate-title">{adb ? "Use existing ADB" : "Locate " + (component?.name ?? '')}</h2>
    <p>{adb ? "Choose adb.exe or its folder, or paste the full path below." : "Point to the folder containing your existing component."}</p>
    <label htmlFor="component-path">{adb ? "ADB file or folder" : "Component folder"}</label>
    <div className="path-input-row"><input ref={input} id="component-path" value={path} disabled={pending || browsing} onChange={event => { setPath(event.target.value); setError('') }} placeholder={adb ? 'C:\\Android\\platform-tools\\adb.exe' : 'C:\\Android\\platform-tools'} aria-invalid={!!error} aria-describedby={error ? 'path-error' : undefined} />{window.desktop && !adb && <button type="button" className="button secondary" disabled={pending || browsing} onClick={() => void browse('folder')}>Browse…</button>}</div>
    {window.desktop && adb && <div className="adb-pickers">
      <button type="button" className="button secondary" disabled={pending || browsing} onClick={() => void browse('adb-file')}>Choose adb.exe…</button>
      <button type="button" className="button secondary" disabled={pending || browsing} onClick={() => void browse('folder')}>Choose folder…</button>
    </div>}
    {error && <p id="path-error" role="alert" className="field-error">{error}</p>}
    <div className="dialog-note"><Info size={16} /><span>{adb ? "ADB Vault checks the version and remembers this copy for future connections." : locateId === 'geoip' ? "Choose a folder containing GeoLite2 / GeoIP2 Country or City and/or ASN .mmdb files. The databases are validated before this location is saved. Nothing is downloaded automatically." : "The component executable is checked before its location is saved. Select only a folder containing a tool you trust."}</span></div>
    <div className="dialog-footer"><button type="button" className="button secondary" disabled={pending} onClick={close}>Cancel</button><button type="submit" className="button primary" disabled={!path.trim() || pending || browsing}><Search size={14} />{pending ? adb ? "Checking ADB…" : "Checking folder…" : adb ? "Use this ADB" : "Use this folder"}</button></div>
  </form></dialog>
}
