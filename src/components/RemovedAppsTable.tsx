import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import type { AndroidApp } from '../../electron/apps-protocol'
import { batchSkipReason } from '../../electron/app-actions-protocol'
import { AppIcon, appKind } from './AppsTable'
import { AppNotesSummary } from './AppNotes'

type SortKey = 'label' | 'packageName' | 'kind' | 'recovery'
const headings: { key: SortKey; label: string }[] = [{ key: 'label', label: 'Application' }, { key: 'packageName', label: 'Package' }, { key: 'kind', label: 'Type' }, { key: 'recovery', label: 'Restoration' }]
export function RemovedAppsTable({ apps, packages, selected, select, mark, disabled }: {
  apps: AndroidApp[]; packages: Set<string>; selected: string | null; select: (pkg: string) => void
  mark: (ids: string[], checked: boolean) => void; disabled: boolean
}) {
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: 'label', descending: false })
  const all = useRef<HTMLInputElement>(null), anchor = useRef<string | null>(null), shifted = useRef(false)
  const value = (app: AndroidApp) => sort.key === 'kind' ? appKind(app) : sort.key === 'recovery' ? batchSkipReason('install-existing', app, apps) ? 'Unavailable' : 'Available' : app[sort.key]
  const rows = [...apps].sort((a, b) => (value(a).localeCompare(value(b), 'en', { numeric: true, sensitivity: 'base' }) || a.packageName.localeCompare(b.packageName)) * (sort.descending ? -1 : 1))
  const ids = rows.map(app => app.packageName), order = JSON.stringify(ids)
  const checkedCount = ids.filter(id => packages.has(id)).length
  useEffect(() => { anchor.current = null }, [order])
  useEffect(() => { if (!packages.size) anchor.current = null }, [packages.size])
  useEffect(() => { if (all.current) all.current.indeterminate = checkedCount > 0 && checkedCount < ids.length }, [checkedCount, ids.length])
  function check(id: string, checked: boolean, range: boolean) {
    const start = anchor.current ? ids.indexOf(anchor.current) : -1, end = ids.indexOf(id)
    mark(range && start >= 0 ? ids.slice(Math.min(start, end), Math.max(start, end) + 1) : [id], checked)
    if (!range || start < 0) anchor.current = id
  }
  return <div className="apps-table-scroll" role="region" aria-label="Removed application list" tabIndex={0}>
    <table className="apps-live-table removed-apps-table" aria-label="Removed applications">
      <colgroup><col style={{ width: 38 }} /><col style={{ width: '25%' }} /><col style={{ width: '30%' }} /><col style={{ width: 115 }} /><col /><col style={{ width: 115 }} /></colgroup>
      <thead><tr><th className="apps-check-cell" scope="col"><label className="apps-check-target" title="Select all filtered applications"><input ref={all} type="checkbox" aria-label="Select all filtered removed applications" checked={!!ids.length && checkedCount === ids.length} disabled={disabled || !ids.length} onChange={e => { anchor.current = null; mark(ids, e.target.checked) }} /></label></th>
        {headings.map(h => <th key={h.key} scope="col" aria-sort={sort.key === h.key ? sort.descending ? 'descending' : 'ascending' : 'none'}><button className="removed-sort" onClick={() => setSort({ key: h.key, descending: sort.key === h.key && !sort.descending })}>{h.label}{sort.key === h.key && (sort.descending ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}</button></th>)}
        <th scope="col">Personal</th></tr></thead>
      <tbody>{rows.map(app => {
        const reason = batchSkipReason('install-existing', app, apps)
        return <tr key={app.packageName} className={`removed-app-row${selected === app.packageName ? ' selected' : ''}${packages.has(app.packageName) ? ' marked' : ''}`}>
          <td className="apps-check-cell"><label className="apps-check-target"><input type="checkbox" aria-label={`Select ${app.label} (${app.packageName})`} checked={packages.has(app.packageName)} disabled={disabled} onClick={e => { shifted.current = e.shiftKey }} onChange={e => { check(app.packageName, e.target.checked, shifted.current); shifted.current = false }} onKeyDown={e => { if (e.key === ' ' && e.shiftKey) { e.preventDefault(); check(app.packageName, !packages.has(app.packageName), true) } }} /></label></td>
          <td><button className="app-select" aria-label={`Details for ${app.label}`} aria-pressed={selected === app.packageName} onClick={() => select(app.packageName)}><AppIcon app={app} /><span className="app-name-content"><span className="app-name-line"><strong title={app.label}>{app.label}</strong></span></span></button></td>
          <td><span className="removed-package" title={app.packageName}>{app.packageName}</span></td><td>{appKind(app)}</td>
          <td><span className={reason ? 'removed-unavailable' : undefined} title={reason || 'Restore from APK files already on the phone. Deleted app data is not recovered.'}>{reason ? 'APK unavailable' : 'APK on phone'}</span></td>
          <td><AppNotesSummary app={app} compact /></td>
        </tr>
      })}</tbody>
    </table>
    {!rows.length && <p className="personal-empty">No packages match this view.</p>}
  </div>
}
