import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { parseAppSearch, pastedAppSearch } from '../lib/appSearch'
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, Filter, GripVertical, Search, X } from 'lucide-react'
import { activeAppFilters, appSortDirection, appSortFields, isStorageSort, type AppFilters, type AppSort } from '../lib/appView'
import { appColumns, type AppColumnId } from '../lib/appColumns'
import { useAppsViewStore } from '../store/useAppsViewStore'
import { useAppsStore } from '../store/useAppsStore'
import { BadgeReadingProgress } from './BadgeFilters'
import { AppsFilterPanel } from './AppsFilterPanel'
import { FilterBadge } from './FilterBadge'

function ViewPopover({ label, trigger, children, wide = false }: { label: string; trigger: ReactNode; children: ReactNode; wide?: boolean }) {
  const id = useId(), button = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const position = () => {
    if (!panel.current || !button.current) return
    const rect = button.current.getBoundingClientRect(), width = Math.min(wide ? 560 : 320, innerWidth - 24)
    const below = innerHeight - rect.bottom - 16, above = rect.top - 16
    const placeBelow = below >= 290 || below >= above
    Object.assign(panel.current.style, { width: `${width}px`, left: `${Math.max(12, Math.min(rect.left, innerWidth - width - 12))}px`, top: placeBelow ? `${rect.bottom + 7}px` : 'auto', bottom: placeBelow ? 'auto' : `${innerHeight - rect.top + 7}px`, maxHeight: `${Math.max(120, placeBelow ? below : above)}px` })
  }
  useEffect(() => { if (!open) return; window.addEventListener('resize', position); return () => window.removeEventListener('resize', position) }, [open])
  return <><button ref={button} className="button secondary" popoverTarget={id} aria-label={label} aria-expanded={open} aria-controls={id} aria-haspopup="dialog">{trigger}</button>
    <div ref={panel} id={id} popover="auto" role="dialog" aria-label={label} className={`apps-view-popover${wide ? " apps-filter-popover" : ''}`} onToggle={event => {
      const visible = event.newState === 'open'; setOpen(visible)
      if (visible && panel.current && button.current) {
        position()
        panel.current.querySelector<HTMLElement>(wide ? '[role=tab][aria-selected=true]' : 'input')?.focus()
      }
    }}><div className="apps-popover-heading"><strong>{label}</strong><button className="icon-button" aria-label={`Close ${label}`} onClick={() => { panel.current?.hidePopover(); button.current?.focus() }}><X size={15} /></button></div>{children}</div>
  </>
}

