import { CircleHelp, LockKeyhole, Minus, PanelRight, Square, X } from 'lucide-react'
import { useTourStore } from '../../store/useTourStore'
import { IconButton } from '../ui'
import { useAppStore } from '../../store/useAppStore'
import { useAppearanceStore } from '../../store/useAppearanceStore'
import { TerminalMark } from './TerminalMark'
import { TerminalActivation } from './TerminalActivation'
import { TerminalTitle } from './TerminalTitle'
import { getTerminalTheme } from '../../lib/themes'

export function TitleBar() {
  const terminalMode = useAppearanceStore(state => state.terminalMode)
  const terminalPinned = useAppearanceStore(state => state.terminalPinned)
  const terminalColor = useAppearanceStore(state => state.terminalColor)
  const terminalModeName = getTerminalTheme(terminalColor).name
  const section = useAppStore(state => state.section)
  const leftSidebar = useAppStore(state => state.leftSidebar)
  const rightSidebar = useAppStore(state => state.rightSidebar)
  const cycleSidebar = useAppStore(state => state.cycleSidebar)
  const startTour = useTourStore(state => state.start)
  const leftAction = leftSidebar === 'expanded' ? "show icons" : "expand"
  const terminalHint = terminalPinned
    ? `${terminalModeName} is pinned across restarts. Right-click the terminal icon to unpin; double-click to exit.`
    : `${terminalModeName} is active for this session. Right-click the terminal icon to pin across restarts; double-click to exit.`
  return <header className="titlebar">
    <div className="titlebar-left"><IconButton label={`Left sidebar: ${leftSidebar}; ${leftAction}`} aria-expanded={leftSidebar === 'expanded'} aria-controls="main-sidebar" onClick={() => cycleSidebar('left')}><PanelRight size={18} /></IconButton><div className="app-wordmark"><TerminalMark />{terminalMode ? <TerminalTitle /> : "ADB Vault"}<span className="titlebar-divider" /><span className="titlebar-subtitle">{terminalMode ? <span className="terminal-mode-status" title={terminalHint}>{terminalPinned && <LockKeyhole size={12} aria-label="Zero Cool pinned" />}{terminalModeName.toUpperCase()}</span> : "Android device workspace"}</span></div></div>
    <div className="titlebar-right"><IconButton label="Quick tour" data-tour="help" onClick={startTour}><CircleHelp size={17} /></IconButton><span className="prototype-tag">ADB MANAGER</span>{section !== 'files' && <IconButton label={`Right sidebar: ${rightSidebar}; ${rightSidebar === 'expanded' ? "collapse" : "expand"}`} aria-expanded={rightSidebar === 'expanded'} aria-controls="context-sidebar" onClick={() => cycleSidebar('right')}><PanelRight size={18} /></IconButton>}{window.desktop && <div className="window-controls"><IconButton label="Minimize window" onClick={() => void window.desktop?.control('minimize')}><Minus size={15} /></IconButton><IconButton label="Maximize or restore window" onClick={() => void window.desktop?.control('maximize')}><Square size={12} /></IconButton><IconButton label="Close window" className="window-close" onClick={() => void window.desktop?.control('close')}><X size={16} /></IconButton></div>}</div>
    {terminalMode && <TerminalActivation />}
  </header>
}
