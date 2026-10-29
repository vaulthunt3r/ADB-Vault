import { t } from "../lib/i18n"
import { useState } from 'react'
import { Tooltip as CardHint } from './Tooltip'
import { ArrowLeft, ArrowRight, Check, GripVertical, Plus, Search, Smartphone, X } from 'lucide-react'
import { toolbarActions, toolbarConfig, toolbarGroups, toolbarWorkspaces, type ToolbarActionId, type ToolbarScope, type ToolbarWorkspace } from '../lib/toolbar'
import { useToolbarStore } from '../store/useToolbarStore'
import { useAppearanceStore } from '../store/useAppearanceStore'
import { ToolbarActionIcon } from './ToolbarActionIcon'
import { ToolbarPreview } from './ToolbarPreview'
import './toolbar-settings.css'

export function ToolbarSettings() {
  const store = useToolbarStore(), appearance = useAppearanceStore()
  const [scope, setScope] = useState<ToolbarScope>('shared'), [previewWorkspace, setPreviewWorkspace] = useState<ToolbarWorkspace>('apps')
  const [sampleOperation, setSampleOperation] = useState(false), [query, setQuery] = useState('')
  const [dragged, setDragged] = useState<ToolbarActionId | null>(null), [dropTarget, setDropTarget] = useState<ToolbarActionId | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const config = toolbarConfig(store, scope), { pinned, operationPosition, showDevice } = config
  const inherited = scope !== 'shared' && !store.overrides[scope]
  const scopeLabel = scope === 'shared' ? t("Shared settings") : toolbarWorkspaces.find(item => item.id === scope)!.label
  const preview = scope === 'shared' ? previewWorkspace : scope
  const pin = (id: ToolbarActionId, enabled: boolean) => {
    store.setPinned(enabled ? [...pinned, id] : pinned.filter(item => item !== id), scope)
    setAnnouncement(`${toolbarActions.find(action => action.id === id)!.label} ${enabled ? 'pinned' : t("moved to the menu")}.`)
    requestAnimationFrame(() => document.getElementById(`toolbar-edit-${id}`)?.focus())
  }
  function move(id: ToolbarActionId, target: ToolbarActionId) {
    const next = [...pinned], from = next.indexOf(id), to = next.indexOf(target)
    if (from < 0 || to < 0 || from === to) return
    next.splice(from, 1); next.splice(to, 0, id); store.setPinned(next, scope)
    setAnnouncement(`${toolbarActions.find(action => action.id === id)!.label} moved to position ${to + 1}.`)
  }
  const available = toolbarActions.filter(action => !pinned.includes(action.id) && `${action.label} ${action.description}`.toLowerCase().includes(query.toLowerCase().trim()))
  return <fieldset className="toolbar-settings" id="status-bar-settings" tabIndex={-1}><legend>{t("Status bar")}</legend>
    <div className="toolbar-editor-heading"><label>{t("Configure")}<select aria-label={t("Configure status bar for")} value={scope} onChange={event => { setScope(event.target.value as ToolbarScope); setDragged(null); setDropTarget(null); setQuery('') }}>
      <option value="shared">{t("Shared · all workspaces")}</option>{toolbarWorkspaces.map(item => <option key={item.id} value={item.id}>{item.label}{store.overrides[item.id] ? t(" · Custom") : t(" · Shared")}</option>)}
    </select></label><small>{t("Saved automatically")}</small></div>
    <p>{t("Choose what stays on the bar. Everything else is still available in ⋮.")}</p>
    <div className="toolbar-editor-scope">{scope === 'shared' ? <span>{t("Used by every workspace that follows shared settings.")}</span> : <>
      <label><input type="checkbox" checked={inherited} onChange={event => store.setCustom(scope, !event.target.checked)} />{t("Use shared settings")}</label><span>{inherited ? t("{0} follows the shared layout.", [scopeLabel]) : t("Only {0} uses this layout.", [scopeLabel])}</span>
    </>}</div>
    <div className="toolbar-preview-area"><div className="toolbar-preview-heading"><h3>{t("Preview")}</h3><span>
      {scope === 'shared' && <label>{t("In")}<select aria-label={t("Preview workspace")} value={previewWorkspace} onChange={event => setPreviewWorkspace(event.target.value as ToolbarWorkspace)}>{toolbarWorkspaces.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
      <label><input type="checkbox" checked={sampleOperation} onChange={event => setSampleOperation(event.target.checked)} />{t("Sample operation")}</label>
    </span></div><ToolbarPreview config={config} workspace={preview} labels={appearance.toolbarLabels} operation={sampleOperation} />
      <small>{t("Preview width follows this editor. On the real bar, actions that do not fit move to ⋮ in the same order.")}</small>
    </div>
    {inherited ? <div className="toolbar-editor-inherited">{t("To change only ")}{scopeLabel}{t(", turn off “Use shared settings”. Or ")}<button type="button" onClick={() => setScope('shared')}>{t("edit the shared layout")}</button>.</div> : <>
      <div className="toolbar-editor-options">
        <label><input type="checkbox" checked={showDevice} onChange={event => store.setShowDevice(event.target.checked, scope)} aria-label={t("Show Connected phone card")} /><Smartphone size={16} />{t("Connected card")}</label>
        <label>{t("Operations position")}<select aria-label={t("Operations position")} value={operationPosition} onChange={event => store.setOperationPosition(event.target.value as 'start' | 'end', scope)}><option value="start">{t("Start of the row")}</option><option value="end">{t("End of the row")}</option></select></label>
        {scope === 'shared' && <fieldset className="toolbar-editor-format"><legend>{t("Toolbar buttons")}</legend><label><input type="radio" name="toolbar-buttons" checked={appearance.toolbarLabels} onChange={() => appearance.setToolbarLabels(true)} aria-label={t("Icon and text")} />{t("Icon + text")}</label><label><input type="radio" name="toolbar-buttons" checked={!appearance.toolbarLabels} onChange={() => appearance.setToolbarLabels(false)} aria-label={t("Icons only")} />{t("Icons only")}</label></fieldset>}
      </div>
      {!showDevice && <p>{t("Phone selection stays available in ⋮.")}</p>}
      <div className="toolbar-editor-section-title"><h3>{t("Pinned actions ")}<span>{pinned.length}</span></h3><small>{t("Drag to reorder · arrow buttons also work")}</small></div>
      {pinned.length ? <ul className="toolbar-card-grid" aria-label={t("Toolbar action order")}>{pinned.map((id, index) => {
        const action = toolbarActions.find(item => item.id === id)!
        return <li key={id} data-action-id={id} className={`toolbar-editor-pinned${dropTarget === id ? " toolbar-drop-target" : ''}`}
          onDragOver={event => { if (dragged) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(id) } }}
          onDrop={event => { event.preventDefault(); if (dragged) move(dragged, id); setDragged(null); setDropTarget(null) }}>
          <CardHint text={action.description}>{hint => <><div className="toolbar-card-tools"><button type="button" id={`toolbar-edit-${id}`} className="toolbar-drag-handle" aria-label={t("Drag {0}", [action.label])} aria-describedby={hint} draggable
            onDragStart={event => { setDragged(id); event.dataTransfer.setData('text/plain', id); event.dataTransfer.effectAllowed = 'move' }}
            onDragEnd={() => { setDragged(null); setDropTarget(null) }}
            onKeyDown={event => { if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); const target = pinned[index + (['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1)]; if (target) move(id, target) }}><GripVertical size={14} /></button><span>{index + 1}</span><button type="button" aria-label={t("Move {0} up", [action.label])} disabled={index === 0} onClick={() => move(id, pinned[index - 1])}><ArrowLeft size={14} /></button><button type="button" aria-label={t("Move {0} down", [action.label])} disabled={index === pinned.length - 1} onClick={() => move(id, pinned[index + 1])}><ArrowRight size={14} /></button><button type="button" aria-label={t("Unpin {0}", [action.label])} onClick={() => pin(id, false)}><X size={14} /></button></div>
            <div className="toolbar-editor-card"><ToolbarActionIcon id={id} scope={scope} /><span>{action.label}</span><Check size={13} aria-label={t("Pinned")} /></div>
          </>}</CardHint>
        </li>
      })}</ul> : <p className="toolbar-editor-empty">{t("No pinned actions. Choose a card below to add it; all actions remain in ⋮.")}</p>}
      <div className="toolbar-editor-section-title"><h3>{t("Add actions")}</h3><label className="toolbar-editor-search"><Search size={15} /><input type="search" aria-label={t("Find a status bar action")} placeholder={t("Find an action…")} value={query} onChange={event => setQuery(event.target.value)} /></label></div>
      {toolbarGroups.map(group => {
        const actions = group.actions.flatMap(id => available.find(action => action.id === id) ?? [])
        return actions.length > 0 && <div className="toolbar-catalog-group" key={group.label}><h4>{group.label}</h4><ul className="toolbar-card-grid" aria-label={group.label}>{actions.map(action => <li key={action.id} data-action-id={action.id}><CardHint text={action.description}>{hint => <button type="button" className="toolbar-editor-card" id={`toolbar-edit-${action.id}`} aria-label={t("Pin {0}", [action.label])} aria-describedby={hint} onClick={() => pin(action.id, true)}><ToolbarActionIcon id={action.id} scope={scope} /><span>{action.label}</span><Plus className="toolbar-card-add" aria-hidden="true" /></button>}</CardHint></li>)}</ul></div>
      })}
      {!available.length && <p className="toolbar-editor-empty">{query ? t("No matching actions.") : t("All actions are pinned. Extra actions move to ⋮ when space is limited.")}</p>}
    </>}
    <div className="toolbar-editor-footer"><small>{scope === 'shared' ? t("Changes apply to workspaces using the shared layout.") : t("Editing {0}. Other workspaces keep their settings.", [scopeLabel])}</small>
      {scope === 'shared' && <button type="button" className="button secondary" onClick={store.reset}>{t("Reset status bar")}</button>}
    </div><span className="sr-only" role="status" aria-live="polite">{announcement}</span>
  </fieldset>
}
