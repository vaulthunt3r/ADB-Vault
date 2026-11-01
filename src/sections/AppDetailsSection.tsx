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

const date = (value: number) => value > 0 ? new Date(value).toLocaleString('en-US') : "Unavailable"
function Fields({ values }: { values: [string, string | number][] }) {
  return <dl className="app-full-fields">{values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
}
function CopyValue({ value, label }: { value: string; label: string }) {
  return <button className="icon-button" aria-label={`Copy ${label}`} onClick={() => void copyText(value).then(() => useAppStore.getState().notify("Copied"), () => useAppStore.getState().notify("Could not copy to the clipboard."))}><Copy size={14} /></button>
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
  const size = (bytes: number | null) => storage.requested ? formatStorageSize(bytes) : "Not collected"
  const issues = (areas: string[]) => data?.issues.filter(issue => areas.includes(issue.area)).map((issue, index) => <p className="app-details-warning" key={`${issue.area}-${index}`}>{issue.area}{" unavailable: "}{issue.message}</p>)
  const policy = fields.hiddenApiPolicy ? ({ '-1': "Default", '0': "Disabled", '1': "Warn", '2': "Enforced" }[fields.hiddenApiPolicy] || fields.hiddenApiPolicy) : "Unavailable"
  return <section className="section-content app-full-details" aria-label="Application details">
    <div className="app-details-navigation"><button ref={back} className="button secondary" onClick={onBack} aria-label="Back to Apps"><ArrowLeft size={15} />Apps</button></div>
    <div className="app-details-scroll" tabIndex={0} role="region" aria-label="Application information">
      <AppDetailTabs key={`${deviceId}-${app.userId}-${app.packageName}`} data={data} loading={loading} app={app} header={<>
      <header className="app-full-heading"><AppIcon app={app} /><div><div className="app-title-line"><h1 title={app.label}>{app.label}</h1><AppNotesSummary app={app} compact /></div><div className="app-package-line"><code>{app.packageName}</code><CopyValue value={app.packageName} label="package name" /></div><p>{deviceName} · {profileName ? `${profileName} · ` : ''}{`User ${app.userId}`}</p><AppBadges app={app} data={data} /></div></header>
      {loading && <p className="apps-preload-note" role="status"><LatticeLoader />Reading information for this application…</p>}
      {state?.error && <p className="app-details-warning" role="alert">{"Could not read extended details: "}{state.error}. Use Refresh applications to retry.</p>}
      </>}>
      <div className="app-details-groups">
        <section aria-label="Package"><h2>About application</h2><Fields values={[
          ["Type", appKind(app)], ["Version", app.versionName || "Unavailable"], ["Version code", app.versionCode], ['UID', app.uid],
          ["Target SDK", app.targetSdk || "Unavailable"], ["Minimum SDK", app.minSdk || "Unavailable"],
          ["Main activity", fields.mainActivity || (data ? "No launcher activity reported" : "Not collected")],
          ["Process name", fields.processName || "Unavailable"], ["Shared user ID", fields.sharedUserId || (data ? "Not reported" : "Not collected")],
          ["Primary ABI", fields.primaryCpuAbi || "Not reported"], ["Secondary ABI", fields.secondaryCpuAbi || "Not reported"],
        ]} />{issues(['Main activity', 'primaryCpuAbi', 'secondaryCpuAbi'])}</section>
        <section aria-label="Storage"><h2>{"Storage & cache"}</h2><Fields values={[
          ["APK files", formatApkSize(app.apkSizeBytes)], ["Package layout", app.splitCount == null ? "Unavailable" : app.splitCount ? `Split APK · base + ${app.splitCount} splits` : "Single APK"],
          ["Installed application", size(storage.appBytes)], ["Data (excluding cache)", size(totals.dataWithoutCache)], ["Cache", size(storage.cacheBytes)], ["Total installed storage", size(totals.total)],
        ]} /><p>Installed application includes APKs, compiled code and native libraries. Total = installed application + data including cache. APK files are shown separately and are not added again.</p>{!storage.requested && <p>Enable storage sizes in Settings → Apps, then refresh details to collect these sizes.</p>}{app.sizeError && <p className="app-details-warning">{"APK size unavailable: "}{app.sizeError}</p>}{!data && app.storageError && <p className="app-details-warning">{"Storage unavailable: "}{app.storageError}</p>}{issues(['Storage'])}{storage.dataBytes != null && storage.cacheBytes != null && storage.cacheBytes > storage.dataBytes && <p className="app-details-warning">Android returned cache larger than data. Data excluding cache is unavailable.</p>}</section>
        <section aria-label="Installation"><h2>Installation</h2><Fields values={[
          ["Installed", date(app.firstInstallTime)], ["Updated", date(app.lastUpdateTime)],
        ]} />{data?.installers.length ? data.installers.map(installer => <div className="app-install-source" key={installer.role}><span>{installer.role}</span><strong>{installer.label || (installer.packageName ? "Name unavailable" : "Not reported")}</strong>{installer.packageName && <div className="app-package-line"><code>{installer.packageName}</code><CopyValue value={installer.packageName} label={installer.role} /></div>}</div>) : <Fields values={ [["Installer", app.installer || "Not reported"]] } />}{issues(["Install source", 'Installer'])}</section>
        <section aria-label="Network"><h2>Data usage</h2>{data ? <><p>{"Last 30 days · "}{date(data.network.start)} — {date(data.network.end)}</p><Fields values={[
          ["Wi-Fi sent", formatStorageSize(data.network.wifi?.tx)], ["Wi-Fi received", formatStorageSize(data.network.wifi?.rx)],
          ["Mobile sent", formatStorageSize(data.network.mobile?.tx)], ["Mobile received", formatStorageSize(data.network.mobile?.rx)],
        ]} /><p>{"Android statistics for UID "}{app.uid}; apps sharing this UID share these counters. Whole time buckets within the period; recent traffic may not be recorded yet.</p></> : <p>{loading ? "Reading network statistics…" : "Not collected"}</p>}{issues(["Wi-Fi traffic", "Mobile traffic"])}</section>
        <section aria-label="Paths and directories" className="app-details-wide"><h2>{"Paths & directories"}</h2><p>Paths are reported by Android. Knowing a path does not grant access to its contents.</p>{(data?.paths || (app.sourceDir ? [{ name: "Base APK", path: app.sourceDir }] : [])).map(path => <div className="app-full-path" key={path.name}><span>{path.name}</span><div className="app-copy-path"><code>{path.path}</code><CopyValue value={path.path} label={path.name} /></div></div>)}{issues(["Credential-protected data"])}{!!data?.splits.length && <><h3>Installed split APKs</h3><div className="app-split-list">{data.splits.map(split => <div key={split.path}><div><strong>{split.name}</strong><code>{split.path}</code></div><span>{formatStorageSize(split.bytes)}</span><CopyValue value={split.path} label={split.name} /></div>)}</div></>}{issues(["Split APK size"])}</section>
        <section aria-label="Android state"><h2>Android state</h2><Fields values={[
          ["Enabled setting", app.enabledState === null ? "Unavailable" : ['Default', 'Enabled', 'Disabled', 'Disabled by user', 'Disabled until used'][app.enabledState] || 'Unavailable'],
          ["Debuggable", app.debuggable ? "Yes" : "No"], ["Suspended", app.suspended ? "Yes" : "No"], ["Stopped flag", app.stopped ? "Set" : "Not set"],
          ["Hidden", data?.badges.hidden == null ? "Unavailable" : data.badges.hidden ? "Yes" : "No"],
          ["Battery optimisation", data?.badges.batteryExempt == null ? "Unavailable" : data.badges.batteryExempt ? "Exempt" : "Not exempt"],
          ["Hidden API policy", policy], ["SELinux seInfo", fields.seInfo || "Unavailable"], ["SELinux user suffix", fields.seInfoUser || "Not reported"],
          ["Zygote preload", fields.zygotePreloadName || "Not reported"],
        ]} /><p>Stopped is a package flag, not a running-process check. SELinux values are package labelling metadata, not a live process context. Hidden API policy is reported by the framework, not a guarantee of enforcement.</p>{issues(['Hidden state', 'Battery optimisation', 'Hidden API policy', 'seInfo', 'seInfoUser', 'zygotePreloadName', 'Static shared library'])}</section>
        <section aria-label="App links"><h2>App links</h2><Fields values={ [["Link handling", fields.linkHandling || (data?.badges.openLinks === false ? "No web domains reported" : "Unavailable")]] } />{data?.links.map(link => <div className="app-link-domain" key={link.host}><code>{link.host}</code><span>{link.state}</span></div>)}{issues(['App links'])}</section>
        <ApkAnalysis key={`${deviceId}-${app.userId}-${app.packageName}`} analysis={data?.analysis} />
        <section aria-label="Application flags" className="app-details-wide"><h2>Application flags</h2>{data ? <><p>{fields.flagsHex}{" · Android ApplicationInfo flags"}</p><div className="app-flag-list">{data.flags.map(flag => <code key={flag}>{flag}</code>)}</div></> : <p>Not collected</p>}</section>
      </div>
      {app.labelError && <p className="app-details-warning">{"Label: "}{app.labelError}</p>}{app.iconError && <p className="app-details-warning">{"Icon: "}{app.iconError}</p>}
      </AppDetailTabs>
    </div>
  </section>
}
