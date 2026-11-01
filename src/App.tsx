import { AdbConsoleSection } from './sections/AdbConsoleSection'
import { ScreenDialog } from './components/ScreenControls'
import { HistoryRecoveryNotice } from './components/HistorySessions'
import { OperationConfirmation } from './components/OperationConfirmation'
import { AndroidDiagnosticsDialog } from './components/AndroidDiagnostics'
import { PhoneToolsDialog } from './components/PhoneTools'
import { FileSearchDialog } from './components/FileSearchDialog'
import { AppsRestoreDialog } from './components/AppsRestoreDialog'
import { MonitorSection } from './sections/MonitorSection'
import { useEffect, useLayoutEffect, useState } from 'react'
import { SettingsSection } from './sections/SettingsSection'
import { useAppearanceStore } from './store/useAppearanceStore'
import { applyTheme, applyZenMode, applyCornerStyle, getActiveTheme } from './lib/themes'
import { CircleCheck, X } from 'lucide-react'
import { useAppStore } from './store/useAppStore'
import { TitleBar } from './components/shell/TitleBar'
import { TopBar } from './components/shell/TopBar'
import { LeftSidebar } from './components/shell/LeftSidebar'
import { RightSidebar } from './components/shell/RightSidebar'
import { ComponentsSection } from './sections/ComponentsSection'
import { ConnectionSection } from './sections/ConnectionSection'
import { ActivitySection } from './sections/ActivitySection'
import { AppsSection } from './sections/AppsSection'
import { FileManager } from './sections/FileManager'
import { FileTasks } from './components/FileTasks'
import { startBackend } from './lib/backend'
import { useConnectionStore } from './store/useConnectionStore'
import { InterfaceTour, TourWelcome } from './components/InterfaceTour'

import { fitSidebarWidths } from './lib/layout'
import { AppsBackupDialog } from './components/AppsBackupDialog'
import { LocateDialog } from './components/LocateDialog'
import { IconButton } from './components/ui'

export function App() {
  useEffect(startBackend, [])
  const { themeId, density, zenMode, terminalMode, terminalColor, cornerStyle } = useAppearanceStore()
  const errorNotice = useConnectionStore(state => state.errorNotice)
  useEffect(() => {
    if (!errorNotice) return
    const timer = setTimeout(() => useConnectionStore.getState().dismissError(), 8000)
    return () => clearTimeout(timer)
  }, [errorNotice])
  useLayoutEffect(() => applyTheme(getActiveTheme(themeId, terminalMode, terminalColor)), [themeId, terminalMode, terminalColor])
  useLayoutEffect(() => applyZenMode(zenMode), [zenMode])
  useLayoutEffect(() => applyCornerStyle(cornerStyle), [cornerStyle])
  const { section, appsView, notice, noticeDurationMs, notify, leftSidebar, rightSidebar, leftWidth, rightWidth } = useAppStore()
  const [windowWidth, setWindowWidth] = useState(window.innerWidth)
  useEffect(() => { const resize = () => setWindowWidth(window.innerWidth); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize) }, [])
  const showInspector = section !== 'files' && !(section === 'apps' && appsView === 'apk')
  const widths = fitSidebarWidths(windowWidth, leftSidebar === 'expanded' ? leftWidth : 56, showInspector && rightSidebar === 'expanded' ? rightWidth : 0)
  useEffect(() => {
    if (!notice) return
    const timeout = setTimeout(() => notify(null), noticeDurationMs)
    return () => clearTimeout(timeout)
  }, [notice, noticeDurationMs, notify])
  return <div className="desktop-app"><TitleBar /><div className="app-body"><LeftSidebar width={widths.left} /><div className="workbench"><TopBar /><div className="workbench-body"><main className={`workspace density-${density}`}>{section === 'components' ? <><TourWelcome /><ComponentsSection /></> : section === 'connection' ? <ConnectionSection /> : section === 'apps' ? <AppsSection /> : section === 'monitor' ? <MonitorSection /> : section === 'console' ? <AdbConsoleSection /> : section === 'activity' ? <ActivitySection /> : section === 'settings' ? <SettingsSection /> : <FileManager />}</main>{showInspector && <RightSidebar width={widths.right} />}</div></div></div><ScreenDialog /><HistoryRecoveryNotice /><PhoneToolsDialog /><AndroidDiagnosticsDialog /><FileTasks /><FileSearchDialog /><LocateDialog /><AppsBackupDialog /><AppsRestoreDialog /><OperationConfirmation /><InterfaceTour />{notice && <div className="toast" role="status"><CircleCheck size={17} /><span>{notice}</span><IconButton label="Dismiss notification" onClick={() => notify(null)}><X size={15} /></IconButton></div>}</div>
}
