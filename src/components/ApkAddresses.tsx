import { t } from "../lib/i18n"
import { useState } from 'react'
import { Copy, Info, Search } from 'lucide-react'
import type { ApkAddresses as Addresses } from '../../electron/database-protocol'
import { copyText } from '../lib/clipboard'
import { useAppStore } from '../store/useAppStore'

const coverage = 'Reads DEX strings, compiled resource/XML string pools and supported text files in res/ and assets/, across the base APK and installed splits. Native binary strings, encrypted content and addresses assembled at runtime are not covered. Bare-domain detection is conservative; matches are not proof of a connection or tracking. Uses an offline IANA domain-zone list: https://data.iana.org/TLD/tlds-alpha-by-domain.txt. No DNS lookup or upload.'
const fileName = (value: string) => value.split('/').at(-1) || value
const pageSize = 20
export function ApkAddresses({ addresses, local = false }: { addresses?: Addresses; local?: boolean }) {
  const [kind, setKind] = useState<'domains' | 'urls'>('domains')
  const [query, setQuery] = useState(''), [page, setPage] = useState(0)
  const [showInfo, setShowInfo] = useState(false)
  const values = addresses?.[kind] || []
  const term = query.trim().toLowerCase()
  const filtered = values.filter(item => !term || item.value.toLowerCase().includes(term) || item.sources.some(s => `${s.apk} ${s.entry}`.toLowerCase().includes(term)))
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize)), currentPage = Math.min(page, pages - 1)
  const copy = (value: string) => void copyText(value).then(() => useAppStore.getState().notify("Copied"), () => useAppStore.getState().notify("Could not copy to the clipboard."))
  return <section className="apk-addresses" aria-label={t("Domains and URLs")}>
    <div className="apk-analysis-heading"><h3>{t("Domains & URLs")}</h3><button className="icon-button" aria-label={t("About address scanning")} title={t("About address scanning")} aria-expanded={showInfo} onClick={() => setShowInfo(!showInfo)}><Info size={16} /></button></div>
    <p>{t("Found inside APK files · Not a connection history.")}</p>
    {showInfo && <p className="backup-note">{local ? t("Reads root classes*.dex strings and supported text assets and res/raw files in the selected APK. Compiled resources, native binary strings, encrypted content and addresses assembled at runtime are not covered. Bare-domain detection is conservative; matches are not proof of a connection or tracking. Uses an offline IANA domain-zone list. No DNS lookup or upload.") : coverage}</p>}
    {!addresses ? <p>{local ? t("Address analysis is unavailable for this APK.") : t("Addresses have not been scanned. Use Actions → Scan APKs to include them.")}</p> : <>
      <div className="apk-address-toolbar">
        <div className="operation-results-filter" role="group" aria-label={t("Address type")}>
          <button className="button secondary" aria-pressed={kind === 'domains'} onClick={() => { setKind('domains'); setPage(0) }}>{t("Domains (")}{addresses.domains.length})</button>
          <button className="button secondary" aria-pressed={kind === 'urls'} onClick={() => { setKind('urls'); setPage(0) }}>{t("URLs (")}{addresses.urls.length})</button>
        </div>
        <label className="component-search apk-address-search"><Search size={15} aria-hidden="true" /><input type="search" aria-label={t("Search addresses")} placeholder={t("Address or source file…")} value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} /></label>
        <button className="button secondary" disabled={!filtered.length} onClick={() => copy(filtered.map(item => item.value).join('\n'))}><Copy size={14} aria-hidden="true" />{t("Copy filtered")}</button>
      </div>
      {addresses.status === 'partial' && <p className="app-details-warning">{t("Partial address scan. ")}{addresses.issues.join(' ')}</p>}
      {filtered.length ? <ul className="apk-address-list" aria-label={t("Found addresses")}>{filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map(item => <li key={item.value}>
        <div><code>{item.value}</code><span className="apk-address-sources">{item.sources.map(source => <span key={`${source.apk}\0${source.entry}`} title={`${source.apk} · ${source.entry}`}>{fileName(source.apk)} · {source.entry}</span>)}</span></div>
        <button className="icon-button" aria-label={t("Copy {0}", [item.value])} title={t("Copy address")} onClick={() => copy(item.value)}><Copy size={14} /></button>
      </li>)}</ul> : <p>{term ? t("No addresses match this search.") : addresses.status === 'partial' ? t("No addresses found in the inspected portion.") : t("No addresses found in the inspected strings.")}</p>}
      <div className="apk-address-pages"><span>{filtered.length}{t(" of ")}{values.length} · {addresses.files}{t(" files inspected")}</span>{pages > 1 && <><button className="text-button" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>{t("Previous")}</button><span>{currentPage + 1} / {pages}</span><button className="text-button" disabled={currentPage + 1 === pages} onClick={() => setPage(currentPage + 1)}>{t("Next")}</button></>}</div>
    </>}
  </section>
}
