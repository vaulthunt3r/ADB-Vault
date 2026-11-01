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
  const scopeLabel = scope === 'shared' ? "Shared settings" : toolbarWorkspaces.find(item => item.id === scope)!.label
  const preview = scope === 'shared' ? previewWorkspace : scope
  const pin = (id: ToolbarActionId, enabled: boolean) => {
    store.setPinned(enabled ? [...pinned, id] : pinned.filter(item => item !== id), scope)
    setAnnouncement(`${toolbarActions.find(action => action.id === id)!.label} ${enabled ? 'pinned' : "moved to the menu"}.`)
    requestAnimationFrame(() => document.getElementById(`toolbar-edit-${id}`)?.focus())
  }
  function move(id: ToolbarActionId, target: ToolbarActionId) {
    const next = [...pinned], from = next.indexOf(id), to = next.indexOf(target)
    if (from < 0 || to < 0 || from === to) return
    next.splice(from, 1); next.splice(to, 0, id); store.setPinned(next, scope)
    setAnnouncement(`${toolbarActions.find(action => action.id === id)!.label} moved to position ${to + 1}.`)
  }
  const available = toolbarActions.filter(action => !pinned.includes(action.id) && `${action.label} ${action.description}`.toLowerCase().includes(query.toLowerCase().trim()))
  return <fieldset className="toolbar-settings" id="status-bar-settings" tabIndex={-1}><legend>Status bar</legend>
    <div className="toolbar-editor-heading"><label>Configure<select aria-label="Configure status bar for" value={scope} onChange={event => { setScope(event.target.value as ToolbarScope); setDragged(null); setDropTarget(null); setQuery('') }}>
      <option value="shared">Shared · all workspaces</option>{toolbarWorkspaces.map(item => <option key={item.id} value={item.id}>{item.label}{store.overrides[item.id] ? " · Custom" : " · Shared"}</option>)}
    </select></label><small>Saved automatically</small></div>
    <p>Choose what stays on the bar. Everything else is still available in ⋮.</p>
    <div className="toolbar-editor-scope">{scope === 'shared' ? <span>Used by every workspace that follows shared settings.</span> : <>
      <label><input type="checkbox" checked={inherited} onChange={event => store.setCustom(scope, !event.target.checked)} />Use shared settings</label><span>{inherited ? `${scopeLabel} follows the shared layout.` : `Only ${scopeLabel} uses this layout.`}</span>
    </>}</div>
    <div className="toolbar-preview-area"><div className="toolbar-preview-heading"><h3>Preview</h3><span>
      {scope === 'shared' && <label>In<select aria-label="Preview workspace" value={previewWorkspace} onChange={event => setPreviewWorkspace(event.target.value as ToolbarWorkspace)}>{toolbarWorkspaces.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
      <label><input type="checkbox" checked={sampleOperation} onChange={event => setSampleOperation(event.target.checked)} />Sample operation</label>
    </span></div><ToolbarPreview config={config} workspace={preview} labels={appearance.toolbarLabels} operation={sampleOperation} />
      <small>Preview width follows this editor. On the real bar, actions that do not fit move to ⋮ in the same order.</small>
    </div>
    {inherited ? <div className="toolbar-editor-inherited">{"To change only "}{scopeLabel}{", turn off “Use shared settings”. Or "}<button type="button" onClick={() => setScope('shared')}>edit the shared layout</button>.</div> : <>
      <div className="toolbar-editor-options">
        <label><input type="checkbox" checked={showDevice} onChange={event => store.setShowDevice(event.target.checked, scope)} aria-label="Show Connected phone card" /><Smartphone size={16} />Connected card</label>
        <label>Operations position<select aria-label="Operations position" value={operationPosition} onChange={event => store.setOperationPosition(event.target.value as 'start' | 'end', scope)}><option value="start">Start of the row</option><option value="end">End of the row</option></select></label>
        {scope === 'shared' && <fieldset className="toolbar-editor-format"><legend>Toolbar buttons</legend><label><input type="radio" name="toolbar-buttons" checked={appearance.toolbarLabels} onChange={() => appearance.setToolbarLabels(true)} aria-label="Icon and text" />Icon + text</label><label><input type="radio" name="toolbar-buttons" checked={!appearance.toolbarLabels} onChange={() => appearance.setToolbarLabels(false)} aria-label="Icons only" />Icons only</label></fieldset>}
      </div>
      {!showDevice && <p>Phone selection stays available in ⋮.</p>}
      <div className="toolbar-editor-section-title"><h3>{"Pinned actions "}<span>{pinned.length}</span></h3><small>Drag to reorder · arrow buttons also work</small></div>
      {pinned.length ? <ul className="toolbar-card-grid" aria-label="Toolbar action order">{pinned.map((id, index) => {
        const action = toolbarActions.find(item => item.id === id)!
        return <li key={id} data-action-id={id} className={`toolbar-editor-pinned${dropTarget === id ? " toolbar-drop-target" : ''}`}
          onDragOver={event => { if (dragged) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(id) } }}
          onDrop={event => { event.preventDefault(); if (dragged) move(dragged, id); setDragged(null); setDropTarget(null) }}>
          <CardHint text={action.description}>{hint => <><div className="toolbar-card-tools"><button type="button" id={`toolbar-edit-${id}`} className="toolbar-drag-handle" aria-label={`Drag ${action.label}`} aria-describedby={hint} draggable
            onDragStart={event => { setDragged(id); event.dataTransfer.setData('text/plain', id); event.dataTransfer.effectAllowed = 'move' }}
            onDragEnd={() => { setDragged(null); setDropTarget(null) }}
            onKeyDown={event => { if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); const target = pinned[index + (['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1)]; if (target) move(id, target) }}><GripVertical size={14} /></button><span>{index + 1}</span><button type="button" aria-label={`Move ${action.label} up`} disabled={index === 0} onClick={() => move(id, pinned[index - 1])}><ArrowLeft size={14} /></button><button type="button" aria-label={`Move ${action.label} down`} disabled={index === pinned.length - 1} onClick={() => move(id, pinned[index + 1])}><ArrowRight size={14} /></button><button type="button" aria-label={`Unpin ${action.label}`} onClick={() => pin(id, false)}><X size={14} /></button></div>
            <div className="toolbar-editor-card"><ToolbarActionIcon id={id} scope={scope} /><span>{action.label}</span><Check size={13} aria-label="Pinned" /></div>
          </>}</CardHint>
        </li>
      })}</ul> : <p className="toolbar-editor-empty">No pinned actions. Choose a card below to add it; all actions remain in ⋮.</p>}
      <div className="toolbar-editor-section-title"><h3>Add actions</h3><label className="toolbar-editor-search"><Search size={15} /><input type="search" aria-label="Find a status bar action" placeholder="Find an action…" value={query} onChange={event => setQuery(event.target.value)} /></label></div>
      {toolbarGroups.map(group => {
        const actions = group.actions.flatMap(id => available.find(action => action.id === id) ?? [])
        return actions.length > 0 && <div className="toolbar-catalog-group" key={group.label}><h4>{group.label}</h4><ul className="toolbar-card-grid" aria-label={group.label}>{actions.map(action => <li key={action.id} data-action-id={action.id}><CardHint text={action.description}>{hint => <button type="button" className="toolbar-editor-card" id={`toolbar-edit-${action.id}`} aria-label={`Pin ${action.label}`} aria-describedby={hint} onClick={() => pin(action.id, true)}><ToolbarActionIcon id={action.id} scope={scope} /><span>{action.label}</span><Plus className="toolbar-card-add" aria-hidden="true" /></button>}</CardHint></li>)}</ul></div>
      })}
      {!available.length && <p className="toolbar-editor-empty">{query ? "No matching actions." : "All actions are pinned. Extra actions move to ⋮ when space is limited."}</p>}
    </>}
    <div className="toolbar-editor-footer"><small>{scope === 'shared' ? "Changes apply to workspaces using the shared layout." : `Editing ${scopeLabel}. Other workspaces keep their settings.`}</small>
      {scope === 'shared' && <button type="button" className="button secondary" onClick={store.reset}>Reset status bar</button>}
    </div><span className="sr-only" role="status" aria-live="polite">{announcement}</span>
  </fieldset>
}
