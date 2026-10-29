import { t as translateUi } from '../lib/i18n'
import { locale as uiLocale } from '../lib/i18n'
import { t } from "../lib/i18n"
import { RemovedAppsInspector } from '../sections/RemovedAppsSection'
import { useAppsStore } from '../store/useAppsStore'
import { useAppStore } from '../store/useAppStore'
import { appKind } from './AppsTable'
import { AppInspectorHeading } from './AppInspectorHeading'
import { formatApkSize, formatStorageSize } from '../lib/appView'
import { AppsActions } from './AppsActions'
const date = (value: number) => value ? new Date(value).toLocaleString(uiLocale()) : t("Unavailable")
export function AppsInspector() {
  const { apps, selectedPackage } = useAppsStore()
  const tab = useAppStore(s => s.inspectorTab)
  const view = useAppStore(s => s.appsView)
  if (view === 'removed') return <RemovedAppsInspector />
  if (view === 'notes') return <><span className="eyebrow">{t("PERSONAL DATABASE")}</span><p className="component-description">{t("Labels and notes belong to the package across every phone. Original phone, profile, app version and dates stay with each record. Export this database to keep a copy or move it to another computer.")}</p></>
  const app = apps.find(a => a.packageName === selectedPackage)
  if (tab === 'actions') return <AppsActions />
  if (!app) return <><span className="eyebrow">{t("APP DETAILS")}</span><p className="component-description">{t("Select an application to see its package, version, installation dates and Android flags.")}</p></>
  const values = [
    [t("Data (includes cache)"), app.storageRequested ? formatStorageSize(app.dataBytes) : t("Not collected")], [t("Cache"), app.storageRequested ? formatStorageSize(app.cacheBytes) : t("Not collected")],
    [t("APK size"), formatApkSize(app.apkSizeBytes)], [t("Package layout"), app.splitCount == null ? t("Unavailable") : app.splitCount > 0 ? translateUi("Split APK · base + {0} splits", [app.splitCount]) : t("Single APK")],
    [t("Type"), appKind(app)], [t("State"), app.enabled ? t("Enabled") : t("Disabled")], [t("Version code"), app.versionCode], ['UID', app.uid], [t("Android user"), app.userId], [t("Target SDK"), app.targetSdk], [t("Minimum SDK"), app.minSdk], [t("Installed"), date(app.firstInstallTime)], [t("Updated"), date(app.lastUpdateTime)], [t("Installer"), app.installer || t("Not reported")], [t("Debuggable"), app.debuggable ? t("Yes") : t("No")], [t("Suspended"), app.suspended ? t("Yes") : t("No")], [t("Stopped flag"), app.stopped ? t("Set") : t("Not set")], [t("Enabled setting"), app.enabledState === null ? t("Unavailable") : ['Default', 'Enabled', 'Disabled', translateUi("Disabled by user"), translateUi("Disabled until used")][app.enabledState]],
  ]
  return <><span className="eyebrow">{t("APP DETAILS")}</span><AppInspectorHeading app={app} /><dl className="metadata app-metadata">{values.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl><div className="location-field"><span className="field-label">{t("APK location on device")}</span><code>{app.sourceDir || t("Unavailable")}</code></div>{(app.iconError || app.labelError) && <p className="component-description">{app.labelError && t("Label: {0}. ", [app.labelError])}{app.iconError && t("Icon: {0}", [app.iconError])}</p>}{app.storageError && <p className="component-description">{t("Storage unavailable: ")}{app.storageError}</p>}<p className="component-description">{t("APK size includes the base APK and installed splits, excluding app data, cache and extracted native libraries. ")}{app.sizeError && t("Size unavailable: {0}", [app.sizeError])}</p><p className="component-description">{t("The stopped flag is Android package state; it does not indicate whether a process is currently running.")}</p></>
}