export function AppsViewControls({ filters, setFilters, sort, setSort, search, setSearch, shown, total, selectionControls }: {
  filters: AppFilters; setFilters: (value: AppFilters) => void; sort: AppSort; setSort: (value: AppSort) => void
  search: string; setSearch: (value: string) => void; shown: number; total: number
  selectionControls?: ReactNode
}) {
  const active = activeAppFilters(filters), sortField = appSortFields.find(field => field.key === sort.key)!
  const radioId = useId()
  const { visibility, order, moveColumn, setVisible, resetColumns } = useAppsViewStore()
  const [dragged, setDragged] = useState<AppColumnId | null>(null)
  const [dropTarget, setDropTarget] = useState<AppColumnId | null>(null)
  const [moved, setMoved] = useState('')
  const orderedColumns = order.map(id => appColumns.find(c => c.id === id)!)
  const apps = useAppsStore(s => s.apps)
  const packageList = useMemo(() => parseAppSearch(search).packages, [search])
  const missingPackages = useMemo(() => {
    const available = new Set(apps.map(app => app.packageName.toLowerCase()))
    return packageList ? [...packageList].filter(name => !available.has(name)) : []
  }, [apps, packageList])
  const listHint = packageList ? `Package list: ${packageList.size} requested; ${shown} shown. Other filters still apply.`
    + (missingPackages.length ? '\n' + `Not found in this profile: ${missingPackages.join(', ')}` : '') : undefined
  const installers = [...new Set([...apps.flatMap(app => app.installer?.trim() ? [app.installer] : []), ...(filters.installer && filters.installer !== '@unknown' ? [filters.installer] : [])])].sort()
  const move = (id: AppColumnId, target: AppColumnId) => { moveColumn(id, target); setMoved(`${appColumns.find(c => c.id === id)!.label}: position ${order.indexOf(target) + 1}`) }
  return <div className="apps-view-controls">
    <div className="apps-query-toolbar">
      <div className="apps-query-actions">
      <ViewPopover wide label="Filter applications" trigger={<><Filter size={14} />Filter{active.length > 0 && <span className="apps-filter-count">{active.length}</span>}</>}>
        <AppsFilterPanel filters={filters} setFilters={setFilters} search={search}>
        <fieldset><legend>Application type</legend><div className="apps-filter-options">{(['all', 'system', 'user'] as const).map(type => <label key={type}><input type="radio" name={`${radioId}-type`} checked={filters.type === type} onChange={() => setFilters({ ...filters, type, updatedSystem: type === 'system' ? filters.updatedSystem : false })} /><FilterBadge variant={type === 'all' ? 'filter.allTypes' : `type.${type}`}>{type === 'all' ? "All types" : type === 'system' ? "System" : "User"}</FilterBadge></label>)}</div>
          <label className="apps-filter-refinement"><input type="checkbox" checked={filters.updatedSystem} onChange={event => setFilters({ ...filters, updatedSystem: event.target.checked, ...(event.target.checked ? { type: 'system' as const } : {}) })} /><FilterBadge variant="type.updated">Updated system only</FilterBadge></label>
        </fieldset>
        <fieldset><legend>Availability</legend><div className="apps-filter-options">{(['all', 'enabled', 'disabled'] as const).map(availability => <label key={availability}><input type="radio" name={`${radioId}-availability`} checked={filters.availability === availability} onChange={() => setFilters({ ...filters, availability })} /><FilterBadge variant={availability === 'all' ? 'filter.anyAvailability' : availability === 'enabled' ? 'filter.enabled' : 'disabled'}>{availability === 'all' ? "Any" : availability === 'enabled' ? "Enabled" : "Disabled"}</FilterBadge></label>)}</div></fieldset>
        <fieldset><legend>Package state</legend><label><input type="checkbox" checked={filters.stopped} onChange={event => setFilters({ ...filters, stopped: event.target.checked })} /><FilterBadge badge="stopped">Stopped</FilterBadge></label><p className="apps-filter-help">Android's stopped flag; not a process check.</p><label><input type="checkbox" checked={filters.suspended} onChange={event => setFilters({ ...filters, suspended: event.target.checked })} /><FilterBadge badge="suspended">Suspended</FilterBadge></label><p className="apps-filter-help">Suspended by Android; separate from Disabled.</p></fieldset>
        <fieldset><legend>Package layout</legend><div className="apps-filter-options">{(['all', 'single', 'split'] as const).map(packaging => <label key={packaging}><input type="radio" name={`${radioId}-packaging`} checked={filters.packaging === packaging} onChange={() => setFilters({ ...filters, packaging })} /><FilterBadge variant={packaging === 'all' ? 'filter.anyLayout' : packaging === 'single' ? 'filter.singleApk' : 'splits'}>{packaging === 'all' ? "Any layout" : packaging === 'single' ? "Single APK" : "Split APK"}</FilterBadge></label>)}</div><p className="apps-filter-help">Split APK: a base app plus files for languages, CPU, screen density or features.</p></fieldset>
        <fieldset><legend>Installer</legend><select aria-label="Filter by installer" className="apps-filter-select" value={filters.installer} onChange={event => setFilters({ ...filters, installer: event.target.value })}><option value="">Any installer</option><option value="@unknown">Unavailable</option>{installers.map(installer => <option key={installer} value={installer}>{installer}</option>)}</select><p className="apps-filter-help">Installer package reported by Android. An unavailable installer does not prove sideloading.</p></fieldset>
        <fieldset><legend>Target SDK range</legend><div className="apps-sdk-range">{(['targetSdkMin', 'targetSdkMax'] as const).map((key, index) => <label key={key}>{index === 0 ? "From" : "To"}<input type="number" min={1} max={10000} step={1} aria-label={index === 0 ? "Minimum target SDK" : "Maximum target SDK"} value={filters[key] ?? ''} placeholder="Any" onChange={event => { const value = event.currentTarget.valueAsNumber; setFilters({ ...filters, [key]: Number.isInteger(value) && value > 0 && value <= 10000 ? value : null }) }} /></label>)}</div>{filters.targetSdkMin !== null && filters.targetSdkMax !== null && filters.targetSdkMin > filters.targetSdkMax ? <p className="field-error" role="status">From must not exceed To.</p> : <p className="apps-filter-help">Android API level targeted by the app. Unknown values are excluded when a bound is set.</p>}</fieldset>
        </AppsFilterPanel>
      </ViewPopover>
      <ViewPopover label="Sort applications" trigger={<><ArrowUpDown size={14} /><span className="apps-sort-label" title={`Sort: ${sortField.label}`}>{"Sort: "}{sortField.label}</span>{sort.direction === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />}</>}>
        <fieldset><legend>Sort by</legend>{appSortFields.map(field => <label key={field.key}><input type="radio" name={`${radioId}-sort`} checked={sort.key === field.key} onChange={() => setSort({ key: field.key, direction: appSortDirection(field.key) })} />{field.label}</label>)}</fieldset>
        <fieldset><legend>Direction</legend><div className="apps-filter-options">{(['asc', 'desc'] as const).map(direction => <label key={direction}><input type="radio" name={`${radioId}-direction`} checked={sort.direction === direction} onChange={() => setSort({ ...sort, direction })} />{direction === 'asc' ? sortField.ascending : sortField.descending}</label>)}</div></fieldset><p className="apps-filter-help">{sort.key === 'apkSizeBytes' && "Base APK + installed splits; excludes app data and cache. "}{isStorageSort(sort.key) && "Requires storage collection in Settings → Apps, then Refresh. Zero is a known size. "}Unavailable values stay at the end. Equal values are ordered by package name.</p>
      </ViewPopover>
      <ViewPopover label="Visible columns" trigger={<><Columns3 size={14} />Columns</>}>
        <p className="apps-filter-help">Drag a handle to reorder columns. With keyboard: focus a handle and press ↑ or ↓.</p>
        <fieldset><legend>Show in table</legend>{orderedColumns.map((column, index) => <div key={column.id} data-column-id={column.id} className={`apps-column-choice${dropTarget === column.id && dragged !== column.id ? " drop-target" : ''}`} onDragOver={event => { if (dragged) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(column.id) } }} onDrop={event => { event.preventDefault(); if (dragged) move(dragged, column.id); setDragged(null); setDropTarget(null) }}>
          <button className="apps-column-grip" draggable aria-label={`Move ${column.label}`} title="Drag to reorder; arrow keys move up/down" onDragStart={event => { event.dataTransfer.setData('text/plain', column.id); event.dataTransfer.effectAllowed = 'move'; setDragged(column.id) }} onDragEnd={() => { setDragged(null); setDropTarget(null) }} onKeyDown={event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); const target = order[index + (event.key === 'ArrowUp' ? -1 : 1)]; if (target) move(column.id, target) } }}><GripVertical size={14} /></button>
          <label><input type="checkbox" checked={visibility[column.id]} disabled={column.id === 'label'} onChange={event => setVisible(column.id, event.target.checked)} />{column.label}{column.id === 'label' && <small>{" · always visible"}</small>}</label>
        </div>)}</fieldset><span className="visually-hidden" role="status">{moved}</span>
        <p className="apps-filter-help">Data and Cache require storage collection in Settings → Apps, then Refresh. Package layout means Single / Split APK.</p>
        <div className="apps-popover-footer"><span>View saved automatically.</span><button className="text-button" onClick={resetColumns}>Reset columns</button></div>
      </ViewPopover>
      {selectionControls}
      </div>
      <div className="apps-query-end"><div className="component-search"><Search size={15} /><input type="search" aria-label="Search applications" placeholder="Name or package…" title="Search by name or package. Paste a package list separated by lines, spaces, commas or semicolons." value={search} onChange={event => setSearch(event.target.value)} onPaste={event => {
        const pasted = pastedAppSearch(event.clipboardData.getData('text/plain'))
        if (pasted !== null) { event.preventDefault(); setSearch(pasted) }
      }} /></div><span className="apps-result-count" aria-live="polite" title={listHint}>{packageList ? `${shown} of ${packageList.size} from list` : <>{shown}{" of "}{total}</>}</span></div>
    </div>
    <BadgeReadingProgress />
  </div>
}
