import { useEffect, useState } from 'react'
import { matchesAppSearch, parseAppSearch, pastedAppSearch } from '../lib/appSearch'
import { ArrowLeft, RefreshCw, RotateCcw, X } from 'lucide-react'
import { useAppsStore } from '../store/useAppsStore'
import { useConnectionStore } from '../store/useConnectionStore'
import { useAppStore } from '../store/useAppStore'
import { useAppActionsStore } from '../store/useAppActionsStore'
import { useAppsOperations } from '../lib/useAppsOperations'
import { requestBackend } from '../lib/backend'
import { RemovedAppsTable } from '../components/RemovedAppsTable'
import { batchSkipReason } from '../../electron/app-actions-protocol'
import { AppInspectorHeading } from '../components/AppInspectorHeading'
import { AppsLoadingState } from '../components/AppsLoadingState'
import type { AndroidApp } from '../../electron/apps-protocol'

function RestoreButton({ app }: { app: AndroidApp }) {
  const { deviceId, userId } = useAppsStore(), { running, blocked } = useAppsOperations()
  const available = !batchSkipReason('install-existing', app, [])
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
  const [search, setSearch] = useState(''), [systemOnly, setSystemOnly] = useState(false), [submitting, setSubmitting] = useState(false)
  const context = JSON.stringify([deviceId, userId, active])
  const [selection, setSelection] = useState({ context, packages: new Set<string>() })
  const packages = selection.context === context ? selection.packages : new Set<string>()
  useEffect(() => { const current = useAppsStore.getState(); if (device && (current.deviceId !== device.id || current.status === 'idle')) void refresh(device.id) }, [device?.id, refresh])
  useEffect(() => { setSearch('') }, [deviceId, userId])
  useEffect(() => {
    if (status !== 'ready') return
    const available = new Set(removedApps.map(app => app.packageName))
    setSelection(previous => previous.context !== context ? { context, packages: new Set() } : [...previous.packages].some(pkg => !available.has(pkg)) ? { context, packages: new Set([...previous.packages].filter(pkg => available.has(pkg))) } : previous)
  }, [context, removedApps, status])
  const query = parseAppSearch(search)
  const visible = removedApps.filter(a => (!systemOnly || a.system) && matchesAppSearch(a, query))
  const chosen = removedApps.filter(app => packages.has(app.packageName))
  const eligible = chosen.filter(app => !batchSkipReason('install-existing', app, removedApps)).length
  const hidden = chosen.length - visible.filter(app => packages.has(app.packageName)).length
  const disabled = running || blocked || submitting
  function mark(ids: string[], checked: boolean) {
    setSelection(previous => { const next = new Set(previous.context === context ? previous.packages : []); ids.forEach(id => checked ? next.add(id) : next.delete(id)); return { context, packages: next } })
  }
  async function restoreSelected() {
    if (disabled || !eligible || !deviceId || userId === null) return
    setSubmitting(true)
    try { await requestBackend({ type: 'apps.batchAction', plan: { id: deviceId, userId, packages: chosen.map(app => app.packageName), action: 'install-existing' } }) }
    finally { setSubmitting(false) }
  }
  const result = action?.action === 'install-existing' && action.id === deviceId && action.userId === userId ? action : null
  return <section className="section-content removed-apps" aria-label="Removed applications"><div className="personal-toolbar"><button className="button secondary" onClick={() => useAppStore.setState({ appsView: 'installed' })}><ArrowLeft size={15} />Apps</button><button className="button secondary" disabled={!device || status === 'loading' || running || blocked && status === 'ready'} onClick={() => device && void refresh(device.id, userId ?? undefined)}><RefreshCw size={14} />Refresh</button><button className="button secondary" onClick={() => useAppStore.setState({ appsView: 'notes' })}>Personal database</button></div>
    <div><h1>Removed / not installed in this profile</h1><p className="component-description">{"Known Android packages absent from "}{profiles.find(p => p.id === userId)?.name || "the selected profile"}. This can include preloaded packages never installed in this profile. Apps fully removed from the phone may no longer appear.</p></div>
    {!device ? <div className="device-required"><h2>Connect a device</h2><p>Select a phone to read packages available for restoration.</p><button className="button secondary" onClick={() => useAppStore.getState().setSection('connection')}>Open Connection</button></div> : status === 'loading' ? <AppsLoadingState /> : status === 'error' ? <p role="alert">{error || ''}</p> : status === 'ready' && deviceId === device.id ? <>
      <input className="removed-search" type="search" aria-label="Search removed applications" placeholder="Name or package…" title="Search by name or package. Paste a package list separated by lines, spaces, commas or semicolons." value={search} onChange={e => setSearch(e.target.value)} onPaste={event => {
        const pasted = pastedAppSearch(event.clipboardData.getData('text/plain'))
        if (pasted !== null) { event.preventDefault(); setSearch(pasted) }
      }} />
      <div className="removed-selection-toolbar"><label><input type="checkbox" checked={systemOnly} onChange={e => setSystemOnly(e.target.checked)} /> System applications only</label>
        <span className="removed-app-count" role="status">{visible.length} packages{chosen.length > 0 && ` · Selected ${chosen.length}${hidden ? ` · ${hidden} hidden by filters` : ''}${chosen.length > eligible ? ` · ${chosen.length - eligible} unavailable` : ''}`}</span>
        <button className="button secondary" disabled={disabled || !eligible} title="Restore checked applications, including those hidden by filters. Unavailable APKs are skipped. Review the phone, profile and selection before confirming." onClick={() => void restoreSelected()}><RotateCcw size={14} />Restore selected ({eligible})</button>
        <button className="icon-button" aria-label="Clear removed selection" title="Clear selection" disabled={disabled || !chosen.length} onClick={() => setSelection({ context, packages: new Set() })}><X size={14} /></button>
      </div>
      <RemovedAppsTable apps={visible} packages={packages} selected={selectedRemovedPackage} select={selectRemoved} mark={mark} disabled={disabled} />
      {result && <div className="removed-restore-result"><p role={result.status === 'error' ? 'alert' : 'status'}>{result.message}</p>
        {result.batch && result.status === 'running' && <button className="button secondary" disabled={result.batch.stopRequested} onClick={() => void requestBackend({ type: 'apps.cancelAction' })}>{result.batch.stopRequested ? 'Stopping after current application…' : 'Stop after current application'}</button>}
        {result.batch && <details><summary>Results ({result.batch.items.length})</summary><ul>{result.batch.items.map(item => <li key={item.packageName}><strong>{item.label}</strong> · {item.status}<code>{item.packageName}</code><p>{item.message}</p>{item.uncertain && <p>Refresh applications and check the phone before retrying; restoration may already have completed.</p>}</li>)}</ul></details>}
        <button className="text-button" onClick={() => useAppStore.getState().setSection('activity')}>Show in Activity</button>
      </div>}
    </> : null}
  </section>
}
