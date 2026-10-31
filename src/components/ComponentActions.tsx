import { t as translateUi } from '../lib/i18n'
import { t, message } from "../lib/i18n"
import { isDatabaseId } from '../../electron/database-protocol'
import { Download, FolderOpen, RefreshCw, Search, ShieldCheck, Wrench } from 'lucide-react'
import { isBusy, isManual, isReady, type ManagedComponent } from '../lib/components'
import { useAppStore } from '../store/useAppStore'
import { HintButton } from './Tooltip'

export function PrimaryAction({ component, compact = false }: { component: ManagedComponent; compact?: boolean }) {
  const operate = useAppStore(state => state.operate)
  const setLocateId = useAppStore(state => state.setLocateId)
  const openLocation = useAppStore(state => state.openLocation)
  const pending = useAppStore(state => state.componentPending || state.bulkBusy || state.components.some(c => isBusy(c.status)))
  const status = component.status
  const hint = (text: string) => pending ? t("Wait for the current component operation to finish.\n{0}", [message(text)]) : message(text)
  if (component.id === 'driver' && status === 'Not detected') return <HintButton hint={hint('Windows could not confirm the driver status. Check the installed packages again.')} className="button secondary" disabled={pending} onClick={() => void operate(component.id, 'detect')}><RefreshCw size={14} />{t("Check again")}</HintButton>
  if (component.id === 'geoip') return <HintButton hint={hint(translateUi("Choose the local folder containing MMDB location and network databases used by connection lookups."))} className={`button ${compact ? 'row-action' : 'primary'}`} disabled={pending} onClick={() => setLocateId('geoip')}><FolderOpen size={14} />{component.location ? t("Change database folder") : t("Locate MMDB files")}</HintButton>
  if (isDatabaseId(component.id)) return <HintButton hint={hint(translateUi("Download current detection databases from their configured source for local application analysis."))} className="button primary" disabled={pending} onClick={() => void operate(component.id, 'install')}><Download size={14} />{t("Update databases")}</HintButton>
  if (component.id === 'driver' && !isBusy(status) && !isReady(status)) return <HintButton hint={hint(translateUi("Optional Google driver for compatible USB devices. If USB already works, you can skip this. Windows asks for administrator approval."))} type="button" className={`button ${compact ? 'row-action' : 'secondary'}`} aria-label={t("Install driver: {0}", [component.name])} disabled={pending} onClick={() => void operate(component.id, 'install')}><ShieldCheck size={14} /><span>{t("Install (optional)")}</span></HintButton>
  const manual = isManual(status)
  const ready = isReady(status)
  const repair = ['Repair needed', 'Version mismatch', 'Install failed'].includes(status)
  const Icon = manual ? FolderOpen : ready ? FolderOpen : repair ? Wrench : Download
  const label = isBusy(status) ? t("In progress") : manual ? component.location ? t("Open instructions / files") : t("Locate manually") : ready ? t("Open location") : repair ? t("Repair") : status === 'Download failed' ? t("Retry download") : status === 'Update available' ? t("Update") : t("Download")
  const description = manual ? component.location ? t("Open the prepared component folder to complete its required manual steps.") : t("Choose an existing component folder and verify that it contains the required files.") : ready ? translateUi("Open the verified {0} folder in Windows Explorer.", [component.name]) : component.id === 'runtime' ? t("Download and run the signed Microsoft Visual C++ x64 installer. Windows asks for administrator approval.") : `${repair ? t("Download and verify a fresh copy to repair") : status === 'Update available' ? t("Download and verify the available update for") : t("Download and verify the official package for")} ${component.name}.`
  return <HintButton hint={hint(description)} type="button" className={`button ${compact ? 'row-action' : ready ? 'secondary' : 'primary'}`} disabled={pending} aria-label={`${label}: ${component.name}`} onClick={() => { if (manual && component.location) void openLocation(component.id); else if (manual) setLocateId(component.id); else if (ready) void openLocation(component.id); else void operate(component.id, repair ? 'repair' : 'install') }}><Icon size={14} /><span>{compact && ready ? t("Open") : compact && manual ? component.location ? t("Open") : t("Locate") : compact && status === 'Download failed' ? t("Retry") : label}</span></HintButton>
}

