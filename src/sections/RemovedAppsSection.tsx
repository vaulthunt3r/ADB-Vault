import { useEffect, useState } from 'react'
import { matchesAppSearch, parseAppSearch, pastedAppSearch } from '../lib/appSearch'
import { ArrowLeft, RefreshCw, RotateCcw } from 'lucide-react'
import { useAppsStore } from '../store/useAppsStore'
import { useConnectionStore } from '../store/useConnectionStore'
import { useAppStore } from '../store/useAppStore'
import { useAppActionsStore } from '../store/useAppActionsStore'
import { useAppsOperations } from '../lib/useAppsOperations'
import { requestBackend } from '../lib/backend'
import { AppIcon } from '../components/AppsTable'
import { AppInspectorHeading } from '../components/AppInspectorHeading'
import { AppNotesSummary } from '../components/AppNotes'
import { AppsLoadingState } from '../components/AppsLoadingState'
import type { AndroidApp } from '../../electron/apps-protocol'

function RestoreButton({ app }: { app: AndroidApp }) {
  const { deviceId, userId } = useAppsStore(), { running, blocked } = useAppsOperations()
  const available = (app.apkSizeBytes || 0) > 0
  return <button className="button secondary" disabled={!available || running || blocked} title={available ? "Restore using APK files still on the phone. Deleted app data is not recovered." : "APK files are missing or could not be verified. Restore from a saved APK/backup instead."} onClick={() => { if (deviceId && userId !== null) void requestBackend({ type: 'apps.action', id: deviceId, userId, packageName: app.packageName, action: 'install-existing' }) }}><RotateCcw size={14} />Restore to profile</button>
}
export function RemovedAppsInspector() {
  const { removedApps = [], selectedRemovedPackage } = useAppsStore()
  const app = removedApps.find(a => a.packageName === selectedRemovedPackage)
  if (!app) return <><span className="eyebrow">REMOVED APPLICATIONS</span><p className="component-description">Select a package that is not installed in this profile. Android may also list packages that were never installed here.</p></>
  return <><span className="eyebrow">NOT INSTALLED IN THIS PROFILE</span><AppInspectorHeading app={app} /><dl className="metadata app-metadata"><div><dt>Type</dt><dd>{app.system ? "System" : "User"}</dd></div><div><dt>Android profile</dt><dd>{app.userId}</dd></div><div><dt>APK files</dt><dd>{(app.apkSizeBytes || 0) > 0 ? "Present on phone" : "Missing / unavailable"}</dd></div></dl><RestoreButton app={app} /><p className="component-description">Restoration uses the copy already on the phone. Deleted data is not recovered. Disabled or frozen state remains unchanged.</p><div className="location-field"><span className="field-label">APK location</span><code>{app.sourceDir || "Unavailable"}</code></div></>
}
export function RemovedAppsSection() {
  const { removedApps = [], deviceId, userId, status, error, profiles, refresh, selectedRemovedPackage, selectRemoved } = useAppsStore()
  const active = useConnectionStore(s => s.activeDeviceId), device = useConnectionStore(s => s.devices.find(d => d.id === active && d.status === 'connected'))
  const { blocked, running } = useAppsOperations()
  const action = useAppActionsStore(s => s.action)
  const [search, setSearch] = useState(''), [systemOnly, setSystemOnly] = useState(false), [limit, setLimit] = useState(100)
  useEffect(() => { const current = useAppsStore.getState(); if (device && (current.deviceId !== device.id || current.status === 'idle')) void refresh(device.id) }, [device?.id, refresh])
  useEffect(() => { setSearch(''); setLimit(100) }, [deviceId, userId])
  const query = parseAppSearch(search)
  const visible = removedApps.filter(a => (!systemOnly || a.system) && matchesAppSearch(a, query)).sort((a, b) => a.label.localeCompare(b.label))
  return <section className="section-content removed-apps" aria-label="Removed applications"><div className="personal-toolbar"><button className="button secondary" onClick={() => useAppStore.setState({ appsView: 'installed' })}><ArrowLeft size={15} />Apps</button><button className="button secondary" disabled={!device || status === 'loading' || running || blocked && status === 'ready'} onClick={() => device && void refresh(device.id, userId ?? undefined)}><RefreshCw size={14} />Refresh</button><button className="button secondary" onClick={() => useAppStore.setState({ appsView: 'notes' })}>Personal database</button></div>
    <div><h1>Removed / not installed in this profile</h1><p className="component-description">{"Known Android packages absent from "}{profiles.find(p => p.id === userId)?.name || "the selected profile"}. This can include preloaded packages never installed in this profile. Apps fully removed from the phone may no longer appear.</p></div>
    {!device ? <div className="device-required"><h2>Connect a device</h2><p>Select a phone to read packages available for restoration.</p><button className="button secondary" onClick={() => useAppStore.getState().setSection('connection')}>Open Connection</button></div> : status === 'loading' ? <AppsLoadingState /> : status === 'error' ? <p role="alert">{error || ''}</p> : status === 'ready' && deviceId === device.id ? <>
      <input className="removed-search" type="search" aria-label="Search removed applications" placeholder="Name or package…" title="Search by name or package. Paste a package list separated by lines, spaces, commas or semicolons." value={search} onChange={e => { setSearch(e.target.value); setLimit(100) }} onPaste={event => {
        const pasted = pastedAppSearch(event.clipboardData.getData('text/plain'))
        if (pasted !== null) { event.preventDefault(); setSearch(pasted); setLimit(100) }
      }} /><label><input type="checkbox" checked={systemOnly} onChange={e => { setSystemOnly(e.target.checked); setLimit(100) }} />{" System applications only"}</label>
      <span className="removed-app-count">{visible.length}{" packages"}</span>
      {action?.action === 'install-existing' && action.id === deviceId && action.userId === userId && <p role={action.status === 'error' ? 'alert' : 'status'}>{action.message}</p>}
      <div className="removed-apps-scroll">{!visible.length && <p className="personal-empty">{removedApps.length ? "No matching packages." : "Android reported no packages absent from this profile."}</p>}{visible.slice(0, limit).map(app => <article key={app.packageName} className={`removed-app-row${selectedRemovedPackage === app.packageName ? " selected" : ''}`}><AppIcon app={app} /><div><button className="removed-app-select" onClick={() => selectRemoved(app.packageName)}><strong>{app.label}</strong><code>{app.packageName}</code></button><span className="removed-app-count">{app.system ? "System" : "User"} · {(app.apkSizeBytes || 0) > 0 ? "APK on phone" : "APK unavailable"}</span><AppNotesSummary app={app} /></div><RestoreButton app={app} /></article>)}{visible.length > limit && <button className="button secondary" onClick={() => setLimit(n => n + 100)}>Show more</button>}</div>
    </> : null}
  </section>
}
