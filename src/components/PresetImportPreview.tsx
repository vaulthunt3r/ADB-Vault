import { useState } from 'react'
import type { PresetPreview } from '../../electron/app-backup-protocol'
import { useAppsStore } from '../store/useAppsStore'
import { useAppsSelectionStore } from '../store/useAppsSelectionStore'
import { useAppsViewStore } from '../store/useAppsViewStore'
import { defaultAppFilters, filterAndSortApps } from '../lib/appView'

export function PresetImportPreview({ preview, blocked, back, applied }: { preview: PresetPreview; blocked: boolean; back: () => void; applied: () => void }) {
  const apps = useAppsStore(), view = useAppsViewStore()
  const selectedCount = useAppsSelectionStore(s => s.packages.size)
  const [clearFilters, setClearFilters] = useState(false)
  const current = new Set(apps.apps.filter(app => app.userId === preview.userId).map(app => app.packageName))
  const matched = preview.preset.applications.filter(app => current.has(app.packageName)).map(app => app.packageName)
  const visible = new Set(filterAndSortApps(apps.apps, view.filters, view.search, view.sort, apps.badgeEvidence).map(app => app.packageName))
  const hidden = matched.filter(pkg => !visible.has(pkg)).length
  const sameProfile = apps.deviceId === preview.id && apps.userId === preview.userId && apps.status === 'ready'
  return <section aria-label="Preset preview">
    <h3>{preview.preset.name}</h3>
    <p className="backup-note">{"Saved from "}{preview.preset.device.name} · {preview.preset.profile.name}{" · ID "}{preview.preset.profile.id}.</p>
    <p role="status">{matched.length}{" found · "}{preview.preset.applications.length - matched.length}{" missing in the current profile."}</p>
    <p className="backup-note">{"Apply selection replaces the current "}{selectedCount}{" marks with the found applications. No applications will be installed, removed or changed on the device."}</p>
    {hidden > 0 && <><p className="backup-note">{hidden}{" found applications are hidden by the current filters or search. They will still be selected."}</p><label className="preset-import-show"><input type="checkbox" checked={clearFilters} disabled={blocked} onChange={event => setClearFilters(event.target.checked)} />Clear filters and search to show imported applications</label></>}
    {!matched.length && <p className="backup-note">No matching applications. Your current selection will be kept.</p>}
    <ul className="backup-items" aria-label="Applications in preset">{preview.preset.applications.map(app => <li key={app.packageName}><strong>{app.label}</strong><code>{app.packageName}</code><span>{!current.has(app.packageName) ? "Missing" : visible.has(app.packageName) ? "Found" : "Found · Hidden by filters"}</span></li>)}</ul>
    <div className="backup-buttons"><button className="button primary" disabled={blocked || !sameProfile || !matched.length} onClick={() => {
      if (blocked || !sameProfile || !matched.length) return
      if (!useAppsSelectionStore.getState().replace(preview.id, preview.userId, matched)) return
      if (clearFilters) useAppsViewStore.setState({ filters: defaultAppFilters(), search: '' })
      applied()
    }}>Apply selection</button><button className="button secondary" disabled={blocked} onClick={back}>Back</button></div>
  </section>
}
