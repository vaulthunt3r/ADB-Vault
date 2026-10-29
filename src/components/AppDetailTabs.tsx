import { message } from "../lib/i18n"
import { t } from "../lib/i18n"
import { useId, useRef, useState, type ReactNode } from 'react'
import { Copy, Info, Search, LoaderCircle } from 'lucide-react'
import type { AppComponent, AppDetails, AppPermission } from '../../electron/app-details-protocol'
import { copyText } from '../lib/clipboard'
import { useAppStore } from '../store/useAppStore'
import type { AndroidApp } from '../../electron/apps-protocol'
import { usePermissionActions } from './usePermissionActions'

const tabs = [
  { id: 'about', get label() { return t("About application") } },
  { id: 'Activity', get label() { return t("Activities") } },
  { id: 'Service', get label() { return t("Services") } },
  { id: 'Receiver', get label() { return t("Receivers") } },
  { id: 'Provider', get label() { return t("Providers") } },
  { id: 'permissions', get label() { return t("Used permissions") } },
] as const
type Tab = typeof tabs[number]['id'] | 'contents'
export type DetailComponent = AppComponent & { manifestAttributes?: Record<string, string>; filters?: string[] }
export type DetailPermission = AppPermission & { manifestAttributes?: Record<string, string> }

function CopyName({ name }: { name: string }) {
  return <button className="icon-button" aria-label={t("Copy {0}", [name])} onClick={() => void copyText(name).then(() => useAppStore.getState().notify("Copied"), () => useAppStore.getState().notify("Could not copy to the clipboard."))}><Copy size={14} /></button>
}
function ManifestFields({ attributes, filters }: { attributes?: Record<string, string>; filters?: string[] }) {
  return <>{attributes && <dl>{Object.entries(attributes).map(([name, value]) => <div key={name}><dt>{name.replace(/^android:/, '')}</dt><dd><code>{value}</code></dd></div>)}</dl>}{!!filters?.length && <details className="apk-manifest-filters"><summary>{t("Intent filters & metadata")}</summary>{filters.map((filter, i) => <pre key={i}>{filter}</pre>)}</details>}</>
}
function ComponentRow({ entry, local }: { entry: DetailComponent; local?: boolean }) {
  const fields = [
    [t("Process"), entry.processName], [t("Permission"), entry.permission], [t("Alias target"), entry.targetActivity],
    [t("Authorities"), entry.authority], [t("Read permission"), entry.readPermission], [t("Write permission"), entry.writePermission],
  ].filter(([, value]) => value)
  return <li className="app-manifest-row">
    <div className="app-manifest-row-heading"><code>{entry.name}</code><CopyName name={entry.name} /></div>
    <div className="app-manifest-status"><span>{local ? t("Manifest declaration") : entry.enabled == null ? t("State unavailable") : entry.enabled ? t("Enabled") : t("Disabled")}</span>
      {entry.exported !== undefined && <span title={t("Exported components may be accessed by other apps, subject to their permissions and Android restrictions.")}>{entry.exported ? t("Exported") : t("Not exported")}</span>}
      {entry.directBootAware && <span title={t("Can run before the profile is unlocked after reboot.")}>{t("Direct boot aware")}</span>}
    </div>
    {local ? <ManifestFields attributes={entry.manifestAttributes} filters={entry.filters} /> : !!fields.length && <dl>{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd><code>{value}</code></dd></div>)}</dl>}
  </li>
}
function PermissionRow({ entry, controls }: { entry: AppPermission; controls: ReturnType<typeof usePermissionActions> }) {
  const hintId = useId(), [showHint, setShowHint] = useState(false)
  const reason = controls.reason(entry), pending = controls.pending === entry.name
  const hint = message(reason) || t("Change this permission for the selected Android profile. Revoking access can close the app. AppOps and other Android restrictions can still limit access.")
  const error = controls.error?.permission === entry.name ? controls.error.message : null
  const level = entry.protectionLevel
  const protection = level == null ? t("Protection unavailable") : `${({ 0: t("Normal"), 1: t("Dangerous"), 2: t("Signature"), 3: t("Signature or system"), 4: t("Internal") } as Record<number, string>)[level & 15] || t("Other")} · 0x${level.toString(16)}`
  return <li className="app-manifest-row">
    <div className="app-manifest-row-heading app-permission-heading"><code>{entry.name}</code><div className="app-permission-controls">
      <button type="button" role="switch" aria-label={t("Permission {0}", [entry.name])} aria-checked={entry.granted === true} aria-disabled={!!reason} aria-describedby={hintId} className="app-permission-switch" title={hint} onClick={() => { if (!reason) void controls.change(entry); else setShowHint(value => !value) }}>
        <span className="app-permission-track" aria-hidden="true">{pending ? <LoaderCircle size={12} className="spin" /> : <span />}</span>
        <span>{pending ? t("Updating…") : entry.granted == null ? t("Unknown") : entry.granted ? t("Granted") : t("Denied")}</span>
      </button>
      <button type="button" className="icon-button" aria-label={t("About changing {0}", [entry.name])} title={hint} aria-expanded={showHint} onClick={() => setShowHint(value => !value)}><Info size={14} /></button><CopyName name={entry.name} />
    </div></div>
    <p id={hintId} className="app-permission-explanation" hidden={!showHint}>{hint}</p>
    {entry.label && entry.label !== entry.name && <p className="app-permission-label">{entry.label}{entry.description && <span tabIndex={0} className="app-permission-help" title={message(entry.description)} aria-label={message(entry.description)}><Info size={14} /></span>}</p>}
    <div className="app-manifest-status"><span>{protection}</span></div>
    {error && <p className="app-details-warning" role="alert">{message(error)}</p>}
    {entry.declaringPackage && <dl><div><dt>{t("Declared by")}</dt><dd><code>{entry.declaringPackage}</code></dd></div></dl>}
  </li>
}

