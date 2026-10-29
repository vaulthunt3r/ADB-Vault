import { t } from "../lib/i18n"
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { activeAppFilters, defaultAppFilters, type AppFilters } from '../lib/appView'
import { BadgeFilterControls, BadgeFilterStatus, BadgeReadControls } from './BadgeFilters'
import { FilterBadge } from './FilterBadge'

const tabs = ['General', 'Badges', 'Selected'] as const
export function AppsFilterPanel({ filters, setFilters, search, children }: {
  filters: AppFilters; setFilters: (value: AppFilters) => void; search: string; children: ReactNode
}) {
  const [tab, setTab] = useState<typeof tabs[number]>('General'), id = useId()
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => { if (body.current) body.current.scrollTop = 0 }, [tab])
  const active = activeAppFilters(filters)
  return <>
    <div className="apps-filter-tabs" role="tablist" aria-label={t("Filter categories")}>{tabs.map((name, index) => <button
      key={name} id={`${id}-${name}`} role="tab" aria-selected={tab === name} aria-controls={`${id}-${name}-panel`}
      tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)} onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1
        if (next < 0) return
        event.preventDefault(); setTab(tabs[next]); document.getElementById(`${id}-${tabs[next]}`)?.focus()
      }}>{name}{name === 'Selected' && ` (${active.length})`}</button>)}</div>
    <div ref={body} className={`apps-filter-body${tab === 'General' ? " apps-filter-body-general" : ''}`}>
      {tabs.map(name => <div key={name} id={`${id}-${name}-panel`} role="tabpanel" className={name === 'General' ? 'apps-general-filters' : undefined} aria-labelledby={`${id}-${name}`} hidden={tab !== name}>
        {name === 'General' ? children : name === 'Badges' ? <><BadgeFilterControls filters={filters} setFilters={setFilters} /><BadgeFilterStatus filters={filters} search={search} /></> : <>
          <p className="apps-filter-help">{t("Changes apply immediately. General conditions apply together; badges use the selected All / Any rule.")}</p>
          <div className="apps-selected-filters" aria-label={t("Active application filters")}>{active.map(item => <div key={item.badge || item.key}><span>{item.badge ? <FilterBadge badge={item.badge}>{item.label}</FilterBadge> : item.key === 'type' || item.key === 'updatedSystem' ? <FilterBadge badge="type" variant={`type.${item.key === 'updatedSystem' ? 'updated' : filters.type}`}>{item.label}</FilterBadge> : (item.key === 'stopped' || item.key === 'suspended') ? <FilterBadge badge={item.key}>{item.label}</FilterBadge> : item.key === 'availability' && filters.availability === 'disabled' ? <FilterBadge badge="disabled">{item.label}</FilterBadge> : item.key === 'packaging' && filters.packaging === 'split' ? <FilterBadge badge="splits">{item.label}</FilterBadge> : item.key === 'availability' ? <FilterBadge variant="filter.enabled">{item.label}</FilterBadge> : item.key === 'packaging' ? <FilterBadge variant="filter.singleApk">{item.label}</FilterBadge> : item.label}</span><button className="icon-button" aria-label={t("Remove {0} filter", [item.label])} onClick={() => setFilters({ ...filters, [item.key]: item.badge ? filters.badges.filter(key => key !== item.badge) : defaultAppFilters()[item.key], ...(item.key === 'type' ? { updatedSystem: false } : {}) })}><X size={14} /></button></div>)}</div>
          {!active.length && <p className="apps-filter-empty">{t("No filters selected.")}</p>}
        </>}
      </div>)}
    </div>
    <BadgeReadControls filters={filters}><span>{active.length ? t("{0} active filters", [active.length]) : t("No active filters")}{t(" · Applied immediately")}</span><button className="text-button" disabled={!active.length} onClick={() => setFilters(defaultAppFilters())}>{t("Clear filters")}</button></BadgeReadControls>
  </>
}
