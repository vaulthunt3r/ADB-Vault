import { useEffect, useRef } from 'react'
import { RefreshCw } from 'lucide-react'
import { useAdbDiagnosticsStore } from '../store/useAdbDiagnosticsStore'
import { useAppStore } from '../store/useAppStore'
import { isBusy } from '../lib/components'

const labels: [string, string][] = [['clientVersion', "Client build"], ['protocol', "ADB protocol"], ['serverStatus', "Server status"], ['version', "Server version"], ['usb_backend', "USB backend"], ['mdns_backend', "mDNS backend"], ['mdns_enabled', "mDNS enabled"], ['hostFeatures', "Host features"], ['mdnsCheck', "mDNS check"], ['executable_absolute_path', "Server executable"], ['log_absolute_path', "Server log"]]
export function AdbDiagnosticsPanel() {
  const { diagnostics, refreshing, refresh } = useAdbDiagnosticsStore()
  const location = useAppStore(state => state.components.find(c => c.id === 'adb')?.location)
  const componentBusy = useAppStore(state => state.componentPending || state.bulkBusy || state.components.some(c => isBusy(c.status)))
  const attempted = useRef<string | undefined>(undefined)
  useEffect(() => {
    const key = location || ''
    if (componentBusy || attempted.current === key) return
    attempted.current = key
    const current = useAdbDiagnosticsStore.getState().diagnostics
    if (window.desktop && (!current || current.status === 'idle' || current.executable?.replace(/\\/g, '/').toLowerCase() !== (location ? `${location}/adb.exe`.replace(/\\/g, '/').toLowerCase() : undefined))) void refresh()
  }, [location, refresh, componentBusy])
  return <div className="diagnostics-panel" aria-label="ADB diagnostics"><div className="diagnostics-heading"><h3>{"ADB & discovery"}</h3><button className="button secondary" disabled={componentBusy || refreshing || !window.desktop} onClick={() => void refresh()}><RefreshCw size={13} className={refreshing ? 'spin' : ''} />Refresh</button></div>
    {refreshing && <p role="status">Checking ADB server and discovery…</p>}
    {diagnostics?.collectedAt && <p className="diagnostics-timestamp">{"Checked "}{new Date(diagnostics.collectedAt).toLocaleString('en-US')}</p>}
    {diagnostics && <><dl className="diagnostics-fields"><div><dt>Client executable</dt><dd>{diagnostics.executable || "Not available"}</dd></div>{labels.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{diagnostics.fields[key] || "Unavailable"}</dd></div>)}</dl>
      <h3>Discovered services</h3><p className="component-description">Discovery does not mean the device is connected.</p>{diagnostics.servicesAvailable ? diagnostics.services.length ? <ul className="discovery-services">{diagnostics.services.map(service => <li key={`${service.name}:${service.address}`}><strong>{service.type.includes('pairing') ? "Pairing" : "Connection"} · {service.address}</strong><span>{service.name}</span></li>)}</ul> : <p className="component-description">No services found at the last check.</p> : <p className="component-description">Service discovery unavailable.</p>}
      {diagnostics.issues.map(issue => <p key={issue.check} className="diagnostics-issue"><strong>{issue.check}</strong>: {issue.message}</p>)}
    </>}
  </div>
}
