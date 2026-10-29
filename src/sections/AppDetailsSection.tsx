import { t as localeText } from '../lib/i18n'
import { t as translateUi } from '../lib/i18n'
import { locale as uiLocale } from '../lib/i18n'
import { message } from "../lib/i18n"
import { t } from "../lib/i18n"
import { AppNotesSummary } from '../components/AppNotes'
import { copyText } from '../lib/clipboard'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { ArrowLeft, Copy } from 'lucide-react'
import { LatticeLoader } from '../components/operation-chip/OperationChip'
import type { AndroidApp } from '../../electron/apps-protocol'
import { AppIcon, appKind } from '../components/AppsTable'
import { formatApkSize, formatStorageSize } from '../lib/appView'
import { storageTotals } from '../lib/appDetails'
import { AppBadges } from '../components/AppBadges'
import { ApkAnalysis } from '../components/ApkAnalysis'
import { AppDetailTabs } from '../components/AppDetailTabs'
import { readAppDetails, useAppsStore } from '../store/useAppsStore'
import { useAppStore } from '../store/useAppStore'

const date = (value: number) => value > 0 ? new Date(value).toLocaleString(uiLocale()) : t("Unavailable")
function Fields({ values }: { values: [string, string | number][] }) {
  return <dl className="app-full-fields">{values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
}
function CopyValue({ value, label }: { value: string; label: string }) {
  return <button className="icon-button" aria-label={t("Copy {0}", [label])} onClick={() => void copyText(value).then(() => useAppStore.getState().notify("Copied"), () => useAppStore.getState().notify("Could not copy to the clipboard."))}><Copy size={14} /></button>
}
export function AppDetailsSection({ app, deviceName, profileName, onBack }: { app: AndroidApp; deviceName: string; profileName?: string; onBack: () => void }) {
  const back = useRef<HTMLButtonElement>(null)
  const { deviceId, details, status: appsStatus } = useAppsStore()
  const state = details?.deviceId === deviceId && details?.userId === app.userId && details?.packageName === app.packageName ? details : null
  const data = state?.data
  const loading = appsStatus === 'loading' || state?.status === 'loading'
  const missingDetails = state === null
  useLayoutEffect(() => { back.current?.focus({ preventScroll: true }) }, [])
  useEffect(() => {
    if (deviceId && appsStatus === 'ready' && missingDetails) void readAppDetails(deviceId, app.userId, app.packageName)
  }, [deviceId, app.userId, app.packageName, missingDetails, appsStatus])
  const fields = data?.fields || {}
  const storage = data?.storage || { requested: !!app.storageRequested, appBytes: null, dataBytes: app.dataBytes ?? null, cacheBytes: app.cacheBytes ?? null }
  const totals = storageTotals(storage)
  const size = (bytes: number | null) => storage.requested ? formatStorageSize(bytes) : t("Not collected")
  const issues = (areas: string[]) => data?.issues.filter(issue => areas.includes(issue.area)).map((issue, index) => <p className="app-details-warning" key={`${issue.area}-${index}`}>{t(issue.area)}{t(" unavailable: ")}{message(issue.message)}</p>)
  const policy = fields.hiddenApiPolicy ? ({ '-1': t("Default"), '0': t("Disabled"), '1': t("Warn"), '2': t("Enforced") }[fields.hiddenApiPolicy] || fields.hiddenApiPolicy) : t("Unavailable")
  return <section className="section-content app-full-details" aria-label={t("Application details")}>
    <div className="app-details-navigation"><button ref={back} className="button secondary" onClick={onBack} aria-label={t("Back to Apps")}><ArrowLeft size={15} />{t("Apps")}</button></div>
    <div className="app-details-scroll" tabIndex={0} role="region" aria-label={t("Application information")}>
      <AppDetailTabs key={`${deviceId}-${app.userId}-${app.packageName}`} data={data} loading={loading} app={app} header={<>
      <header className="app-full-heading"><AppIcon app={app} /><div><div className="app-title-line"><h1 title={app.label}>{app.label}</h1><AppNotesSummary app={app} compact /></div><div className="app-package-line"><code>{app.packageName}</code><CopyValue value={app.packageName} label={localeText("package name")} /></div><p>{deviceName} · {profileName ? `${profileName} · ` : ''}{t("User {0}", [app.userId])}</p><AppBadges app={app} data={data} /></div></header>
      {loading && <p className="apps-preload-note" role="status"><LatticeLoader />{localeText("Reading information for this application…")}</p>}
      {state?.error && <p className="app-details-warning" role="alert">{localeText("Could not read extended details: ")}{message(state.error)}{localeText(". Use Refresh applications to retry.")}</p>}
      </>}>
      <div className="app-details-groups">
        <section aria-label={t("Package")}><h2>{t("About application")}</h2><Fields values={[
          [t("Type"), appKind(app)], [t("Version"), app.versionName || t("Unavailable")], [t("Version code"), app.versionCode], ['UID', app.uid],
          [t("Target SDK"), app.targetSdk || t("Unavailable")], [t("Minimum SDK"), app.minSdk || t("Unavailable")],
          [t("Main activity"), fields.mainActivity || (data ? t("No launcher activity reported") : t("Not collected"))],
          [t("Process name"), fields.processName || t("Unavailable")], [t("Shared user ID"), fields.sharedUserId || (data ? t("Not reported") : t("Not collected"))],
          [t("Primary ABI"), fields.primaryCpuAbi || t("Not reported")], [t("Secondary ABI"), fields.secondaryCpuAbi || t("Not reported")],
        ]} />{issues(['Main activity', 'primaryCpuAbi', 'secondaryCpuAbi'])}</section>
        <section aria-label={t("Storage")}><h2>{t("Storage & cache")}</h2><Fields values={[
          [t("APK files"), formatApkSize(app.apkSizeBytes)], [t("Package layout"), app.splitCount == null ? t("Unavailable") : app.splitCount ? translateUi("Split APK · base + {0} splits", [app.splitCount]) : t("Single APK")],
          [t("Installed application"), size(storage.appBytes)], [t("Data (excluding cache)"), size(totals.dataWithoutCache)], [t("Cache"), size(storage.cacheBytes)], [t("Total installed storage"), size(totals.total)],
        ]} /><p>{t("Installed application includes APKs, compiled code and native libraries. Total = installed application + data including cache. APK files are shown separately and are not added again.")}</p>{!storage.requested && <p>{t("Enable storage sizes in Settings → Apps, then refresh details to collect these sizes.")}</p>}{app.sizeError && <p className="app-details-warning">{t("APK size unavailable: ")}{message(app.sizeError)}</p>}{!data && app.storageError && <p className="app-details-warning">{t("Storage unavailable: ")}{message(app.storageError)}</p>}{issues(['Storage'])}{storage.dataBytes != null && storage.cacheBytes != null && storage.cacheBytes > storage.dataBytes && <p className="app-details-warning">{t("Android returned cache larger than data. Data excluding cache is unavailable.")}</p>}</section>
        <section aria-label={t("Installation")}><h2>{t("Installation")}</h2><Fields values={[
          [t("Installed"), date(app.firstInstallTime)], [t("Updated"), date(app.lastUpdateTime)],
        ]} />{data?.installers.length ? data.installers.map(installer => <div className="app-install-source" key={installer.role}><span>{t(installer.role)}</span><strong>{installer.label || (installer.packageName ? t("Name unavailable") : t("Not reported"))}</strong>{installer.packageName && <div className="app-package-line"><code>{installer.packageName}</code><CopyValue value={installer.packageName} label={t(installer.role)} /></div>}</div>) : <Fields values={ [[t("Installer"), app.installer || t("Not reported")]] } />}{issues(["Install source", 'Installer'])}</section>
        <section aria-label={t("Network")}><h2>{t("Data usage")}</h2>{data ? <><p>{t("Last 30 days · ")}{date(data.network.start)} — {date(data.network.end)}</p><Fields values={[
          [t("Wi-Fi sent"), formatStorageSize(data.network.wifi?.tx)], [t("Wi-Fi received"), formatStorageSize(data.network.wifi?.rx)],
          [t("Mobile sent"), formatStorageSize(data.network.mobile?.tx)], [t("Mobile received"), formatStorageSize(data.network.mobile?.rx)],
        ]} /><p>{t("Android statistics for UID ")}{app.uid}{t("; apps sharing this UID share these counters. Whole time buckets within the period; recent traffic may not be recorded yet.")}</p></> : <p>{loading ? t("Reading network statistics…") : t("Not collected")}</p>}{issues(["Wi-Fi traffic", "Mobile traffic"])}</section>
        <section aria-label={t("Paths and directories")} className="app-details-wide"><h2>{t("Paths & directories")}</h2><p>{t("Paths are reported by Android. Knowing a path does not grant access to its contents.")}</p>{(data?.paths || (app.sourceDir ? [{ name: translateUi("Base APK"), path: app.sourceDir }] : [])).map(path => <div className="app-full-path" key={path.name}><span>{t(path.name)}</span><div className="app-copy-path"><code>{path.path}</code><CopyValue value={path.path} label={t(path.name)} /></div></div>)}{issues(["Credential-protected data"])}{!!data?.splits.length && <><h3>{t("Installed split APKs")}</h3><div className="app-split-list">{data.splits.map(split => <div key={split.path}><div><strong>{split.name}</strong><code>{split.path}</code></div><span>{formatStorageSize(split.bytes)}</span><CopyValue value={split.path} label={split.name} /></div>)}</div></>}{issues(["Split APK size"])}</section>
        <section aria-label={t("Android state")}><h2>{t("Android state")}</h2><Fields values={[
          [t("Enabled setting"), app.enabledState === null ? t("Unavailable") : t(['Default', 'Enabled', 'Disabled', 'Disabled by user', 'Disabled until used'][app.enabledState] || 'Unavailable')],
          [t("Debuggable"), app.debuggable ? t("Yes") : t("No")], [t("Suspended"), app.suspended ? t("Yes") : t("No")], [t("Stopped flag"), app.stopped ? t("Set") : t("Not set")],
          [t("Hidden"), data?.badges.hidden == null ? t("Unavailable") : data.badges.hidden ? t("Yes") : t("No")],
          [t("Battery optimisation"), data?.badges.batteryExempt == null ? t("Unavailable") : data.badges.batteryExempt ? t("Exempt") : t("Not exempt")],
          [t("Hidden API policy"), policy], [t("SELinux seInfo"), fields.seInfo || t("Unavailable")], [t("SELinux user suffix"), fields.seInfoUser || t("Not reported")],
          [t("Zygote preload"), fields.zygotePreloadName || t("Not reported")],
        ]} /><p>{t("Stopped is a package flag, not a running-process check. SELinux values are package labelling metadata, not a live process context. Hidden API policy is reported by the framework, not a guarantee of enforcement.")}</p>{issues(['Hidden state', 'Battery optimisation', 'Hidden API policy', 'seInfo', 'seInfoUser', 'zygotePreloadName', 'Static shared library'])}</section>
        <section aria-label={t("App links")}><h2>{t("App links")}</h2><Fields values={ [[t("Link handling"), fields.linkHandling || (data?.badges.openLinks === false ? t("No web domains reported") : t("Unavailable"))]] } />{data?.links.map(link => <div className="app-link-domain" key={link.host}><code>{link.host}</code><span>{link.state}</span></div>)}{issues(['App links'])}</section>
        <ApkAnalysis key={`${deviceId}-${app.userId}-${app.packageName}`} analysis={data?.analysis} />
        <section aria-label={t("Application flags")} className="app-details-wide"><h2>{t("Application flags")}</h2>{data ? <><p>{fields.flagsHex}{t(" · Android ApplicationInfo flags")}</p><div className="app-flag-list">{data.flags.map(flag => <code key={flag}>{flag}</code>)}</div></> : <p>{t("Not collected")}</p>}</section>
      </div>
      {app.labelError && <p className="app-details-warning">{t("Label: ")}{message(app.labelError)}</p>}{app.iconError && <p className="app-details-warning">{t("Icon: ")}{message(app.iconError)}</p>}
      </AppDetailTabs>
    </div>
  </section>
}
