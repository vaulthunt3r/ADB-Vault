import { useMemo } from 'react'
import { Search } from 'lucide-react'
import {
  columnFilteringFeature, columnVisibilityFeature, createColumnHelper,
  createFilteredRowModel, createGroupedRowModel,
  metaHelper, columnGroupingFeature, rowSelectionFeature, tableFeatures, useTable,
} from '@tanstack/react-table'
import { isNotInstalled, isReady, needsAttention, settledStatus, type ManagedComponent } from '../lib/components'
import { useAppStore } from '../store/useAppStore'
import { ComponentIcon } from './ComponentIcon'
import { StatusBadge } from './ui'

export type ComponentFilter = 'all' | 'attention' | 'ready' | 'not-installed'

const features = tableFeatures({
  columnFilteringFeature,
  columnVisibilityFeature,
  columnGroupingFeature,
  rowSelectionFeature,
  filteredRowModel: createFilteredRowModel(),
  groupedRowModel: createGroupedRowModel(),
  columnMeta: metaHelper<{ cellClass?: string; headerClass?: string; title?: string }>(),
})
const column = createColumnHelper<typeof features, ManagedComponent>()

function ComponentName({ component, selected, select }: { component: ManagedComponent; selected: boolean; select: () => void }) {
  return <button className="component-select" aria-label={`Select ${component.name}`} aria-pressed={selected} onClick={select}>
    <ComponentIcon id={component.id} /><span><strong>{component.name}</strong><span className="component-subtitle">{component.subtitle}</span>
      {component.status === 'Downloading' && <span className="inline-progress"><span style={{ width: `${component.progress}%` }} /></span>}
    </span>
  </button>
}

// Stable column definitions preserve the custom desktop presentation.
const columns = column.columns([
  column.accessor(component => `${component.name} ${component.subtitle}`, {
    id: 'name', header: () => 'COMPONENT', filterFn: (row, columnId, value) => row.getValue<string>(columnId).toLocaleLowerCase().includes(String(value).toLocaleLowerCase()),
    meta: { cellClass: 'component-name-cell' },
    cell: ({ row }) => <ComponentName component={row.original} selected={row.getIsSelected()} select={() => row.toggleSelected(true)} />,
  }),
  column.accessor('version', { header: () => 'VERSION', meta: { cellClass: "version-col mono", headerClass: 'version-col' } }),
  column.accessor('size', { header: () => 'DOWNLOAD', meta: { cellClass: "size-col mono", headerClass: 'size-col', title: "Download size" } }),
  column.accessor('status', {
    header: () => 'STATUS', meta: { cellClass: 'status-cell', headerClass: 'status-heading' },
    filterFn: (row, _columnId, filter: ComponentFilter) => filter === 'all' || (filter === 'ready' ? isReady : filter === 'not-installed' ? isNotInstalled : needsAttention)(settledStatus(row.original)),
    cell: ({ row }) => <><StatusBadge status={row.original.status} />{row.original.status === 'Downloading' && <span className="download-percentage mono">{row.original.progress}%</span>}</>,
  }),
  column.accessor('group', { enableColumnFilter: false }),
])

export function ComponentsTable({ components, search, filter, resetFilters }: {
  components: ManagedComponent[]; search: string; filter: ComponentFilter; resetFilters: () => void
}) {
  const selectedId = useAppStore(state => state.selectedId)
  const selectComponent = useAppStore(state => state.selectComponent)
  const columnFilters = useMemo(() => [{ id: 'name', value: search }, { id: 'status', value: filter }], [search, filter])
  const rowSelection = useMemo(() => ({ [selectedId]: true as const }), [selectedId])
  const table = useTable({
    features, columns, data: components,
    getRowId: component => component.id,
    initialState: { grouping: ['group'], columnVisibility: { group: false } },
    groupedColumnMode: false,
    state: { columnFilters, rowSelection },
    enableMultiRowSelection: false,
    enableSubRowSelection: false,
    enableRowSelection: row => !row.getIsGrouped(),
    onRowSelectionChange: updater => {
      const next = typeof updater === 'function' ? updater(rowSelection) : updater
      const selected = components.find(component => next[component.id])
      if (selected) selectComponent(selected.id, true)
    },
  })
  const groups = table.getRowModel().rows
  return <div className="component-table" role="table" aria-label="Dependencies and components" aria-colcount={4}>
    {table.getHeaderGroups().map(group => <div className="table-heading" role="row" key={group.id}>
      {group.headers.map(header => <span role="columnheader" key={header.id} className={header.column.columnDef.meta?.headerClass} title={header.column.columnDef.meta?.title}><table.FlexRender header={header} /></span>)}
    </div>)}
    {groups.map(group => <div role="rowgroup" key={group.id}>
      <div className="component-group" role="row"><span role="cell" aria-colspan={4}>{group.original.group}<span className="group-count">{group.subRows.length}</span>{group.original.group === 'Optional components' && <span className="optional-caption">Extend your setup</span>}</span></div>
      {group.subRows.map(row => <div key={row.id} className={`component-row ${row.getIsSelected() ? 'selected' : ''}`} role="row" data-testid={`component-${row.id}`}>
        {row.getVisibleCells().map(cell => <div role="cell" key={cell.id} className={cell.column.columnDef.meta?.cellClass}><table.FlexRender cell={cell} /></div>)}
      </div>)}
    </div>)}
    {groups.length === 0 && <div className="no-results"><Search size={25} /><h3>No components found</h3><p>Try a different search or filter.</p><button className="text-button" onClick={resetFilters}>Show all components</button></div>}
  </div>
}