export function RecoveryActions({ component }: { component: ManagedComponent }) {
  const { operate, setLocateId, openLocation, componentPending, bulkBusy, components } = useAppStore()
  const busy = componentPending || bulkBusy || components.some(c => isBusy(c.status))
  const hint = (text: string) => busy ? translateUi("Wait for the current component operation to finish.\n{0}", [text]) : text
  const folderHint = hint(component.location ? t("Open the configured database folder in Windows Explorer.") : t("Choose a database folder first; no location is configured yet."))
  if (component.id === 'geoip') return <div className="recovery-actions"><HintButton hint={hint(translateUi("Read and validate the MMDB files in the configured folder again."))} className="button secondary" disabled={busy} onClick={() => void operate('geoip', 'detect')}><RefreshCw size={14} />{t("Reload databases")}</HintButton><HintButton hint={folderHint} className="button secondary" disabled={busy || !component.location} onClick={() => void openLocation('geoip')}><FolderOpen size={14} />{t("Open database folder")}</HintButton></div>
  if (isDatabaseId(component.id)) return <div className="recovery-actions"><HintButton hint={hint(translateUi("Check the installed database version and whether a newer source revision is available."))} className="button secondary" disabled={busy} onClick={() => void operate(component.id, 'detect')}><RefreshCw size={14} />{t("Check for updates")}</HintButton><HintButton hint={hint(translateUi("Replace the managed detection databases with the verified copies included with ADB Vault."))} className="button secondary" disabled={busy} onClick={() => void operate(component.id, 'repair')}><Wrench size={14} />{t("Restore bundled databases")}</HintButton><HintButton hint={folderHint} className="button secondary" disabled={busy || !component.location} onClick={() => void openLocation(component.id)}><FolderOpen size={14} />{t("Open database files / licences")}</HintButton></div>
  const primaryOpens = isReady(component.status) || (isManual(component.status) && !!component.location)
  const primaryLocates = isManual(component.status) && !component.location && component.id !== 'driver'
  const primaryRepairs = component.id !== 'driver' && ['Repair needed', 'Version mismatch', 'Install failed'].includes(component.status)
  return <div className="recovery-actions">
    <HintButton hint={hint(translateUi("Search the configured and standard locations again, then verify the installed component and its version."))} className="button secondary" disabled={busy} onClick={() => void operate(component.id, 'detect')}><RefreshCw size={14} />{t("Detect again")}</HintButton>
    {component.id !== 'runtime' && !primaryLocates && <HintButton hint={hint('Choose an existing component folder and verify that it contains the required files.')} className="button secondary" disabled={busy} onClick={() => setLocateId(component.id)}><Search size={14} />{t("Locate manually")}</HintButton>}
    {!primaryRepairs && <HintButton hint={hint(isManual(component.status) ? t("Complete the required manual installation steps, then use Detect again.") : component.id === 'driver' ? t("Install the Google USB driver package again for compatible devices. Windows asks for administrator approval.") : component.id === 'runtime' ? t("Run the official Microsoft Visual C++ x64 installer again. Windows asks for administrator approval.") : t("Download and verify a fresh official copy to restore missing or damaged component files."))} className="button secondary" disabled={busy || isManual(component.status)} onClick={() => void operate(component.id, 'repair')}><Wrench size={14} />{t("Repair component")}</HintButton>}
    {!primaryOpens && <HintButton hint={hint(component.location ? t("Open the current component folder in Windows Explorer.") : t("Locate or install the component first; no folder is available yet."))} className="button secondary" disabled={busy || !component.location} onClick={() => void openLocation(component.id)}><FolderOpen size={14} />{t("Open location")}</HintButton>}
  </div>
}
