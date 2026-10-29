import { t as localeText } from '../lib/i18n'
import { message } from "../lib/i18n"
import { t } from "../lib/i18n"
import { useEffect, useRef, useState } from 'react'
import { Folder, HelpCircle, Search } from 'lucide-react'
import type { NetworkScanResult } from '../../electron/file-network-discovery'
import { filesRequest, useFilesStore } from '../store/useFilesStore'
import { BadgeDialog } from './BadgeDialog'
import { IconButton } from './ui'

export function NetworkDiscoveryDialog({ close, manual }: { close: () => void; manual: (address?: string) => void }) {
  const [result, setResult] = useState<NetworkScanResult>(), [busy, setBusy] = useState(false), [error, setError] = useState(''), [help, setHelp] = useState(false), [selected, setSelected] = useState<string[]>([])
  const request = useRef<string | undefined>(undefined), alive = useRef(true)
  const saved = useFilesStore(s => s.networks)
  async function scan() {
    if (request.current) return
    const requestId = crypto.randomUUID(); request.current = requestId
    setBusy(true); setError(''); setSelected([]); setResult(undefined)
    try { const reply = await filesRequest({ type: 'files.network.scan', requestId }); if (alive.current) setResult(reply.networkScan) }
    catch (error) { if (alive.current) setError(error instanceof Error ? error.message : String(error)) }
    finally { request.current = undefined; if (alive.current) setBusy(false) }
  }
  const stop = () => { if (request.current) void filesRequest({ type: 'files.network.scan.cancel', requestId: request.current }).catch(() => {}) }
  useEffect(() => {
    alive.current = true
    const timer = setTimeout(() => void scan(), 0)
    return () => { alive.current = false; clearTimeout(timer); stop() }
  }, [])
  const shares = result?.hosts.flatMap(h => h.shares) || []
  function save() {
    useFilesStore.setState(s => {
      const existing = new Set(s.networks.map(n => n.path.toLowerCase()))
      return { networks: [...s.networks, ...shares.filter(share => selected.includes(share.path) && !existing.has(share.path.toLowerCase())).map(share => ({ path: share.path, name: share.name + ' · ' + share.path.split('\\')[2] }))] }
    })
    close()
  }
  return <BadgeDialog title={t("Search network")} className="fm-network-discovery-dialog" close={close} footer={<><button className="button secondary" onClick={() => manual()}>{localeText("Enter address…")}</button>{busy ? <button className="button secondary" onClick={stop}>{localeText("Stop search")}</button> : <button className="button secondary" onClick={() => void scan()}><Search size={14} />{localeText("Scan again")}</button>}<button className="button primary" disabled={busy || !selected.length} onClick={save}>{localeText("Save selected")}{selected.length ? ` (${selected.length})` : ''}</button></>}>
    <div className="fm-network-heading"><span role="status">{busy ? t("Scanning local network for SMB shared folders…") : result ? t("{0} SMB devices · {1} shared folders{2}", [result.hosts.length, shares.length, result.cancelled ? t(" · Incomplete") : '']) : t("Network search")}</span><IconButton label={t("About network discovery")} aria-expanded={help} onClick={() => setHelp(!help)}><HelpCircle size={16} /></IconButton></div>
    {help && <p className="fm-search-help">{t("Search includes existing Windows network drives and preserves their server names. It checks nearby IPv4 segments on connected Windows network adapters, then asks SMB devices for shared folders using your current Windows account. Only shared disk folders are listed; private disks and administrative shares are not shown. Firewalls and server permissions can hide devices or folders. For other networks or sign-in, use Enter address. Closing this window stops the search.")}</p>}
    {!!result?.ranges.length && <p className="file-hint">{result.ranges.join(' · ')}</p>}
    {error && <p role="alert" className="file-error">{message(error)}</p>}
    {result?.warnings.map(w => <p key={w} className="file-hint">{message(w)}</p>)}
    {result && !result.hosts.length && <p className="file-hint">{t("No SMB devices found. Check network access or enter a shared folder address.")}</p>}
    <div className="fm-network-results">{result?.hosts.map(host => <section key={host.address} aria-label={t("SMB device {0}", [host.address])}><header><strong>{host.address}</strong><button className="text-button" onClick={() => manual('\\\\' + host.address + '\\')}>{t("Enter folder…")}</button></header>{host.error && <p>{message(host.error)}</p>}{!host.error && !host.shares.length && <p>{t("No public disk shares were returned.")}</p>}{host.shares.map(share => {
      const exists = saved.some(s => s.path.toLowerCase() === share.path.toLowerCase())
      return <label key={share.path}><input type="checkbox" checked={exists || selected.includes(share.path)} disabled={exists} onChange={e => setSelected(s => e.target.checked ? [...s, share.path] : s.filter(p => p !== share.path))} /><Folder size={16} /><span>{share.name}{share.drive && ` (${share.drive})`}<small>{share.path}</small></span>{exists && <small>{t("Saved")}</small>}</label>
    })}</section>)}</div>
  </BadgeDialog>
}
