import { ActionIndicator } from './ui'
import { useId, useState } from 'react'
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import { batchSkipReason, cleanupLabels, cleanupParts, type CleanupPart } from '../../electron/app-actions-protocol'
import type { AndroidApp } from '../../electron/apps-protocol'
import { useAppsStore } from '../store/useAppsStore'
import { requestBackend } from '../lib/backend'
import { PackageActionBadge } from './PackageActionControls'
import type { PackageAction, PackageActionOptions } from '../../electron/package-actions-protocol'

export function AppsClearActions({ chosen, ready, options }: { chosen: AndroidApp[]; ready: boolean; options?: PackageActionOptions }) {
  const { apps, deviceId, userId } = useAppsStore()
  const [expanded, setExpanded] = useState(false), [parts, setParts] = useState<CleanupPart[]>([]), [submitting, setSubmitting] = useState(false)
  const panelId = useId(), includedCache = parts.includes('data')
  const eligible = chosen.filter(a => !batchSkipReason('clear-storage', a, apps)).length
  const disabled = !ready || submitting
  const toggle = (part: CleanupPart) => setParts(current => current.includes(part) ? current.filter(p => p !== part) : [...current, part])
  async function clear() {
    if (disabled || !parts.length || !eligible || !deviceId || userId === null) return
    setSubmitting(true)
    try { await requestBackend({ type: 'apps.batchAction', plan: { id: deviceId, userId, packages: chosen.map(a => a.packageName), action: 'clear-storage', cleanup: parts, options } }) }
    finally { setSubmitting(false) }
  }
  return <div className="apps-clear">
    <button className="button secondary app-action-destructive" aria-expanded={expanded} aria-controls={panelId} disabled={!eligible && !expanded} title={!eligible ? "Cleanup is unavailable for core or shared Android UIDs" : "Choose what to clear"} onClick={() => setExpanded(v => !v)}><Trash2 size={15} />Clear{expanded ? <ChevronUp size={14} className="action-indicator" aria-hidden="true" /> : <ChevronDown size={14} className="action-indicator" aria-hidden="true" />}</button>
    {expanded && <div id={panelId} className="apps-clear-options" role="group" aria-label="Cleanup categories">
      {cleanupParts.map(part => <label key={part}><input type="checkbox" aria-label={cleanupLabels[part]} checked={parts.includes(part) || (part === 'cache' && includedCache)} disabled={disabled || (part === 'cache' && includedCache)} onChange={() => toggle(part)} /><span>{cleanupLabels[part]}{part === 'cache' && includedCache ? <small>Included in app data</small> : (part === 'data' || part === 'cache') && <PackageActionBadge apps={chosen} action={('clear-' + part) as PackageAction} options={options || {}} />}</span></label>)}
      <button className="text-button" disabled={disabled} onClick={() => setParts([...cleanupParts])}>Select all</button>
      <button className="button secondary app-action-destructive" disabled={disabled || !parts.length || !eligible} title={`${eligible} applications will be affected; confirmation follows`} onClick={() => void clear()}>Clear selected<ActionIndicator /></button>
      {eligible < chosen.length && <small>{chosen.length - eligible}{" unavailable applications will be skipped."}</small>}
    </div>}
  </div>
}
