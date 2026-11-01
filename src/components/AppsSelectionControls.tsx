import { useRestoreStore } from '../store/useRestoreStore'
import type { AndroidApp } from '../../electron/apps-protocol'
import { useAppsSelectionStore } from '../store/useAppsSelectionStore'
import { openAppsBackup } from '../lib/appPresets'
import { useAppsOperations } from '../lib/useAppsOperations'
import { BookOpen, RotateCcw, FileInput, FileOutput, FileSearch, X } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { useId } from 'react'

export function AppsSelectionControls({ visibleApps }: { visibleApps: AndroidApp[] }) {
  const summaryId = useId()
  const { packages, clear } = useAppsSelectionStore()
  const { running, blocked } = useAppsOperations()
  const hidden = packages.size - visibleApps.filter(app => packages.has(app.packageName)).length
  const summary = `Selected ${packages.size}${hidden > 0 ? ` · ${hidden} hidden by filters` : ''}`
  return <div className="apps-selection-controls" role="group" aria-label="Application selection">
    <span id={summaryId} className="visually-hidden" role="status">{summary}</span>
    <button className="button secondary apps-selection-backup" title="Install one or several APK/APKS files" disabled={running || blocked} onClick={() => useRestoreStore.getState().open('install')}><FileInput size={12} aria-hidden="true" />Install</button>
    <button className="button secondary apps-selection-backup" aria-describedby={summaryId} title={running ? "Backup is running; open progress in the top toolbar" : packages.size ? `${summary}. Export checked applications or import a preset.` : "Open export options or import a preset to restore application selection."} disabled={running || blocked} onClick={() => openAppsBackup('marked', true)}><FileOutput size={12} aria-hidden="true" />{packages.size ? `Backup (${packages.size})` : "Backup"}</button>
    <button className="button secondary apps-selection-backup" title="Inspect one local APK or compare two versions. No phone connection required." onClick={() => useAppStore.getState().openLocalApks()}><FileSearch size={14} />Local APKs</button>
    <button className="button secondary apps-collection-shortcut" aria-label="Removed apps" title="Removed apps · view packages absent from this profile and restore available copies" onClick={() => useAppStore.setState({ appsView: 'removed' })}><RotateCcw size={15} /></button>
    <button className="button secondary apps-collection-shortcut" aria-label="Personal database" title="Personal database · your labels and notes for all phones" onClick={() => useAppStore.setState({ appsView: 'notes' })}><BookOpen size={15} /></button>
    <button className="icon-button apps-selection-clear" aria-label="Clear selection" title="Clear selection" disabled={!packages.size} onClick={() => { clear(); document.querySelector<HTMLInputElement>('.apps-select-all')?.focus() }}><X size={12} aria-hidden="true" /></button>
  </div>
}
