import { useMemo, type ReactNode } from 'react'
import { Copy } from 'lucide-react'
import type { InspectedApk } from '../../electron/apk-inspector-protocol'
import type { BadgeCheck } from '../../electron/app-details-protocol'
import { badgeCatalog, type BadgeKey, type appBadges } from '../lib/appDetails'
import { copyText } from '../lib/clipboard'
import { formatStorageSize } from '../lib/appView'
import { useAppStore } from '../store/useAppStore'
import { ApplicationDetailTabs, type DetailComponent, type DetailPermission } from './AppDetailTabs'
import { ApplicationBadges } from './AppBadges'
import { AppIcon } from './AppsTable'
import { ApkAnalysis } from './ApkAnalysis'

const signatureText = { verified: "Valid signature", invalid: 'Invalid / unsigned', unavailable: "Signature not verified" }
function Fields({ values }: { values: [string, string | number][] }) {
  return <dl className="app-full-fields">{values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
}
function CopyValue({ value, label }: { value: string; label: string }) {
  return <button className="icon-button" aria-label={`Copy ${label}`} onClick={() => void copyText(value).then(() => useAppStore.getState().notify("Copied"), () => useAppStore.getState().notify("Could not copy to the clipboard."))}><Copy size={14} /></button>
}
function localBadges(apk: InspectedApk) {
  const checks = Object.fromEntries(badgeCatalog.map(([key]): [BadgeKey, BadgeCheck] => [key, { present: null, reason: "This property requires Android installation or device state and is unavailable in a local APK.", items: [] }])) as Record<BadgeKey, BadgeCheck>
  const badges: ReturnType<typeof appBadges> = []
  const add = (key: BadgeKey, label: string, present: boolean | null, reason: string, items: BadgeCheck['items'] = [], tone: 'neutral' | 'orange' = 'neutral') => {
    const check = { present, reason, items }; checks[key] = check
    if (present) badges.push({ key, label, check, tone, interactive: !!items.length })
  }
  const matches = apk.analysis?.trackers ?? []
  add('trackers', `${matches.length} ${matches.length === 1 ? 'tracker' : 'trackers'}`, matches.length ? true : apk.analysis?.status === 'complete' ? false : null,
    "Distinct tracker signatures found in defined DEX classes. This is a static scan, not a runtime activity check.", matches.map(m => ({ name: m.name, value: `${m.count} class matches · ${m.signature}` })), 'orange')
  add('type', 'APK file', true, "A local Android package. System/user installation type is not stored in the APK.")
  add('splits', 'Split APK', !!apk.manifest.split, apk.manifest.split ? `Split name: ${apk.manifest.split}. Only this file was inspected.` : "This file has no split name. Other APK files are not inferred.", apk.manifest.split ? [{ name: apk.manifest.split, value: apk.name }] : [])
  for (const [key, label, attr, inverse] of [
    ['debuggable', 'Debuggable', 'debuggable', false], ['testOnly', 'Test only', 'testOnly', false],
    ['noCode', 'No code', 'hasCode', true], ['largeHeap', 'Large heap', 'largeHeap', false],
  ] as const) {
    const value = apk.manifest.application[`android:${attr}`]
    const parsed = value === 'true' || value === '1' ? true : value === 'false' || value === '0' ? false : undefined
    add(key, label, parsed === undefined ? value === undefined ? false : null : inverse ? !parsed : parsed, value === undefined ? `android:${attr} is not declared; the manifest default does not enable this badge.` : `APK manifest: android:${attr}=${value}.`)
  }
  return { checks, badges }
}
export function LocalApkDetails({ apk, contents }: { apk: InspectedApk; contents: ReactNode }) {
  const m = apk.manifest, badges = useMemo(() => localBadges(apk), [apk])
  const data = useMemo(() => ({
    components: m.components.map((c): DetailComponent => ({ name: c.name, type: c.kind === 'service' ? "Service" : c.kind === 'receiver' ? "Receiver" : c.kind === 'provider' ? "Provider" : "Activity", enabled: null, manifestAttributes: c.attributes, filters: c.filters })),
    requestedPermissions: m.permissions.map((p): DetailPermission => ({ name: p.name, granted: null, protectionLevel: null, declaringPackage: null, label: null, description: null, manifestAttributes: p.attributes })),
  }), [m])
  const analysis = useMemo(() => {
    if (!apk.analysis) return undefined
    const classified = Object.values(apk.categories).reduce((sum, n) => sum + n, 0)
    const categories = classified <= apk.bytes ? { ...apk.categories, other: apk.categories.other + apk.bytes - classified } : null
    return { ...apk.analysis, artifacts: apk.analysis.artifacts.map(a => ({ ...a, path: apk.name, size: { bytes: apk.bytes, categories, ...(categories ? {} : { error: "Archive entry sizes exceed the file size; composition is unavailable." }) } })), addresses: apk.analysis.addresses && { ...apk.analysis.addresses, domains: apk.analysis.addresses.domains.map(a => ({ ...a, sources: a.sources.map(s => ({ ...s, apk: apk.name })) })), urls: apk.analysis.addresses.urls.map(a => ({ ...a, sources: a.sources.map(s => ({ ...s, apk: apk.name })) })) } }
  }, [apk])
  return <div className="apk-local-details">
    <ApplicationDetailTabs data={data} local contents={contents} header={<>
      <header className="app-full-heading"><AppIcon app={{ iconPng: null }} /><div><h1>{apk.label}</h1><div className="app-package-line"><code>{m.packageName}</code><CopyValue value={m.packageName} label="package name" /></div><p>{m.versionName || "No version name"} · {m.versionCode || '—'} · {formatStorageSize(apk.bytes)}{" · Local APK"}</p><ApplicationBadges identity={apk.sha256} {...badges} local /></div></header>
      {!!apk.issues.length && <details className="apk-warning"><summary>{"Analysis warnings · "}{apk.issues.length}</summary>{apk.issues.map((issue, i) => <p key={i}>{issue}</p>)}</details>}
    </>}>
      <div className="app-details-groups">
        <section aria-label="Package"><h2>About application</h2><Fields values={[
          ["Type", m.split ? "Split APK" : "Base / standalone APK"], ["Version", m.versionName || "Not declared"], ["Version code", m.versionCode || "Not declared"],
          ["Target SDK", m.targetSdk], ["Minimum SDK", m.minSdk], ["Split name", m.split || "Not declared"], ["Native ABIs", apk.abis.join(', ') || "No native libraries"],
          ["Process name", m.application['android:process'] || m.packageName], ["Application class", m.application['android:name'] || "Default Android application"],
        ]} /></section>
        <section aria-label="APK signature"><h2>APK signature</h2><Fields values={[
          ["Integrity", signatureText[apk.signature.status]], ["Verified schemes", apk.signature.schemes.join(', ') || "None"], ["Signers", apk.signature.signers.length],
        ]} />{apk.signature.signers.map((signer, i) => <div className="apk-signer" key={i}><strong>{signer.name}</strong><div className="app-copy-path"><code>{signer.sha256}</code><CopyValue value={signer.sha256} label={`signer ${i + 1} SHA-256`} /></div></div>)}<p>A valid signature confirms file integrity, not publisher trust or application safety.</p><details className="apk-verifier"><summary>Verification details</summary><pre>{apk.signature.diagnostics}</pre></details></section>
        <section aria-label="Local APK file" className="app-details-wide"><h2>APK file</h2><div className="app-full-path"><span>Local path</span><div className="app-copy-path"><code>{apk.path}</code><CopyValue value={apk.path} label="APK path" /></div></div><div className="app-full-path"><span>SHA-256</span><div className="app-copy-path"><code>{apk.sha256}</code><CopyValue value={apk.sha256} label="APK SHA-256" /></div></div><Fields values={[
          ["File size", `${formatStorageSize(apk.bytes)} · ${apk.bytes.toLocaleString('en-US')} bytes`], ["Archive entries", apk.entries.length], ["Inspected", new Date(apk.inspectedAt).toLocaleString('en-US')],
        ]} /></section>
        <ApkAnalysis analysis={analysis} local />
        <section aria-label="Application manifest" className="app-details-wide"><h2>Application manifest</h2><Fields values={Object.entries(m.application).map(([name, value]) => [name.replace(/^android:/, ''), value])} /><p>Attributes are shown as stored. Resource references remain @0x identifiers; omitted attributes use Android defaults.</p>{!!m.features.length && <><h3>{"Features & dependencies"}</h3><div className="app-flag-list">{m.features.map((feature, i) => <code key={i}>{feature}</code>)}</div></>}</section>
      </div>
    </ApplicationDetailTabs>
  </div>
}
