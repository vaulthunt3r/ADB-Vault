import { t as translateUi } from '../lib/i18n'
import { t } from "../lib/i18n"
import { useState } from 'react'
import { ArrowDown, ArrowUp, GripVertical, LockKeyhole, Settings } from 'lucide-react'
import { workspaces, type WorkspaceId } from '../lib/workspaces'
import { useAppStore } from '../store/useAppStore'
import './workspace-settings.css'

export function WorkspaceSettings() {
  const { workspaceOrder, hiddenWorkspaces, setWorkspaceOrder, setWorkspaceVisible, resetWorkspaces } = useAppStore()
  const [dragged, setDragged] = useState<WorkspaceId | null>(null), [dropTarget, setDropTarget] = useState<WorkspaceId | null>(null)
  const [announcement, setAnnouncement] = useState('')
  function move(id: WorkspaceId, target: WorkspaceId) {
    const order = [...workspaceOrder], from = order.indexOf(id), to = order.indexOf(target)
    if (from < 0 || to < 0 || from === to) return
    order.splice(from, 1); order.splice(to, 0, id); setWorkspaceOrder(order)
    setAnnouncement(`${workspaces.find(item => item.id === id)!.name} moved to position ${to + 1}.`)
  }
  return <section className="section-content workspace-settings" aria-labelledby="workspace-settings-title">
    <div className="section-heading"><div><div className="eyebrow section-eyebrow">{t("SETTINGS / WORKSPACES")}</div><h1 id="workspace-settings-title">{t("Workspaces")}</h1><p>{t("Choose which workspaces appear in the sidebar and arrange their order.")}</p></div></div>
    <div className="workspace-settings-heading"><span>{t("Drag to reorder, or use the arrow buttons.")}</span><small>{t("Saved automatically")}</small></div>
    <ol className="workspace-settings-list" aria-label={t("Workspace order")}>{workspaceOrder.map((id, index) => {
      const item = workspaces.find(item => item.id === id)!, Icon = item.icon, visible = !hiddenWorkspaces.includes(id)
      return <li key={id} data-workspace={id} className={`${visible ? '' : 'workspace-hidden '}${dropTarget === id ? 'workspace-drop-target' : ''}`}
        onDragOver={event => { if (dragged) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(id) } }}
        onDrop={event => { event.preventDefault(); if (dragged) move(dragged, id); setDragged(null); setDropTarget(null) }}>
        <button type="button" className="workspace-drag" draggable aria-label={t("Drag {0}", [item.name])} title={t("Drag to reorder; arrow keys also work")}
          onDragStart={event => { setDragged(id); event.dataTransfer.setData('text/plain', id); event.dataTransfer.effectAllowed = 'move' }}
          onDragEnd={() => { setDragged(null); setDropTarget(null) }}
          onKeyDown={event => { if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return; event.preventDefault(); const target = workspaceOrder[index + (event.key === 'ArrowUp' ? -1 : 1)]; if (target) move(id, target) }}><GripVertical size={16} /></button>
        <span className="workspace-order-number" aria-hidden="true">{index + 1}</span><Icon className="workspace-settings-icon" size={18} aria-hidden="true" />
        <span className="workspace-settings-name">{item.name}<small>{visible ? t("Shown in sidebar") : t("Hidden from sidebar")}</small></span>
        <div className="workspace-move-buttons"><button type="button" aria-label={t("Move {0} up", [item.name])} title={t("Move up")} disabled={index === 0} onClick={() => move(id, workspaceOrder[index - 1])}><ArrowUp size={15} /></button>
          <button type="button" aria-label={t("Move {0} down", [item.name])} title={t("Move down")} disabled={index === workspaceOrder.length - 1} onClick={() => move(id, workspaceOrder[index + 1])}><ArrowDown size={15} /></button></div>
        <label className="workspace-visible"><input type="checkbox" aria-label={t("Show {0}", [item.name])} checked={visible} onChange={event => { setWorkspaceVisible(id, event.target.checked); setAnnouncement(`${item.name} ${event.target.checked ? t("shown in") : t("hidden from")} the sidebar.`) }} />{t("Show")}</label>
      </li>
    })}</ol>
    <div className="workspace-settings-fixed"><Settings size={18} /><span>{t("Settings")}<small>{t("Always available at the bottom of the sidebar.")}</small></span><LockKeyhole size={15} aria-label={t("Always visible")} /></div>
    <div className="workspace-settings-footer"><p>{t("Hidden workspaces can be restored here. Hiding a workspace keeps its data and running operations; shortcuts can still open it.")}</p><button type="button" className="button secondary" onClick={() => { resetWorkspaces(); setAnnouncement(translateUi("Default workspace order and visibility restored.")) }}>{t("Reset workspaces")}</button></div>
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
  </section>
}
