import { message } from "../../lib/i18n"
import { t } from "../../lib/i18n"
import { AdbConsoleInspector } from '../../sections/AdbConsoleSection'
import { MonitorInspector } from '../../sections/MonitorSection'
import { ArrowDownToLine, Info, ListChecks, Pin, SlidersHorizontal, TriangleAlert } from 'lucide-react'
import { useAppStore, type InspectorTab } from '../../store/useAppStore'
import { isBusy, isManual, isReady, recoveryMessage } from '../../lib/components'
import { ComponentIcon } from '../ComponentIcon'
import { PrimaryAction, RecoveryActions } from '../ComponentActions'
import { StatusBadge } from '../ui'
import { ResizeHandle } from './ResizeHandle'
import { ConnectionInspector } from '../ConnectionInspector'
import { AppearanceInspector } from '../AppearanceInspector'
import { ActivityInspector } from '../../sections/ActivitySection'
import { AdbDiagnosticsPanel } from '../AdbDiagnosticsPanel'
import { AppsInspector } from '../AppsInspector'
import { ComponentSource } from '../ComponentSource'
import { HintButton } from '../Tooltip'

const tabs = [{ id: 'details' as InspectorTab, get label() { return t("Details") }, icon: Info }, { id: 'actions' as InspectorTab, get label() { return t("Actions") }, icon: SlidersHorizontal }]

