import { RemovedAppsInspector } from '../sections/RemovedAppsSection'
import { useAppsStore } from '../store/useAppsStore'
import { useAppStore } from '../store/useAppStore'
import { appKind } from './AppsTable'
import { AppInspectorHeading } from './AppInspectorHeading'
import { formatApkSize, formatStorageSize } from '../lib/appView'
import { AppsActions } from './AppsActions'
const date = (value: number) => value ? new Date(value).toLocaleString('en-US') : "Unavailable"
export function AppsInspector() {
  const { apps, selectedPackage } = useAppsStore()
  const tab = useAppStore(s => s.inspectorTab)
  const view = useAppStore(s => s.appsView)
  if (view === 'removed') return <RemovedAppsInspector />
  if (view === 'notes') return <><span className="eyebrow">PERSONAL DATABASE</span><p className="component-description">Labels and notes belong to the package across every phone. Original phone, profile, app version and dates stay with each record. Export this database to keep a copy or move it to another computer.</p></>
  const app = apps.find(a => a.packageName === selectedPackage)
  if (tab === 'actions') return <AppsActions />
  if (!app) return <><span className="eyebrow">APP DETAILS</span><p className="component-description">Select an application to see its package, version, installation dates and Android flags.</p></>
  const values = [
    ["Data (includes cache)", app.storageRequested ? formatStorageSize(app.dataBytes) : "Not collected"], ["Cache", app.storageRequested ? formatStorageSize(app.cacheBytes) : "Not collected"],
    ["APK size", formatApkSize(app.apkSizeBytes)], ["Package layout", app.splitCount == null ? "Unavailable" : app.splitCount > 0 ? `Split APK · base + ${app.splitCount} splits` : "Single APK"],
    ["Type", appKind(app)], ["State", app.enabled ? "Enabled" : "Disabled"], ["Version code", app.versionCode], ['UID', app.uid], ["Android user", app.userId], ["Target SDK", app.targetSdk], ["Minimum SDK", app.minSdk], ["Installed", date(app.firstInstallTime)], ["Updated", date(app.lastUpdateTime)], ["Installer", app.installer || "Not reported"], ["Debuggable", app.debuggable ? "Yes" : "No"], ["Suspended", app.suspended ? "Yes" : "No"], ["Stopped flag", app.stopped ? "Set" : "Not set"], ["Enabled setting", app.enabledState === null ? "Unavailable" : ['Default', 'Enabled', 'Disabled', "Disabled by user", "Disabled until used"][app.enabledState]],
  ]
  return <><span className="eyebrow">APP DETAILS</span><AppInspectorHeading app={app} /><dl className="metadata app-metadata">{values.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl><div className="location-field"><span className="field-label">APK location on device</span><code>{app.sourceDir || "Unavailable"}</code></div>{(app.iconError || app.labelError) && <p className="component-description">{app.labelError && `Label: ${app.labelError}. `}{app.iconError && `Icon: ${app.iconError}`}</p>}{app.storageError && <p className="component-description">{"Storage unavailable: "}{app.storageError}</p>}<p className="component-description">{"APK size includes the base APK and installed splits, excluding app data, cache and extracted native libraries. "}{app.sizeError && `Size unavailable: ${app.sizeError}`}</p><p className="component-description">The stopped flag is Android package state; it does not indicate whether a process is currently running.</p></>
}
