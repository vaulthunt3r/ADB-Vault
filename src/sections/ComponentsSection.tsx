import { t } from "../lib/i18n"
import { CircleHelp, Download, Search, X } from 'lucide-react'
import { useState } from 'react'
import { LatticeLoader } from '../components/operation-chip/OperationChip'
import { isBusy, isNotInstalled, isReady, needsAttention, settledStatus } from '../lib/components'
import { useAppStore } from '../store/useAppStore'
import { BadgeDialog } from '../components/BadgeDialog'
import { ComponentsTable, type ComponentFilter } from '../components/ComponentsTable'
import { IconButton } from '../components/ui'

export function ComponentsSection() {
  const components = useAppStore(s => s.components)
  const installAll = useAppStore(s => s.installAll)
  const bulkBusy = useAppStore(s => s.bulkBusy)
  const componentPending = useAppStore(s => s.componentPending)
  const [filter, setFilter] = useState<ComponentFilter>('all')
  const [search, setSearch] = useState('')
  const [helpOpen, setHelpOpen] = useState(false)
  const ready = components.filter(component => isReady(settledStatus(component))).length
  const attention = components.filter(component => needsAttention(settledStatus(component))).length
  const notInstalled = components.filter(component => isNotInstalled(settledStatus(component))).length
  const working = componentPending || components.some(component => isBusy(component.status))
  const filters: { id: ComponentFilter; label: string; count: number }[] = [
    { id: 'all', label: t("All components"), count: components.length },
    { id: 'attention', label: t("Needs attention"), count: attention },
    { id: 'ready', label: t("Ready"), count: ready },
    { id: 'not-installed', label: t("Not installed"), count: notInstalled },
  ]
  return <section className="components-section section-content" aria-labelledby="component-center-title">
    <div className="section-heading">
      <div><h1 id="component-center-title">{t("Component Center")}<span className="heading-period">.</span></h1></div>
      {(bulkBusy || ready < components.length) && <button className="button primary install-all" disabled={working || bulkBusy} onClick={() => void installAll()}>
        {bulkBusy ? <LatticeLoader /> : <Download size={15} />}
        <span>{bulkBusy ? t("Installing components…") : t("Install / Repair All")}</span>
      </button>}
    </div>
    {!window.desktop && <div className="operation-error" role="alert">{t("Real component operations require the Electron application. Start it with npm run dev.")}</div>}
    <div className="component-tools">
      <div className="component-filters" role="group" aria-label={t("Filter components")}>
        {filters.map(item => <button key={item.id} className={filter === item.id ? 'active' : ''} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}<span>{item.count}</span></button>)}
      </div>
      <div className="component-tool-actions">
        <div className="component-search"><Search size={15} /><input type="search" aria-label={t("Search components")} placeholder={t("Find a component…")} value={search} onChange={event => setSearch(event.target.value)} />{search && <IconButton label={t("Clear search")} onClick={() => setSearch('')}><X size={13} /></IconButton>}</div>
        <IconButton label={t("About components")} onClick={() => setHelpOpen(true)}><CircleHelp size={17} /></IconButton>
      </div>
    </div>
    <ComponentsTable components={components} search={search} filter={filter} resetFilters={() => { setSearch(''); setFilter('all') }} />
    {helpOpen && <BadgeDialog title={t("About components")} close={() => setHelpOpen(false)}>
      <div className="component-help-content">
        <p>{t("Check components verifies installed tools on this computer and checks for available updates. It does not install anything.")}</p>
        <p>{t("ADB and Fastboot share one Platform Tools download. USB drivers and optional tools are not required for every connection.")}</p>
        <p>{t("A driver marked “Package ready” has been downloaded, but still needs Windows installation. It appears under Not installed.")}</p>
      </div>
    </BadgeDialog>}
  </section>
}