export function RightSidebar({ width }: { width: number }) {
  const { rightSidebar, inspectorTab, setTab, inspectorPins, toggleInspectorPin, section, settingsTab, selectedId, components, componentPending, bulkBusy, setLocateId } = useAppStore()
  const pinned = inspectorPins[section]
  if (rightSidebar === 'collapsed') return null
  const expanded = rightSidebar === 'expanded'
  const component = components.find(item => item.id === selectedId)!
  const recovery = recoveryMessage(component.status)
  return <aside id="context-sidebar" className={`right-sidebar ${rightSidebar}`} aria-label={t("Context sidebar")} style={{ width, flexBasis: width }}>
    <ResizeHandle side="right" width={width} />
    <div className="inspector-tabs" role="tablist" aria-label={t("Inspector tabs")} aria-orientation={expanded ? 'horizontal' : 'vertical'}>{tabs.map(({ id, label, icon: Icon }, index) => <button key={id} id={`tab-${id}`} role="tab" aria-controls="inspector-panel" aria-selected={inspectorTab === id} tabIndex={inspectorTab === id ? 0 : -1} title={`${label} — ${pinned === id ? t("Pinned. Double-click to unpin") : t("Double-click to pin in this workspace")}`} aria-label={label} aria-description={pinned === id ? t("Pinned in this workspace") : undefined} className={inspectorTab === id ? 'active' : ''} onClick={() => setTab(id)} onDoubleClick={() => toggleInspectorPin(id)} onKeyDown={event => {
      if (event.altKey && event.key.toLowerCase() === 'p') { event.preventDefault(); toggleInspectorPin(id); return }
      const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown'
      const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
      if (forward || backward || event.key === 'Home' || event.key === 'End') {
        event.preventDefault()
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (forward ? 1 : tabs.length - 1)) % tabs.length
        setTab(tabs[next].id)
        document.getElementById(`tab-${tabs[next].id}`)?.focus()
      }
    }}><Icon size={15} />{expanded && label}{pinned === id && <Pin size={11} className="inspector-tab-pin" aria-hidden="true" />}</button>)}</div>
    {expanded && <div id="inspector-panel" className="inspector-panel" role="tabpanel" aria-labelledby={`tab-${inspectorTab}`}>
      {section === 'console' ? <AdbConsoleInspector /> : section === 'monitor' ? <MonitorInspector /> : section === 'activity' ? <ActivityInspector /> : section === 'settings' ? settingsTab === 'workspaces' ? <><span className="eyebrow">{t("WORKSPACES / SIDEBAR")}</span><p className="component-description">{t("Reorder workspaces by dragging or with the arrow buttons. Show controls whether a workspace appears in the sidebar. Changes are saved automatically.")}</p><p className="component-description">{t("Settings stays available so hidden workspaces can always be restored. Running operations keep working when their workspace is hidden.")}</p></> : settingsTab === 'screen' ? <><span className="eyebrow">{t("SCREEN & AUDIO")}</span><p className="component-description">{t("Defaults apply to new scrcpy windows. Open Connection → Actions → Screen & recording to choose a mode or record video. Close the scrcpy window to finish recording. Virtual app windows use the phone’s current Android user.")}</p></> : settingsTab === 'notifications' ? <><span className="eyebrow">{t("NOTIFICATIONS")}</span><p className="component-description">{t("Sound and desktop notifications can be controlled independently. Alerts report task results and connection losses while ADB Vault is running. Click a notification to return to its workspace.")}</p></> : settingsTab === 'files' ? <><span className="eyebrow">{t("FILES / CATEGORIES")}</span><p className="component-description">{t("Folder rules belong to the selected location and category. Excluded folders are skipped during scanning. Visibility and service-folder choices save automatically; use Save folders for path lists, then Refresh in Files.")}</p></> : settingsTab === 'web-services' ? <><span className="eyebrow">{t("SEARCH / SCANNERS")}</span><p className="component-description">{t("Enable, edit or add websites for Find online. Search templates use the app name or package name. Scanner preparation copies APK files locally; submission happens on the website.")}</p></> : settingsTab === 'connection' ? <><span className="eyebrow">{t("CONNECTION / ADB")}</span><p className="component-description">{t("ADB Vault stops its own operations on exit. When server shutdown is enabled, the shared ADB server also stops. Other ADB tools can start it again.")}</p></> : settingsTab === 'appearance' ? <AppearanceInspector /> : settingsTab === 'badges' ? <><span className="eyebrow">{t("BADGES / COLORS")}</span><p className="component-description">{t("Colors apply immediately and persist across launches. Choose Auto text or set a custom text color for each badge. The legend explains each badge. Changing colors does not change application check results.")}</p></> : <><span className="eyebrow">{t("APPS / LOADING")}</span><p className="component-description">{t("The selected profile loads first. Profile data is cached in memory for the current session. Collection time is shown below the Apps table.")}</p></> : section === 'connection' ? <ConnectionInspector /> : section === 'apps' ? <AppsInspector /> : section !== 'components' ? <p className="component-description">{t("Real device operations are not enabled in this section yet.")}</p> : <>
        <div className="inspector-section-label"><span className="eyebrow">{inspectorTab === 'details' ? t("COMPONENT DETAILS") : t("COMPONENT ACTIONS")}</span></div>
        <div className="component-detail-heading"><ComponentIcon id={component.id} large /><span className="detail-category">{component.group === 'Detection databases' ? t("Detection database") : component.group === 'Core components' ? t("Core component") : t("Optional component")}</span><h2>{t(component.name)}</h2><StatusBadge status={component.status} />{component.status === 'Detected' && <p className="installed-origin">{t("Found on this computer. Installation verified; ready to use.")}</p>}</div>
        {inspectorTab === 'details' ? <><p className="component-description">{message(component.description)}</p><dl className="metadata"><div><dt>{t("Publisher")}</dt><dd>{component.publisher}</dd></div><ComponentSource component={component} /><div><dt>{component.status === 'Package ready' ? t("Package version") : isReady(component.status) ? t("Installed version") : t("Found version")}</dt><dd className="mono">{component.version}</dd></div><div><dt>{t("Target version")}</dt><dd className="mono">{component.targetVersion}</dd></div><div><dt>{t("Download size")}</dt><dd className="mono">{component.size}</dd></div><div><dt>{t("Architecture")}</dt><dd className="mono">{component.group === 'Detection databases' ? t("Platform independent") : t("Windows x64")}</dd></div></dl><div className="location-field"><span className="field-label">{component.status === 'Package ready' ? t("Package folder") : t("Installation location")}</span><code>{component.location ?? t("No location detected")}</code></div>
          {component.id === 'adb' && component.location && <AdbDiagnosticsPanel />}
          {recovery && <div className={`recovery-note ${component.status === 'Blocked' || component.status.endsWith('failed') ? 'failure-note' : ''}`}><TriangleAlert size={16} /><div><strong>{recovery.title}</strong><p>{component.message || recovery.body}</p></div></div>}
          {!recovery && component.message && <p className="component-result-note">{message(component.message)}</p>}<div className="detail-actions"><PrimaryAction component={component} />{component.group !== 'Detection databases' && component.id !== 'runtime' && !(isManual(component.status) && !component.location && component.id !== 'driver') && <HintButton hint={t("Choose an existing component folder and verify that it contains the required files.")} className="button secondary" disabled={componentPending || bulkBusy || components.some(c => isBusy(c.status))} onClick={() => setLocateId(component.id)}><ArrowDownToLine className="locate-icon" size={14} />{t("Locate manually")}</HintButton>}</div>
        </> : <><p className="component-description">{component.group === 'Detection databases' ? component.message : component.id === 'driver' ? component.message || t("Install the Google driver package into Windows. Administrator approval is required.") : t("Recover an existing installation or prepare a fresh copy.")}</p><div className="component-action-list"><PrimaryAction component={component} /><RecoveryActions component={component} /></div><p className="action-explanation"><ListChecks size={15} />{t("Operations use the installed tools and official component packages.")}</p></>}
      </>}
    </div>}
  </aside>
}
