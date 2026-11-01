import { fileSourceLabel } from '../../electron/file-locations'
import { useEffect, useRef, useState } from 'react'
import { fileActionLabel, nameProblem, type FileClipboardSelection, type FileAction, type FileEntry, type FileLocation } from '../../electron/files-protocol'
import { filesRequest, useFilesStore } from '../store/useFilesStore'
import { useConnectionStore } from '../store/useConnectionStore'
import { BadgeDialog } from './BadgeDialog'
import { permissionSummary } from '../lib/filePermissions'
import { FilePermissionsHelp } from './FilePermissionsHelp'

export interface FilePrompt { clipboard?: FileClipboardSelection; action: FileAction; source: FileLocation; destination?: FileLocation; entries: FileEntry[]; siblings: FileEntry[] }
export function FileOperationDialog({ prompt: p, close }: { prompt: FilePrompt; close: () => void }) {
  const multiple = p.entries.length > 1, renaming = p.action === 'rename', naming = ['rename', 'create', 'mkdir'].includes(p.action)
  const transfer = p.action === 'copy' || p.action === 'move'
  const devices = useConnectionStore(s => s.devices)
  const sourceLabel = (location: FileLocation) => location.kind === 'device' ? devices.find(d => d.id === location.id && d.serial === location.serial)?.name || fileSourceLabel(location) : fileSourceLabel(location)
  const [destinationPath, setDestinationPath] = useState(p.destination?.path || '')
  const destinationInput = useRef<HTMLInputElement>(null), submitting = useRef(false)
  useEffect(() => { if (transfer) { destinationInput.current?.focus(); destinationInput.current?.select() } }, [transfer])
  const [name, setName] = useState(renaming && !multiple ? p.entries[0].name : '{name}{ext}'), [find, setFind] = useState(''), [replace, setReplace] = useState(''), [extension, setExtension] = useState(''), [changeExtension, setChangeExtension] = useState(false)
  const commonMode = p.entries[0]?.mode
  const [mode, setMode] = useState(commonMode && /^[0-7]{3}$/.test(commonMode) && p.entries.every(e => e.mode === commonMode) ? commonMode : p.entries.length && p.entries.every(e => e.kind === 'directory') ? '755' : '644'), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const computed = p.entries.map((e, n) => {
    const dot = e.kind === 'directory' ? -1 : e.name.lastIndexOf('.'), ext = dot > 0 ? e.name.slice(dot) : '', stem = ext ? e.name.slice(0, -ext.length) : e.name
    let next = multiple ? name.replaceAll('{name}', stem).replaceAll('{ext}', changeExtension && e.kind === 'file' ? extension ? '.' + extension.replace(/^\./, '') : '' : ext).replaceAll('{n}', String(n + 1)) : name
    if (find) next = next.split(find).join(replace)
    const parent = e.path.slice(0, e.path.length - e.name.length), normalize = (s: string) => p.source.kind === 'local' ? s.toLowerCase() : s
    const problem = nameProblem(next, p.source.kind === 'local') || (p.siblings.some(s => normalize(s.path) === normalize(parent + next) && s.path !== e.path) ? "Destination exists" : null)
    return { ...e, next, problem, target: normalize(parent + next) }
  })
  const duplicates = new Set(computed.filter((e, n) => computed.some((o, j) => j !== n && o.target === e.target)).map(e => e.target))
  const invalid = renaming ? computed.some(e => e.problem || duplicates.has(e.target)) : naming ? nameProblem(name, p.source.kind === 'local') || name === '{name}{ext}' : p.action === 'chmod' ? !/^[0-7]{3}$/.test(mode) : transfer ? !destinationPath.trim() : false
  async function submit() {
    if (invalid || submitting.current) return
    submitting.current = true; setBusy(true); setError('')
    try {
      const items = ['mkdir', 'create'].includes(p.action) ? [{ path: p.source.path, fingerprint: '', name }] : computed.map(e => ({ path: e.path, fingerprint: e.fingerprint, ...(renaming ? { name: e.next } : {}) }))
      const destination = p.destination ? { ...p.destination, path: destinationPath } : undefined
      if (p.clipboard && destination) {
        await filesRequest({ type: 'files.clipboard.paste', token: p.clipboard.token, destination, confirmed: true })
        if (p.clipboard.mode === 'move' && useFilesStore.getState().clipboard?.token === p.clipboard.token) useFilesStore.setState({ clipboard: undefined })
      } else await filesRequest({ type: 'files.enqueue', plan: { action: p.action, source: p.source, destination, items, conflict: 'ask', confirmed: true, ...(p.action === 'chmod' ? { mode } : {}) } })
      close()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { submitting.current = false; setBusy(false) }
  }
  return <BadgeDialog title={`${multiple && renaming ? "Batch rename" : fileActionLabel[p.action]}${naming || p.action === 'chmod' ? '' : ` · ${p.entries.length} ${multiple ? 'objects' : 'object'}`}`} close={close} closeDisabled={busy} closeLabel={transfer ? "Cancel" : "Close"} className="file-operation-dialog" footer={<button className="button primary" disabled={!!invalid || busy} onClick={() => void submit()}>{busy ? "Adding task…" : fileActionLabel[p.action]}</button>}>
    <dl className="file-operation-context"><dt>{transfer ? "From" : "Location"}</dt><dd title={fileSourceLabel(p.source)}>{p.clipboard && p.clipboard.groups.length > 1 ? `Windows clipboard · ${p.clipboard.groups.length} source folders` : `${sourceLabel(p.source)} · ${transfer && !multiple ? p.entries[0]?.path : p.source.path}`}</dd></dl>
    {p.destination && <label className="file-field file-destination-field">{"Destination folder · "}{sourceLabel({ ...p.destination, path: destinationPath })}<input ref={destinationInput} aria-label="Destination folder" value={destinationPath} disabled={busy} spellCheck={false} onChange={e => { setDestinationPath(e.target.value); setError('') }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void submit() } }} /></label>}
    {p.action === 'delete' && <p className="file-error">Permanently deletes the selected objects and their contents. They will not go to the Recycle Bin. This cannot be undone.</p>}
    {p.action === 'move' && <p className="file-hint">Originals are removed after the complete copy has been verified. Completed changes are kept if the task is stopped.</p>}
    {naming && <label className="file-field">{multiple && renaming ? "Name pattern" : "Name"}<input aria-label={multiple && renaming ? "Name pattern" : "New name"} value={name === '{name}{ext}' && !renaming ? '' : name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !invalid) void submit() }} /></label>}
    {multiple && renaming && <><p className="file-hint">{"{name}"}{" — name without extension · "}{"{ext}"}{" — extension · "}{"{n}"}{" — counter"}</p><div className="file-field-row"><label className="file-field">Find<input value={find} onChange={e => setFind(e.target.value)} /></label><label className="file-field">Replace with<input value={replace} onChange={e => setReplace(e.target.value)} /></label></div><label className="file-field"><span><input type="checkbox" checked={changeExtension} onChange={e => setChangeExtension(e.target.checked)} />Change file extensions</span>{changeExtension && <input aria-label="New extension" placeholder="e.g. jpg (empty removes extension)" value={extension} onChange={e => setExtension(e.target.value)} />}</label></>}
    {p.action === 'chmod' && <><label className="file-field">Permissions (octal)<input aria-label="Permissions" aria-describedby="file-permissions-help" title={permissionSummary(mode, p.entries.every(e => e.kind === 'directory'))} value={mode} maxLength={3} onChange={e => setMode(e.target.value)} /></label><FilePermissionsHelp mode={mode} folders={p.entries.every(e => e.kind === 'directory')} /><p className="file-hint">Applies only to selected objects, not their contents. Does not change ownership or SELinux policy. Android may require root access.</p>{p.entries.some(e => e.mode?.length === 4 && e.mode[0] !== '0') && <p className="file-hint">Selected objects have special permission flags. Applying these three digits may also affect those flags.</p>}</>}
    {renaming ? <div className="file-preview-scroll"><table className="file-preview-table"><thead><tr><th>Before</th><th>After</th></tr></thead><tbody>{computed.map(e => <tr key={e.path}><td>{e.name}</td><td>{e.next}{(e.problem || duplicates.has(e.target)) && <small className="file-error">{e.problem || "Duplicate name"}</small>}</td></tr>)}</tbody></table></div> : transfer ? multiple && <details className="file-transfer-selection"><summary>Selected objects ({p.entries.length})</summary>{p.entries.map(e => <p className="file-preview-path" key={e.path}>{e.path}</p>)}</details> : p.entries.length > 0 && <div className="file-preview-scroll">{p.entries.map(e => <p className="file-preview-path" key={e.path}>{e.path}</p>)}</div>}
    {error && <p role="alert" className="file-error">{error}</p>}
  </BadgeDialog>
}
