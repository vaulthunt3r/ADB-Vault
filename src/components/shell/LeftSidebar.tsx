import { Tooltip } from '../Tooltip'
import { Settings, type LucideIcon } from 'lucide-react'
import { useAppStore, type Section } from '../../store/useAppStore'
import { workspaces } from '../../lib/workspaces'
import { ResizeHandle } from './ResizeHandle'
import { useWorkspaceStatus, type StatusInfo } from './useWorkspaceStatus'

function NavigationItem({ id, name, icon: Icon, active, info, navigate }: { id: Section; name: string; icon: LucideIcon; active: boolean; info?: StatusInfo; navigate: (id: Section) => void }) {
  const description = info ? `${name} — ${info.summary}\n${info.rows.map(row => `${row.label}: ${row.value}`).join('\n')}` : name
  return <Tooltip text={description} side="right" className="nav-entry">{hintId => <button className={`nav-item ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined} aria-label={name} data-tour={id} aria-describedby={hintId} onClick={() => navigate(id)}>
      <Icon size={18} strokeWidth={1.8} aria-hidden="true" /><span>{name}</span>
      {info && <span className={`nav-status-mark ${info.tone}`} aria-hidden="true" />}
    </button>}</Tooltip>
}

export function LeftSidebar({ width }: { width: number }) {
  const { section, setSection, leftSidebar, workspaceOrder, hiddenWorkspaces } = useAppStore()
  const visible = workspaceOrder.filter(id => !hiddenWorkspaces.includes(id)).map(id => workspaces.find(item => item.id === id)!)
  const icons = leftSidebar === 'icons'
  const statuses = useWorkspaceStatus()
  return <aside id="main-sidebar" className={`left-sidebar ${icons ? 'icons' : 'expanded'}`} aria-label="Main sidebar" style={{ width, flexBasis: width }}>
    {!icons && <ResizeHandle side="left" width={width} />}
    <nav aria-label="Main navigation">{visible.map(item => <NavigationItem key={item.id} {...item} active={section === item.id} info={statuses[item.id]} navigate={setSection} />)}
    <div className="sidebar-bottom"><div className="sidebar-bottom-line"><button className={`nav-item ${section === 'settings' ? 'active' : ''}`} aria-current={section === 'settings' ? 'page' : undefined} aria-label="Settings" data-tour="settings" title={icons ? "Settings" : undefined} onClick={() => setSection('settings')}><Settings size={18} strokeWidth={1.8} /><span>Settings</span></button></div></div></nav>
  </aside>
}
