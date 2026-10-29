import { t as localeText } from '../lib/i18n'
import { t as translateUi } from '../lib/i18n'
import { locale as uiLocale } from '../lib/i18n'
import { message } from "../lib/i18n"
import { t } from "../lib/i18n"
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Grid2X2, MapPin, RefreshCw, X } from 'lucide-react'
import type { DeviceRecord } from '../../electron/contracts'
import type { NetworkTarget, PhoneConnections } from '../../electron/network-protocol'
import { NetworkCountry } from './NetworkCountry'
import { AppIcon } from './AppsTable'
import { useMonitorStore } from '../store/useMonitorStore'
import { useAppsStore } from '../store/useAppsStore'
import { useAppStore } from '../store/useAppStore'
import { androidProfileLabel } from '../lib/androidProfiles'
import { copyText } from '../lib/clipboard'
import '../styles/network-connections.css'

const endpoint = (ip: string, port: number) => `${ip.includes(':') ? `[${ip}]` : ip}:${port}`
function CopyValue({ value, label, children }: { value: string; label: string; children: ReactNode }) {
  async function copy() {
    try { await copyText(value); useAppStore.getState().notify(`${label} copied · ${value}`, 2500) }
    catch { useAppStore.getState().notify(translateUi("Could not copy {0}", [label.toLowerCase()])) }
  }
  return <button className="network-copy-value" title={t("Copy {0} · {1}", [label.toLowerCase(), value])} onClick={() => void copy()}>{children}</button>
}
export function NetworkConnectionsPanel({ device, visible, blocked }: { device?: DeviceRecord; visible: boolean; blocked: boolean }) {
  const { paused, interval, networkFilter } = useMonitorStore()
  const [sample, setSample] = useState<PhoneConnections | null>(null), [error, setError] = useState(''), [reading, setReading] = useState(false)
  const [query, setQuery] = useState(''), [profile, setProfile] = useState(networkFilter && networkFilter.deviceId === device?.id ? String(networkFilter.userId) : '')
  const [includeListening, setIncludeListening] = useState(false), [refresh, setRefresh] = useState(0)
  const { apps, deviceId: appsDeviceId, profiles: appProfiles, currentUserId } = useAppsStore()
  const target = useMemo<NetworkTarget | null>(() => device ? { id: device.id, serial: device.serial, transportId: device.transportId } : null, [device?.id, device?.serial, device?.transportId])
  const connected = device?.status === 'connected'
  useEffect(() => {
    if (!connected || !target || !visible || blocked || paused || !window.desktop) return
    let stopped = false, id: string | null = null, timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      id = crypto.randomUUID(); setReading(true)
      try {
        const reply = await window.desktop!.request({ type: 'network.connections', target, requestId: id })
        if (stopped) return
        if (!reply.ok) throw new Error(reply.error)
        if (!reply.phoneConnections) throw new Error(translateUi("No phone network reading was returned."))
        setSample(reply.phoneConnections); setError('')
      } catch (e) { if (!stopped) setError(e instanceof Error ? e.message : String(e)) }
      finally { if (!stopped) { setReading(false); timer = setTimeout(() => void poll(), interval * 1000) } }
    }
    timer = setTimeout(() => void poll(), 100)
    return () => { stopped = true; clearTimeout(timer); setReading(false); if (id) void window.desktop?.request({ type: 'network.cancel', requestId: id }).catch(() => {}) }
  }, [target, connected, visible, blocked, paused, interval, refresh])
  const appFilter = networkFilter?.deviceId === device?.id ? networkFilter : null
  const knownProfiles = appsDeviceId === device?.id ? appProfiles : []
  const profileLabel = (id: number) => androidProfileLabel(id, knownProfiles, appsDeviceId === device?.id ? currentUserId : null)
  const appIndex = useMemo(() => new Map((appsDeviceId === device?.id ? apps : []).map(app => [`${app.uid}:${app.packageName}`, app])), [apps, appsDeviceId, device?.id])
  const appFor = (pkg: string, uid: number) => appIndex.get(`${uid}:${pkg}`)
  const label = (pkg: string, uid: number) => appFor(pkg, uid)?.label || pkg
  const allSockets = sample?.sockets || []
  const sockets = allSockets.filter(s => (includeListening || s.remotePort !== 0 && s.remoteAddress !== '0.0.0.0' && s.remoteAddress !== '::') && (!profile || s.userId === +profile) && (!appFilter || s.userId === appFilter.userId && s.packages.includes(appFilter.packageName)) && `${s.packages.map(p => label(p, s.uid)).join(' ')} ${s.packages.join(' ')} ${s.uid} ${s.localAddress} ${s.remoteAddress} ${s.remotePort} ${s.protocol} ${s.state} ${s.ip.country || ''} ${s.ip.organization || ''}`.toLowerCase().includes(query.toLowerCase()))
  const profiles = [...new Set([...knownProfiles.map(p => p.id), ...allSockets.map(s => s.userId), ...(profile ? [+profile] : [])])].sort((a, b) => a - b)
  return <div className="phone-network" aria-label={t("Phone connections")}>
    <div className="network-tools">
      <input aria-label={t("Filter connections")} placeholder={t("Application, IP, port or network…")} value={query} onChange={e => setQuery(e.target.value)} />
      <select aria-label={t("Connection profile")} title={t("Filter connections by Android profile; does not switch the phone's active user")} value={profile} onChange={e => setProfile(e.target.value)}><option value="">{t("All Android profiles")}</option>{profiles.map(id => <option key={id} value={id}>{profileLabel(id)}</option>)}</select>
      <label><input type="checkbox" checked={includeListening} onChange={e => setIncludeListening(e.target.checked)} />{t("Include listening / unconnected")}</label>
      <button className="button secondary" disabled={!connected || blocked || reading} onClick={() => { useMonitorStore.setState({ paused: false }); setRefresh(n => n + 1) }}><RefreshCw size={14} />{t("Refresh connections")}</button>
    </div>
    {appFilter && <div className="network-app-filter">{appFilter.packageName} · {profileLabel(appFilter.userId)}<button className="button secondary" onClick={() => { useMonitorStore.setState({ networkFilter: null }); setProfile('') }}><X size={14} />{t("Clear app filter")}</button></div>}
    <p className="monitor-note" role="status">{!connected ? t("Phone disconnected") : blocked ? t("Paused during diagnostic collection") : paused ? t("Paused") : !visible ? t("Paused while hidden") : reading ? t("Reading phone sockets…") : sample ? t("{0} connections shown · Updated {1}", [sockets.length, new Date(sample.time).toLocaleTimeString(uiLocale())]) : t("Waiting for phone connections")}{error && sample ? t(" · Showing the last successful reading") : ''}</p>
    {error && <p role="alert" className="operation-error">{message(error)}</p>}
    <p className="monitor-note">{t("Click an address to copy its IP without the port. Click a network to copy its name and ASN. Short connections may disappear between readings; shared UIDs show all possible app owners.")}</p>
    <div className="monitor-table-wrap network-sockets"><table><thead><tr><th>{t("Application / UID")}</th><th>{t("Remote address")}</th><th>{t("Protocol / state")}</th><th>{t("Country")}</th><th>{t("Network")}</th><th>{t("Local address")}</th></tr></thead><tbody>
      {sockets.map(s => <tr key={s.key}>
        <td>{s.packages.length ? s.packages.map(pkg => {
          const app = appFor(pkg, s.uid)
          return <div className="network-app-owner" key={pkg}>
            {app ? <AppIcon app={app} /> : <span className="network-app-placeholder" title={t("App icon not loaded for this profile")}><Grid2X2 size={20} aria-hidden="true" /></span>}
            <div><strong>{app?.label || pkg}</strong>{app?.label && app.label !== pkg && <small>{pkg}</small>}</div>
          </div>
        }) : <strong>{t("Unknown / system UID ")}{s.uid}</strong>}<small>{t("UID ")}{s.uid} · {profileLabel(s.userId)}{s.packages.length > 1 && <> · <span tabIndex={0} title={t("These applications share the same UID. The available data cannot identify which one opened this connection.")}>{t("Shared UID · ")}{s.packages.length}{t(" possible owners")}</span></>}</small></td>
        <td><CopyValue value={s.remoteAddress} label={t("Remote IP")}>{endpoint(s.remoteAddress, s.remotePort)}</CopyValue></td>
        <td>{s.protocol}{t(" · IPv")}{s.family}<small>{s.state}</small></td>
        <td><NetworkCountry info={s.ip} /></td>
        <td>{s.ip.organization || s.ip.asn ? <CopyValue value={[s.ip.organization, s.ip.asn ? `AS${s.ip.asn}` : ''].filter(Boolean).join(' · ')} label={localeText("Network")}><span>{s.ip.organization || `AS${s.ip.asn}`}</span>{s.ip.organization && s.ip.asn && <small>AS{s.ip.asn}</small>}</CopyValue> : s.ip.scope === 'Public / other' ? t("Unknown network") : '—'}</td>
        <td><CopyValue value={s.localAddress} label={t("Local IP")}>{endpoint(s.localAddress, s.localPort)}</CopyValue></td>
      </tr>)}
    </tbody></table></div>
    {!sockets.length && sample && <p className="monitor-empty">{sample.issues.length && !sample.sockets.length ? t("No readable socket data. See Android’s response below.") : t("No current connections match these filters.")}</p>}
    {sample?.issues.map((issue, index) => <p className="monitor-notice" key={index}>{issue}</p>)}
    <div className="network-geoip"><MapPin size={15} /><span>{sample?.geoip || t("Country and ASN use optional local GeoIP databases.")}</span></div>

  </div>
}
