import { locale as uiLocale } from '../lib/i18n'
import { t, message } from "../lib/i18n"
import { useState } from 'react'
import { Info } from 'lucide-react'
import { apkSizeCategories, type ApkAnalysis, type ApkSizeCategory } from '../../electron/database-protocol'
import { formatStorageSize } from '../lib/appView'

type Category = ApkSizeCategory | 'unknown'
const labels: Record<Category, string> = { code: 'Code · DEX', get native() { return t("Native libraries") }, get resources() { return t("Resources") }, get assets() { return t("Assets") }, get other() { return t("Other") }, get unknown() { return t("Not classified") } }
const descriptions: Record<Category, string> = {
  code: 'DEX files, including DEX files in assets.', native: 'Native .so libraries, including libraries in assets.',
  resources: 'The res/ directory and resources.arsc.', assets: 'Remaining files in assets/.',
  other: 'Other files, manifest, ZIP headers, index, signing data and alignment.', unknown: 'APK size is known, but its contents could not be classified.',
}
const exact = (bytes: number) => `${bytes.toLocaleString(uiLocale())} bytes`
const percent = (bytes: number, total: number) => {
  if (!total || !bytes) return '0%'
  const value = bytes / total * 100
  return value < 0.1 ? '<0.1%' : `${new Intl.NumberFormat(uiLocale(), { maximumFractionDigits: 1 }).format(value)}%`
}
export function ApkComposition({ artifacts, local = false }: { artifacts: ApkAnalysis['artifacts']; local?: boolean }) {
  const [showInfo, setShowInfo] = useState(false)
  const measured = artifacts.filter(a => a.size?.bytes != null)
  const classified = artifacts.filter(a => a.size?.categories != null)
  const total = measured.reduce((sum, a) => sum + a.size!.bytes!, 0)
  const counts: Record<Category, number> = { code: 0, native: 0, resources: 0, assets: 0, other: 0, unknown: 0 }
  for (const a of measured) {
    if (a.size!.categories) for (const key of apkSizeCategories) counts[key] += a.size!.categories[key]
    else counts.unknown += a.size!.bytes!
  }
  const categories: Category[] = [...apkSizeCategories, ...(counts.unknown > 0 ? ['unknown' as const] : [])]
  const hasSize = artifacts.some(a => a.size !== undefined)
  const partial = classified.length < artifacts.length
  return <section className="apk-composition" aria-label={t("APK size composition")}>
    <div className="apk-analysis-heading"><h3>{t("APK size composition")}</h3><button className="icon-button" title={t("About APK sizes")} aria-label={t("About APK sizes")} aria-expanded={showInfo} onClick={() => setShowInfo(!showInfo)}><Info size={16} /></button></div>
    {showInfo && <p className="backup-note">{local ? t("Size inside the selected local APK") : t("Size inside the APK files on the device")}{t(", using stored ZIP entry sizes. Other includes archive headers, signing data and alignment, so the categories add up to the APK size. ")}{local ? t("Code counts root classes*.dex files; native libraries count .so files under lib/. Other assets remain in Assets.") : t("DEX and .so files are counted as code and native libraries even inside assets.")}{t(" Excludes app data, cache, extracted libraries and compiled code outside the APKs. This is not a store download-size estimate or the size of an exported APKS archive. Percentages use known APK file sizes; rounding may affect their sum.")}</p>}
    {!hasSize ? <p>{local ? t("Size composition is unavailable for this APK.") : t("Size composition has not been collected. Use Actions → Scan APKs.")}</p> : <>
      <div className="apk-size-total"><span>{measured.length === artifacts.length ? t("Total APK size") : t("Known APK size")}</span><strong title={exact(total)}>{measured.length ? formatStorageSize(total) : t("Unavailable")}</strong><span>{measured.length} / {artifacts.length}{t(" APK files measured")}</span></div>
      {partial && <p className="app-details-warning">{t("Partial size breakdown · ")}{classified.length} / {artifacts.length}{t(" APK files classified.")}{measured.length < artifacts.length ? t(" Unavailable file sizes are excluded from the chart and percentages.") : ''}</p>}
      {total > 0 && <div className="apk-size-bar" role="group" aria-label={t("Size by category")}>{categories.filter(key => counts[key] > 0).map(key => <span key={key} className={`apk-size-color apk-size-${key}`} style={{ width: `${counts[key] / total * 100}%` }} role="img" aria-label={`${t(labels[key])}: ${exact(counts[key])}, ${percent(counts[key], total)}`} title={`${t(labels[key])} · ${exact(counts[key])} · ${percent(counts[key], total)}`} />)}</div>}
      {!!measured.length && <dl className="apk-size-legend">{categories.map(key => <div key={key} title={`${local && key === 'code' ? t("Root classes*.dex files.") : local && key === 'native' ? t("Native .so files under lib/.") : t(descriptions[key])} ${exact(counts[key])}`}><dt><span className={`apk-size-color apk-size-${key}`} aria-hidden="true" />{t(labels[key])}</dt><dd><strong>{formatStorageSize(counts[key])}</strong><span>{percent(counts[key], total)}</span></dd></div>)}</dl>}
      {(artifacts.length > 1 || partial) && <><h4>{t("APK files")}</h4><ul className="apk-size-files" aria-label={t("APK file sizes")}>{artifacts.map(a => <li key={a.path}>
        <div className="apk-size-file-heading"><code title={a.path}>{a.path.split('/').at(-1)}</code><span title={a.size?.bytes != null ? exact(a.size.bytes) : undefined}>{formatStorageSize(a.size?.bytes)}{a.size?.bytes != null ? ` · ${percent(a.size.bytes, total)}` : ''}</span></div>
        {a.size?.bytes != null && total > 0 && <div className="apk-size-file-bar" aria-hidden="true"><span style={{ width: `${a.size.bytes / total * 100}%` }} /></div>}
        {!a.size?.categories && <p className="app-details-warning">{message(a.size?.error) || t("Size composition has not been collected. Scan again.")}</p>}
      </li>)}</ul></>}
    </>}
  </section>
}
