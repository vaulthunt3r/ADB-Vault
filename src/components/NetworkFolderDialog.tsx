import { NetworkDiscoveryDialog } from './NetworkDiscoveryDialog'
import { useState } from 'react'
import { HelpCircle, Network } from 'lucide-react'
import { fileBase } from '../../electron/files-protocol'
import { networkPath, networkRoot } from '../../electron/file-locations'
import { filesRequest, useFilesStore, type PaneSide } from '../store/useFilesStore'
import { BadgeDialog } from './BadgeDialog'
import { IconButton } from './ui'

export function NetworkFolderDialog({ side, initial = '', discover = false, initialError = '', close }: { side: PaneSide; initial?: string; discover?: boolean; initialError?: string; close: () => void }) {
  const [discovery, setDiscovery] = useState(discover)
  const [address, setAddress] = useState(initial), [name, setName] = useState(() => useFilesStore.getState().networks.find(n => n.path.toLowerCase() === initial.toLowerCase())?.name || ''), [save, setSave] = useState(true), [prompt, setPrompt] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(initialError), [help, setHelp] = useState(false)
  async function open() {
    setError('')
    let path: string
    try { path = networkPath(address) } catch (e) { setError(e instanceof Error ? e.message : String(e)); return }
    setBusy(true)
    try {
      const reply = await filesRequest({ type: 'files.network.connect', address: path, prompt })
      if (!reply.folder) { setError("Network sign-in cancelled."); return }
      const folder = reply.folder
      if (save) useFilesStore.setState(s => ({ networks: [...s.networks.filter(n => ![path.toLowerCase(), folder.toLowerCase()].includes(n.path.toLowerCase())), { name: name.trim() || fileBase(folder) + ' · ' + networkRoot(folder).split('\\')[2], path: folder }] }))
      useFilesStore.getState().navigate(side, { kind: 'local', path: reply.folder }); close()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  if (discovery) return <NetworkDiscoveryDialog close={close} manual={value => { setAddress(value || ''); setDiscovery(false) }} />
  return <BadgeDialog title="SMB / Samba folder" className="fm-network-dialog" close={close} closeDisabled={busy} footer={<button className="button primary" disabled={busy || !address.trim()} onClick={() => void open()}><Network size={15} />{busy ? "Connecting…" : "Open folder"}</button>}>
    <div className="fm-network-heading"><span>Windows, NAS or Samba share</span><IconButton label="About network folders" aria-expanded={help} onClick={() => setHelp(!help)}><HelpCircle size={16} /></IconButton></div>
    {help && <p className="fm-search-help">Enter a disk share, for example \\NAS\Shared or smb://NAS/Shared. Windows handles sign-in; ADB Vault stores no passwords. Saved folders appear in Places. Files use the server’s access permissions. Use Search network in Places to discover nearby SMB shares. To cancel a sign-in prompt, use Cancel in the Windows window.</p>}
    <fieldset disabled={busy} className="fm-network-fields"><label>Network folder<input placeholder="\\server\share" value={address} onChange={e => setAddress(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void open() } }} /></label><label>Name in Places<input placeholder="Use folder name" value={name} maxLength={100} onChange={e => setName(e.target.value)} /></label><label className="fm-network-option"><input type="checkbox" checked={save} onChange={e => setSave(e.target.checked)} />Save in Places</label><label className="fm-network-option"><input type="checkbox" checked={prompt} onChange={e => setPrompt(e.target.checked)} />Ask Windows for credentials</label></fieldset>
    {busy && <p className="muted" role="status">{prompt ? "Complete Windows sign-in if prompted." : "Opening with existing Windows access…"}</p>}{error && <p role="alert" className="file-error">{error}</p>}
  </BadgeDialog>
}
