import { Grid2X2, Search } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { columnOrderingFeature, columnVisibilityFeature, createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table'
import type { AndroidApp } from '../../electron/apps-protocol'
import { appColumns, type AppColumnId } from '../lib/appColumns'
import { appStorageValue, formatApkSize, formatStorageSize } from '../lib/appView'
import { useAppsStore } from '../store/useAppsStore'
import { useAppsViewStore } from '../store/useAppsViewStore'
import { useAppsSelectionStore } from '../store/useAppsSelectionStore'
import { AppStatus } from './AppStatus'
import { AppPersonalBadges } from './AppNotes'

export const appKind = (app: AndroidApp) => app.updatedSystemApp ? "Updated system" : app.system ? "System" : "User"
export function AppIcon({ app }: { app: Pick<AndroidApp, 'iconPng' | 'iconSkipped'> }) {
  if (app.iconSkipped) return null
  return <span className="android-app-icon">{app.iconPng ? <img src={`data:image/png;base64,${app.iconPng}`} alt="" width={36} height={36} /> : <Grid2X2 size={25} />}</span>
}
function AppName({ app }: { app: AndroidApp }) {
  const select = useAppsStore(s => s.select), selected = useAppsStore(s => s.selectedPackage === app.packageName)
  const separatePackage = useAppsViewStore(s => s.visibility.packageName)
  return <button className="app-select" data-package={app.packageName} aria-label={`Details for ${app.label}`} aria-pressed={selected} onClick={() => select(app.packageName)}><AppIcon app={app} /><span className="app-name-content"><span className="app-name-line"><strong title={app.label}>{app.label}</strong><AppPersonalBadges packageName={app.packageName} /></span>{!separatePackage && <small>{app.packageName}</small>}</span></button>
}
function valueCell(app: AndroidApp, id: AppColumnId) {
  switch (id) {
    case 'label': return <AppName app={app} />
    case 'kind': return appKind(app)
    case 'packaging': return app.splitCount == null ? <span title="Package layout unavailable">—</span> : <span title={app.splitCount ? `Base APK + ${app.splitCount} installed splits` : "One installed APK"}>{app.splitCount ? "Split APK" : "Single APK"}</span>
    case 'apkSizeBytes': return <span title={app.sizeError || "Base APK + installed splits. Excludes data and cache."}>{app.apkSizeBytes ? formatApkSize(app.apkSizeBytes) : '—'}</span>
    case 'dataBytes': case 'cacheBytes': case 'dataWithoutCache': return <span title={!app.storageRequested ? "Enable storage sizes in Settings → Apps, then Refresh." : app.storageError || (id === 'dataWithoutCache' ? "Data minus cache for this profile. Unavailable if either size is missing or inconsistent." : id === 'dataBytes' ? "Data includes cache; do not add them together." : "Android cache size for this profile.")}>{app.storageRequested ? formatStorageSize(appStorageValue(app, id)) : "Not collected"}</span>
    case 'debuggable': return <span title="Whether Android allows debugging this application.">{app.debuggable ? "Yes" : "No"}</span>
    case 'firstInstallTime': case 'lastUpdateTime': return app[id] > 0 ? new Date(app[id]).toLocaleString('en-US') : "Unavailable"
    case 'targetSdk': case 'minSdk': return app[id] || "Unavailable"
    case 'enabled': return <AppStatus app={app} />
    default: return app[id] ?? "Unavailable"
  }
}
const features = tableFeatures({ columnVisibilityFeature, columnOrderingFeature })
const selectionWidth = 38
const helper = createColumnHelper<typeof features, AndroidApp>()
const columns = helper.columns(appColumns.map(c => helper.accessor(app => valueCell(app, c.id), { id: c.id, header: c.label.toUpperCase(), enableHiding: c.id !== 'label', cell: ({ row }) => valueCell(row.original, c.id) })))

export function AppsTable({ apps, clearFilters, openDetails }: { apps: AndroidApp[]; clearFilters: () => void; openDetails: (app: AndroidApp) => void }) {
  const visibility = useAppsViewStore(s => s.visibility)
  const order = useAppsViewStore(s => s.order)
  const selected = useAppsStore(s => s.selectedPackage)
  const { packages, setRows } = useAppsSelectionStore()
  const selectAll = useRef<HTMLInputElement>(null), anchor = useRef<string | null>(null), shifted = useRef(false)
  const rowIds = apps.map(app => app.packageName)
  const rowOrder = JSON.stringify(rowIds)
  const checkedCount = rowIds.filter(id => packages.has(id)).length
  useEffect(() => { anchor.current = null }, [rowOrder])
  useEffect(() => { if (!packages.size) anchor.current = null }, [packages.size])
  useEffect(() => { if (selectAll.current) selectAll.current.indeterminate = checkedCount > 0 && checkedCount < apps.length }, [checkedCount, apps.length])
  function mark(id: string, checked: boolean, range: boolean) {
    const start = anchor.current ? rowIds.indexOf(anchor.current) : -1, end = rowIds.indexOf(id)
    setRows(range && start >= 0 ? rowIds.slice(Math.min(start, end), Math.max(start, end) + 1) : [id], checked)
    if (!range || start < 0) anchor.current = id
  }
  const table = useTable({ features, columns, data: apps, state: { columnVisibility: visibility, columnOrder: order }, getRowId: app => app.packageName })
  // Reserve selection space from Application, keeping the pre-selection table width.
  const visible = order.map(id => appColumns.find(c => c.id === id)!).filter(c => visibility[c.id]).map(c => ({ ...c, width: c.width - (c.id === 'label' ? selectionWidth : 0) }))
  const contentWidth = visible.reduce((width, column) => width + column.width, 0)
  // Preferred widths become proportions; allow modest compression before horizontal scrolling.
  const minWidth = selectionWidth + contentWidth * 0.8
  return <div className="apps-table-scroll" role="region" aria-label="Application list" tabIndex={0}>
    <table className="apps-live-table" aria-label="Installed applications" style={{ minWidth }}>
      <colgroup><col style={{ width: selectionWidth }} />{visible.map((c, index) => <col key={c.id} style={index === visible.length - 1 ? undefined : { width: `${c.width / (contentWidth + selectionWidth) * 100}%` }} />)}</colgroup>
      <thead>{table.getHeaderGroups().map(group => <tr key={group.id}><th className="apps-check-cell" scope="col"><label className="apps-check-target" title="Select all filtered applications, including those below the visible area"><input ref={selectAll} className="apps-select-all" type="checkbox" aria-label="Select all filtered applications" checked={apps.length > 0 && checkedCount === apps.length} disabled={!apps.length} onChange={event => { anchor.current = null; setRows(rowIds, event.target.checked) }} /></label></th>{group.headers.map(header => <th key={header.id} scope="col" className={header.column.id === 'enabled' ? 'apps-status-heading' : undefined}><table.FlexRender header={header} /></th>)}</tr>)}</thead>
      <tbody>{table.getRowModel().rows.map(row => <tr key={row.id} className={`${selected === row.id ? 'selected' : ''}${packages.has(row.id) ? " marked" : ''}`} onDoubleClick={() => openDetails(row.original)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); openDetails(row.original) } }}>
        <td className="apps-check-cell" onDoubleClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}><label className="apps-check-target"><input type="checkbox" aria-label={`Select ${row.original.label} (${row.id})`} checked={packages.has(row.id)} onClick={event => { shifted.current = event.shiftKey }} onChange={event => { mark(row.id, event.target.checked, shifted.current); shifted.current = false }} onKeyDown={event => { if (event.key === ' ' && event.shiftKey) { event.preventDefault(); mark(row.id, !packages.has(row.id), true) } }} /></label></td>
        {row.getVisibleCells().map(cell => <td key={cell.id}><table.FlexRender cell={cell} /></td>)}</tr>)}</tbody>
    </table>
    {!apps.length && <div className="no-results"><Search size={24} /><h3>No applications found</h3><p>Try a different search or filter.</p><button className="text-button" onClick={clearFilters}>Clear search and filters</button></div>}
  </div>
}
