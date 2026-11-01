import { RemovedAppsSection } from './RemovedAppsSection'
import { PersonalDatabase } from '../components/AppNotes'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Cable, Grid2X2, LoaderCircle, RefreshCw } from 'lucide-react'
import { ApkInspectorSection } from './ApkInspectorSection'
import { useAppsStore } from '../store/useAppsStore'
import { useConnectionStore } from '../store/useConnectionStore'
import { useAppStore } from '../store/useAppStore'
import { AppsViewControls } from '../components/AppsViewControls'
import { defaultAppFilters, filterAndSortApps } from '../lib/appView'
import { AppsTable } from '../components/AppsTable'
import { useAppsViewStore } from '../store/useAppsViewStore'
import { useAppearanceStore } from '../store/useAppearanceStore'
import type { AndroidApp } from '../../electron/apps-protocol'
import { AppDetailsSection } from './AppDetailsSection'
import { AppsLoadingState } from '../components/AppsLoadingState'
import { AppsSelectionControls } from '../components/AppsSelectionControls'
export function AppsSection() {
  const view = useAppStore(s => s.appsView)
  return view === 'notes' ? <PersonalDatabase /> : view === 'removed' ? <RemovedAppsSection /> : view === 'apk' ? <ApkInspectorSection /> : <InstalledAppsSection />
}
function InstalledAppsSection() {
  const { apps, status, deviceId, userId, message, error, refresh, warnings, profilesError, backgroundUserId, profiles, preloadErrors, badgeEvidence } = useAppsStore()
  const activeId = useConnectionStore(s => s.activeDeviceId)
  const device = useConnectionStore(s => s.devices.find(d => d.id === activeId && d.status === 'connected'))
  const [details, setDetails] = useState<{ app: AndroidApp; packageName: string; deviceId: string | null; userId: number | null } | null>(null)
  const listSection = useRef<HTMLElement>(null)
  const returnPosition = useRef<{ top: number; left: number; button: HTMLElement | null } | null>(null)
  const { sort, setSort, filters, setFilters, search, setSearch } = useAppsViewStore()
  const density = useAppearanceStore(s => s.density)
  useEffect(() => {
    const current = useAppsStore.getState()
    if (device && (current.deviceId !== device.id || current.status === 'idle')) void refresh(device.id)
  }, [device?.id, refresh])
  useEffect(() => { setSearch('') }, [deviceId])
  const data = useMemo(() => filterAndSortApps(apps, filters, search, sort, badgeEvidence), [apps, filters, search, sort, badgeEvidence])
  const detailApp = details && device?.id === deviceId && details.deviceId === deviceId && details.userId === userId ? status === 'loading' ? details.app : status === 'ready' ? apps.find(app => app.packageName === details.packageName) : undefined : undefined
  useEffect(() => { if (details && !detailApp) setDetails(null) }, [details, detailApp])
  useLayoutEffect(() => {
    if (detailApp || !returnPosition.current) return
    const scroll = listSection.current?.querySelector('.apps-table-scroll')
    const position = returnPosition.current
    if (scroll) { scroll.scrollTop = position.top; scroll.scrollLeft = position.left }
    if (position.button?.isConnected) position.button.focus({ preventScroll: true })
    returnPosition.current = null
  }, [detailApp])
  function openDetails(app: AndroidApp) {
    const scroll = listSection.current?.querySelector('.apps-table-scroll')
    const button = Array.from(listSection.current?.querySelectorAll<HTMLButtonElement>('.app-select') || []).find(el => el.dataset.package === app.packageName) || null
    returnPosition.current = { top: scroll?.scrollTop || 0, left: scroll?.scrollLeft || 0, button }
    useAppsStore.getState().select(app.packageName)
    setDetails({ app, packageName: app.packageName, deviceId, userId })
  }
  return <><section ref={listSection} className="section-content apps-live-section" aria-label="Apps" style={detailApp ? { display: 'none' } : undefined}>
    {density === 'comfortable' && <div className="section-heading"><div><div className="eyebrow section-eyebrow">DEVICE APPLICATIONS</div><h1>Apps<span className="heading-period">.</span></h1><p>Installed applications, including system and disabled packages.</p></div></div>}
    {(!device || status !== 'ready' || deviceId !== device.id) && <div className="apps-view-controls apps-query-toolbar"><AppsSelectionControls visibleApps={[]} /></div>}
    {profilesError && <p className="profile-access-note" role="status">{profilesError}</p>}
    {backgroundUserId !== null && <p className="apps-preload-note" role="status"><LoaderCircle size={14} className="spin" />{"Preloading "}{profiles.find(p => p.id === backgroundUserId)?.name || `profile ${backgroundUserId}`}… You can keep using this list.</p>}
    {Object.keys(preloadErrors).length > 0 && <p className="apps-preload-note">{"Some profiles could not be preloaded: "}{Object.keys(preloadErrors).map(id => profiles.find(p => p.id === Number(id))?.name || `ID ${id}`).join(', ')}. Select a profile to retry; details are in Activity.</p>}
    {!device ? <div className="device-required"><Cable size={30} /><h2>Connect a device</h2><p>Select a connected Android device to read its applications.</p><button className="button secondary" onClick={() => useAppStore.getState().setSection('connection')}>Open Connection</button></div> : status === 'loading' ? <AppsLoadingState /> : status === 'error' ? <div className="device-required" role="alert"><h2>Could not read applications</h2><p>{error || ''}</p><p>If this profile is locked or paused, unlock or resume it on the phone. ADB access can also be restricted by its administrator.</p><button className="button secondary" onClick={() => void refresh(device.id)}><RefreshCw size={14} />Retry</button></div> : status === 'ready' && deviceId === device.id ? <>
      <AppsViewControls filters={filters} setFilters={setFilters} sort={sort} setSort={setSort} search={search} setSearch={setSearch} shown={data.length} total={apps.length} selectionControls={<AppsSelectionControls visibleApps={data} />} />
      <AppsTable apps={data} openDetails={openDetails} clearFilters={() => { setFilters(defaultAppFilters()); setSearch('') }} />
      {warnings > 0 && <p className="workspace-footnote">{warnings}{" label or icon warnings. Select an application for details."}</p>}
    </> : <div className="device-required"><Grid2X2 size={28} /><p>{message || "Ready to read applications."}</p><button className="button secondary" onClick={() => void refresh(device.id)}>Read applications</button></div>}
  </section>{detailApp && <AppDetailsSection app={detailApp} deviceName={device?.name || ''} profileName={profiles.find(profile => profile.id === userId)?.name} onBack={() => setDetails(null)} />}</>
}
