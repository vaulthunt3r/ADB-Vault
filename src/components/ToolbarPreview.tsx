import { message } from "../lib/i18n"
import { t } from "../lib/i18n"
import { useId, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, MoreVertical, Smartphone, Users } from 'lucide-react'
import { fittingToolbarActions, toolbarActions, type ToolbarConfig, type ToolbarWorkspace } from '../lib/toolbar'
import { ToolbarActionIcon } from './ToolbarActionIcon'

export function ToolbarPreview({ config, workspace, labels, operation }: { config: ToolbarConfig; workspace: ToolbarWorkspace; labels: boolean; operation: boolean }) {
  const lane = useRef<HTMLDivElement>(null), measurements = useRef<HTMLDivElement>(null), menu = useRef<HTMLDivElement>(null)
  const menuId = useId(), [count, setCount] = useState(0), [open, setOpen] = useState(false)
  const chosen = config.pinned.filter(id => id !== 'workspace' || workspace === 'apps' || workspace === 'components').map(id => {
    const action = toolbarActions.find(item => item.id === id)!
    return { ...action, label: id === 'workspace' ? workspace === 'apps' ? t("Refresh applications") : t("Check components") : action.label }
  })
  const key = JSON.stringify([chosen, labels, config.showDevice, operation, workspace])
  useLayoutEffect(() => {
    const row = lane.current, shelf = measurements.current
    if (!row || !shelf) return
    const measure = () => setCount(fittingToolbarActions(Array.from(shelf.children).map(child => child.getBoundingClientRect().width), row.clientWidth, 8))
    measure()
    const observer = new ResizeObserver(measure); observer.observe(row); observer.observe(shelf)
    let mounted = true
    void document.fonts.ready.then(() => { if (mounted) measure() })
    return () => { mounted = false; observer.disconnect() }
  }, [key])
  const hidden = chosen.slice(count)
  const content = (action: typeof chosen[number]) => <><ToolbarActionIcon id={action.id} scope={workspace} />{labels && <span>{action.label}</span>}</>
  return <div className="topbar unified-toolbar toolbar-preview" role="group" aria-label={t("Status bar preview")} data-operation-position={config.operationPosition}>
    {config.showDevice && <span className="toolbar-card toolbar-device"><Smartphone /><span className="toolbar-device-copy"><strong>{t("Phone")}</strong><small><i className="connected" />{t("Connected")}</small></span><ChevronDown /></span>}
    {workspace === 'apps' && <span className="toolbar-profile-slot toolbar-card toolbar-preview-profile"><Users /><span>{t("Owner · ID 0")}</span><ChevronDown /></span>}
    <div className="toolbar-action-lane" ref={lane}>{chosen.slice(0, count).map(action => <span className={`toolbar-card toolbar-action${labels ? " with-label" : ''}`} data-preview-action={action.id} key={action.id} title={message(action.description)}>{content(action)}</span>)}</div>
    {operation && <span className="workspace-progress toolbar-preview-operation"><span>{t("Reading applications")}</span><strong>28%</strong></span>}
    <button type="button" className="toolbar-card toolbar-more" aria-label={t("Preview overflow")} aria-expanded={open} aria-haspopup="dialog" aria-controls={menuId} popoverTarget={menuId} onClick={event => {
      const box = event.currentTarget.getBoundingClientRect()
      if (menu.current) { menu.current.style.left = `${Math.max(8, box.right - 280)}px`; menu.current.style.top = `${Math.max(8, Math.min(box.bottom + 6, window.innerHeight - 260))}px` }
    }}><MoreVertical /></button>
    <div className="toolbar-measurements" aria-hidden="true" inert ref={measurements}>{chosen.map(action => <span key={action.id} className={`toolbar-card toolbar-action${labels ? " with-label" : ''}`}>{content(action)}</span>)}</div>
    <div popover="auto" ref={menu} id={menuId} className="toolbar-popover toolbar-preview-menu" role="dialog" aria-label={t("Preview overflow actions")} onToggle={event => setOpen(event.newState === 'open')}>
      <strong>{t("Preview only")}</strong>
      {!config.showDevice && <p><Smartphone size={15} />{t(" Select phone")}</p>}
      {hidden.map(action => <p key={action.id} data-preview-overflow={action.id}><ToolbarActionIcon id={action.id} scope={workspace} />{action.label}</p>)}
      {!hidden.length && <p>{t("All pinned actions fit.")}</p>}
      <small>{t("Other actions remain available in the real ⋮ menu.")}</small>
    </div>
  </div>
}
