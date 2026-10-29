import { message } from "../lib/i18n"
import { t } from "../lib/i18n"
import { useId, useRef, useState } from 'react'
import { Search, ShieldCheck, Settings, ExternalLink, Copy, FolderOpen, Download, X } from 'lucide-react'
import type { AndroidApp } from '../../electron/apps-protocol'
import { webServiceUrl, type ScanPreparation, type WebService } from '../../electron/web-services'
import { useWebServicesStore } from '../store/useWebServicesStore'
import { useAppStore } from '../store/useAppStore'
import { useAppsStore } from '../store/useAppsStore'
import { useConnectionStore } from '../store/useConnectionStore'
import { useAppActionsStore } from '../store/useAppActionsStore'
import { useBackupStore } from '../store/useBackupStore'
import { useRestoreBusy } from '../store/useRestoreStore'
import { requestBackend } from '../lib/backend'
import { copyText } from '../lib/clipboard'
import { BadgeDialog } from './BadgeDialog'

interface ScanTarget { app: AndroidApp; id: string | null; userId: number | null; service: WebService; url: string }
export function AppWebServices({ app }: { app: AndroidApp }) {
  const { services, query } = useWebServicesStore(), [group, setGroup] = useState<'search' | 'scanner'>('search')
  const [scan, setScan] = useState<ScanTarget | null>(null)
  const popover = useRef<HTMLDivElement>(null), id = useId()
  function open(button: HTMLButtonElement) {
    const box = button.getBoundingClientRect(), node = popover.current
    if (!node) return
    node.style.left = `${Math.max(8, Math.min(window.innerWidth - 324, box.right - 310))}px`
    node.style.top = `${Math.max(8, Math.min(box.bottom + 6, window.innerHeight - 460))}px`
    node.togglePopover()
  }
  function choose(service: WebService) {
    try {
      const url = webServiceUrl(service, app, query)
      popover.current?.hidePopover()
      if (service.kind === 'scanner') {
        const context = useAppsStore.getState()
        setScan({ app: { ...app }, id: context.deviceId, userId: context.userId, service: { ...service }, url })
      } else void requestBackend({ type: 'web.open', url })
    } catch (e) { useAppStore.getState().notify(e instanceof Error ? e.message : String(e)) }
  }
  return <><button className="button secondary app-find-online" title={t("Find this application on websites or prepare its APK files for a scanner")} aria-controls={id} aria-haspopup="dialog" onClick={e => open(e.currentTarget)}><Search size={14} />{t("Find online…")}</button>
    <div popover="auto" ref={popover} id={id} className="app-web-popover" role="dialog" aria-label={t("Find application online")}>
      <header><strong>{app.label}</strong><code>{app.packageName}</code></header>
      <div className="web-service-groups" role="group" aria-label={t("Service category")}><button aria-pressed={group === 'search'} onClick={() => setGroup('search')}><Search size={14} />{t("Search")}</button><button aria-pressed={group === 'scanner'} onClick={() => setGroup('scanner')}><ShieldCheck size={14} />{t("Scanners")}</button></div>
      {group === 'search' && <label className="web-search-query">{t("Search by")}<select aria-label={t("Search online by")} value={query} onChange={e => useWebServicesStore.setState({ query: e.target.value as 'package' | 'name' })}><option value="package">{t("Package name")}</option><option value="name">{t("Application name")}</option></select></label>}
      <div className="web-service-menu">{services.filter(s => s.enabled && s.kind === group).map(s => <button key={s.id} title={`${s.note ? t(s.note) + '\n' : ''}${s.url}`} onClick={() => choose(s)}>{group === 'scanner' ? <ShieldCheck size={15} /> : <Search size={15} />}<span>{s.name}{s.note && <small>{t(s.note)}</small>}</span><ExternalLink size={12} /></button>)}{!services.some(s => s.enabled && s.kind === group) && <p>{t("No enabled services. Add or enable them in Settings.")}</p>}</div>
      <button className="web-service-settings-link" onClick={() => { popover.current?.hidePopover(); useAppStore.setState({ settingsTab: 'web-services' }); useAppStore.getState().setSection('settings') }}><Settings size={14} />{t("Configure services…")}</button>
    </div>
    {scan && <ScanPreparationDialog target={scan} close={() => setScan(null)} />}
  </>
}
function ScanPreparationDialog({ target, close }: { target: ScanTarget; close: () => void }) {
  const [preparing, setPreparing] = useState(false), [result, setResult] = useState<ScanPreparation | null>(null), [error, setError] = useState('')
  const { deviceId, userId, status, badgeRead } = useAppsStore(), { devices, activeDeviceId } = useConnectionStore()
  const action = useAppActionsStore(s => s.action), backupBusy = useBackupStore(s => s.state?.status === 'running'), restoring = useRestoreBusy()
  const ready = !!window.desktop && !!target.id && deviceId === target.id && activeDeviceId === target.id && userId === target.userId && status === 'ready' && devices.some(d => d.id === target.id && d.status === 'connected') && action?.status !== 'running' && !backupBusy && !restoring && badgeRead?.status !== 'running'
  async function prepare() {
    if (!ready) return
    setPreparing(true); setError('')
    try {
      const reply = await window.desktop!.request({ type: 'apps.prepareScan', id: target.id!, userId: target.userId!, packageName: target.app.packageName, url: target.url })
      if (reply.snapshot.appAction) useAppActionsStore.setState({ action: reply.snapshot.appAction })
      if (!reply.ok) throw new Error(reply.error)
      if (reply.scanPreparation) setResult(reply.scanPreparation)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setPreparing(false) }
  }
  const openSite = () => void requestBackend({ type: 'web.open', url: target.url })
  return <BadgeDialog title={t("Check with {0}", [target.service.name])} close={close} className="scan-preparation-dialog">
    <p><strong>{target.app.label}</strong><br /><code>{target.app.packageName}</code></p>
    <p className="scan-intro">{t("Save the installed APK files, then choose and upload them on the website. ADB Vault does not submit files. App data and cache are not copied.")}</p>
    {target.app.splitCount !== 0 && <p className="apps-filter-help">{t("Split applications contain a main APK and separate parts. All installed parts will be saved; scanning only the main APK does not check the complete application.")}</p>}
    <p className="apps-filter-help">{t("The service may share submitted files. Review its terms before uploading.")}</p>
    {target.app.installed === false && <p className="apps-filter-help">{t("Restore this application to the profile before preparing its installed APK files.")}</p>}
    {!result && <button className="button primary" disabled={!ready || preparing || target.app.installed === false} onClick={() => void prepare()}><Download size={14} />{t("Prepare APK files & open website")}</button>}
    {!ready && !preparing && !result && <p className="apps-filter-help">{t("Connect the original device/profile and finish any current operation to prepare files.")}</p>}
    {preparing && <div className="scan-progress" role="status"><progress aria-label={t("Preparing APK files")} /><p>{action?.message || t("Preparing APK files…")}</p><button className="button secondary" onClick={() => void requestBackend({ type: 'apps.cancelAction' })}><X size={14} />{t("Cancel preparation")}</button></div>}
    {error && <p className="operation-error" role="alert">{message(error)}</p>}
    {result && <div className="scan-prepared"><strong>{t("Prepared locally · Not uploaded")}</strong><code>{result.directory}</code>{result.message && <p role="alert">{message(result.message)}</p>}<ul>{result.files.map(file => <li key={file.file}><span>{file.file}<small>{file.file === target.app.packageName + '.apk' ? t("Main APK") : t("Split APK")}</small></span><button className="icon-button" aria-label={t("Copy SHA-256 of {0}", [file.file])} title={t("Copy SHA-256")} onClick={() => void copyText(file.sha256).then(() => useAppStore.getState().notify("Copied"), () => setError("Could not copy the hash."))}><Copy size={14} /></button></li>)}</ul>{action?.exportPath === result.directory && action.status === 'success' && <button className="button secondary" onClick={() => void requestBackend({ type: 'apps.openExport' })}><FolderOpen size={14} />{t("Open prepared folder")}</button>}</div>}
    <button className="button secondary" disabled={preparing} onClick={openSite}><ExternalLink size={14} />{t("Open website")}{result ? '' : t(" only")}</button>
  </BadgeDialog>
}
