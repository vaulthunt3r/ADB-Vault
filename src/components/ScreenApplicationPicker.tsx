import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { DeviceRecord } from '../../electron/contracts'
import type { ScreenApplications } from '../../electron/screen-applications'
import type { ScreenLaunch } from '../../electron/screen-protocol'

export function ScreenApplicationPicker({ device, stale, application, suggestedApplication, change }: {
  device: DeviceRecord; stale: boolean; application: ScreenLaunch['application']; suggestedApplication?: { packageName: string; userId: number; label: string }; change: (app: ScreenLaunch['application']) => void
}) {
  const [catalog, setCatalog] = useState<ScreenApplications | null>(null)
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [query, setQuery] = useState(''), [revision, refresh] = useState(0)
  const [selectionNote, setSelectionNote] = useState('')
  useEffect(() => {
    let cancelled = false
    const preferred = application || suggestedApplication
    change(undefined); setCatalog(null); setError(''); setSelectionNote(''); setLoading(!stale); setQuery('')
    if (stale) return
    if (!window.desktop) { setLoading(false); setError("Application selection requires the desktop app."); return }
    void window.desktop.request({ type: 'connection.screenApplications', id: device.id, serial: device.serial, transportId: device.transportId }).then(reply => {
      if (cancelled) return
      if (reply.ok && reply.screenApplications) {
        const catalog = reply.screenApplications
        setCatalog(catalog)
        if (preferred && preferred.userId === catalog.userId && catalog.applications.some(app => app.packageName === preferred.packageName)) change({ packageName: preferred.packageName, userId: catalog.userId })
        else if (preferred) setSelectionNote(preferred.userId !== catalog.userId ? "The selected application belongs to another Android profile. Choose an app in the phone’s current profile below." : "The selected application is not available to launch in this profile. Choose another app below.")
      }
      else setError(reply.ok ? "Could not read applications." : reply.error)
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [device.id, device.serial, device.transportId, stale, revision, change, suggestedApplication?.packageName, suggestedApplication?.userId])
  const search = query.trim().toLocaleLowerCase()
  const apps = catalog?.applications.filter(app => app.packageName === application?.packageName || `${app.label} ${app.packageName}`.toLocaleLowerCase().includes(search)) || []
  return <fieldset className="screen-fields screen-app-picker"><legend>Application to open</legend>
    <p className="screen-note">{loading ? "Reading launchable applications…" : catalog ? `Current Android profile · ID ${catalog.userId} · ${catalog.applications.length} applications` : "Choose an application before starting the virtual display."}</p>
    {selectionNote && <p className="screen-note" role="status">{selectionNote}</p>}
    <div className="screen-app-search"><label>Find an application<input type="search" value={query} disabled={loading || stale || !catalog} placeholder="Name or package…" onChange={e => setQuery(e.target.value)} /></label><button type="button" className="button secondary icon-button" aria-label="Refresh launchable applications" title="Refresh applications" disabled={loading || stale} onClick={() => refresh(r => r + 1)}><RefreshCw size={17} /></button></div>
    <label>Application<select aria-label="Application to open" value={application?.packageName || ''} disabled={loading || stale || !catalog?.applications.length} onChange={e => change(e.target.value && catalog ? { packageName: e.target.value, userId: catalog.userId } : undefined)}>
      <option value="">{loading ? "Reading applications…" : catalog && !catalog.applications.length ? "No launchable applications found" : "Choose an application…"}</option>
      {apps.map(app => <option key={app.packageName} value={app.packageName}>{app.label} · {app.packageName}</option>)}
    </select></label>
    {catalog && search && !apps.length && <p className="screen-note">No matching applications.</p>}
    {error && <p className="screen-error" role="alert">{error}</p>}
  </fieldset>
}