export function AppDetailTabs({ data, loading, app, header, children }: { data: AppDetails | null | undefined; loading: boolean; app: AndroidApp; header: ReactNode; children: ReactNode }) {
  const controls = usePermissionActions(app, loading)
  return <ApplicationDetailTabs data={data} loading={loading} disabled={!app.enabled} controls={controls} header={header}>{children}</ApplicationDetailTabs>
}

// The local APK view shares the layout without subscribing to Android permission actions.
export function ApplicationDetailTabs({ data, loading = false, disabled = false, local = false, controls, header, children, contents }: {
  data?: { components?: DetailComponent[]; requestedPermissions?: DetailPermission[] } | null
  loading?: boolean; disabled?: boolean; local?: boolean; controls?: ReturnType<typeof usePermissionActions>
  header: ReactNode; children: ReactNode; contents?: ReactNode
}) {
  const [selected, setSelected] = useState<Tab>('about')
  const [search, setSearch] = useState('')
  const id = useId(), tablist = useRef<HTMLDivElement>(null)
  const visibleTabs: { id: Tab; label: string }[] = contents ? [...tabs, { id: 'contents', label: t("APK contents") }] : [...tabs]
  const permissionTab = selected === 'permissions'
  const entries = permissionTab ? data?.requestedPermissions : data?.components?.filter(entry => entry.type === selected)
  const query = search.trim().toLocaleLowerCase()
  const shown = entries?.filter(entry => Object.values(entry).some(value => typeof value === 'string' && value.toLocaleLowerCase().includes(query))).slice().sort((a, b) => a.name.localeCompare(b.name))
  const choose = (next: Tab) => {
    setSelected(next); setSearch('')
    const scroll = tablist.current?.closest('.app-details-scroll')
    if (scroll) scroll.scrollTop = 0
  }
  return <>
    <div ref={tablist} className="app-detail-tabs" role="tablist" aria-label={t("Application detail tabs")}>
      {visibleTabs.map((tab, index) => <button key={tab.id} id={`${id}-${tab.id}`} type="button" role="tab" aria-selected={selected === tab.id} aria-controls={`${id}-panel-${tab.id}`} tabIndex={selected === tab.id ? 0 : -1} onClick={() => choose(tab.id)} onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % visibleTabs.length : event.key === 'ArrowLeft' ? (index + visibleTabs.length - 1) % visibleTabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? visibleTabs.length - 1 : -1
        if (next < 0) return
        event.preventDefault(); choose(visibleTabs[next].id); tablist.current?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next].focus()
      }}>{tab.label}</button>)}
    </div>
    {header}
    {visibleTabs.map(tab => <div key={tab.id} role="tabpanel" id={`${id}-panel-${tab.id}`} aria-labelledby={`${id}-${tab.id}`} hidden={selected !== tab.id} tabIndex={0} className="app-detail-tab-panel">
      {selected === tab.id && (selected === 'about' ? children : selected === 'contents' ? contents : <>
        <div className="app-manifest-toolbar"><div className="component-search"><Search size={15} /><input type="search" aria-label={t("Search {0}", [tab.label.toLowerCase()])} placeholder={permissionTab ? t("Permission name…") : t("Component name…")} value={search} onChange={event => setSearch(event.target.value)} /></div><span>{entries ? t("{0} of {1}", [shown!.length, entries.length]) : '—'}</span>
          <span className="app-permission-help" tabIndex={0} title={local ? t("Declarations from the APK manifest. Resource references are shown as @0x identifiers. Android defaults may apply to omitted attributes. Installed state and permission grants are not available in a local APK.") : permissionTab ? t("Permissions requested by this application. Grant state is for the selected Android profile; AppOps and other restrictions may still limit access. This is not a history of permission use.") : t("Manifest components, including disabled entries and activity aliases. Enabled describes the component setting, not whether it is running. Runtime-registered receivers are not included.")} aria-label={local ? t("About APK manifest declarations") : permissionTab ? t("About requested permissions and grant state") : t("About component states")}><Info size={15} /></span>
        </div>
        {!permissionTab && disabled && <p className="app-details-warning">{t("The application is disabled for this profile, including components marked Enabled.")}</p>}
        {local && <p className="app-details-warning">{permissionTab ? t("Requested in the APK manifest. Permission grants depend on the Android device and profile.") : t("Declared in the APK manifest, including activity aliases. Omitted attributes use Android defaults; these are not live component states.")}</p>}
        {entries === undefined ? <p className="app-manifest-empty" role="status">{loading ? t("Reading application information…") : t("Information unavailable. Use Refresh applications to retry.")}</p> : !entries.length ? <p className="app-manifest-empty">{permissionTab ? t("No requested permissions.") : t("No {0} declared.", [tab.label.toLowerCase()])}</p> : !shown!.length ? <p className="app-manifest-empty">{t("No matches.")}</p> : <ul className="app-manifest-list" aria-label={tab.label}>{shown!.map((entry, index) => permissionTab ? local ? <li className="app-manifest-row" key={`${entry.name}-${index}`}><div className="app-manifest-row-heading"><code>{entry.name}</code><CopyName name={entry.name} /></div><div className="app-manifest-status"><span>{t("Requested in manifest")}</span></div><ManifestFields attributes={(entry as DetailPermission).manifestAttributes} /></li> : <PermissionRow key={`${entry.name}-${index}`} entry={entry as AppPermission} controls={controls!} /> : <ComponentRow key={`${entry.name}-${index}`} entry={entry as DetailComponent} local={local} />)}</ul>}
      </>)}
    </div>)}
  </>
}
