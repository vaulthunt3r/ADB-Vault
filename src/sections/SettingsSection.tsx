import { ScreenSettings } from '../components/ScreenControls'
import { NotificationSettingsSection } from './NotificationSettingsSection'
import { FileCategorySettings } from './FileCategorySettings'
import { WebServicesSettings } from './WebServicesSettings'
import { useState } from 'react'
import { BadgeSettingsSection } from './BadgeSettingsSection'
import { AppearanceSection } from './AppearanceSection'
import { WorkspaceSettings } from './WorkspaceSettings'
import { useAppStore } from '../store/useAppStore'
import { useAppsStore } from '../store/useAppsStore'
import { useBackupStore } from '../store/useBackupStore'
import { useAppActionsStore } from '../store/useAppActionsStore'
import { requestBackend } from '../lib/backend'
export function ConnectionSettings() {
  const enabled = useAppStore(s => s.stopAdbOnExit)
  const [saving, setSaving] = useState(false)
  return <section className="section-content" aria-labelledby="connection-settings-title">
    <div className="section-heading"><div><div className="eyebrow section-eyebrow">SETTINGS / CONNECTION</div><h1 id="connection-settings-title">ADB lifecycle</h1><p>Choose what happens to ADB when you exit ADB Vault.</p></div></div>
    <fieldset className="apps-loading-settings" disabled={saving || !window.desktop}><legend>On exit</legend>
      <label className={enabled ? 'chosen' : ''}><input type="checkbox" checked={enabled} onChange={async event => {
        setSaving(true)
        try { await requestBackend({ type: 'settings.stopAdbOnExit', enabled: event.target.checked }) } finally { setSaving(false) }
      }} /><span><strong>Stop ADB server on exit</strong><small>Stop active ADB operations, then shut down the ADB server when ADB Vault closes. Minimizing the window keeps it running. The server is shared: this also disconnects Android Studio and other tools using the same server.</small></span></label>
    </fieldset>
    <p className="apps-settings-note">{saving ? "Saving…" : "Your choice is saved automatically."}{" Enabled by default. Turn this off to keep ADB available to other tools after closing ADB Vault."}</p>
  </section>
}
export function AppsLoadingSettings() {
  const mode = useAppsStore(s => s.loadingMode)
  const options = useAppsStore(s => s.options)
  const [saving, setSaving] = useState(false)
  return <section className="section-content" aria-labelledby="apps-settings-title"><div className="section-heading"><div><div className="eyebrow section-eyebrow">SETTINGS / APPS</div><h1 id="apps-settings-title">Applications</h1><p>Choose how to load application information and where to export files.</p></div></div>
    <ExportDestinationSettings />
    <ApkTransferSettings />
    <fieldset className="apps-loading-settings" disabled={saving || !window.desktop}><legend>Data collection</legend>
      {([
        { id: 'icons', title: "Load application icons", text: "Turn this off to read application information without extracting or transferring icons from the device." },
        { id: 'early', title: "Load Apps on connection", text: "Read the active device before you open Apps. When off, reading starts on your first visit to Apps. Enabling this also applies to an already connected device." },
        { id: 'storage', title: "Collect data and cache sizes", text: "Adds data and cache sizes to Details. Collection may take longer. If Android denies access, the size is shown as Unavailable, not zero. The raw Data value includes Cache." },
        { id: 'root', title: "Use root for additional app details", text: "Read SSAID, KeyStore metadata, Magisk DenyList and Systemless, and retry restricted Hidden/SAF checks. Runs only when reading Details; approve Shell in your root manager. No keys or settings are changed. After a denied request, turn this off and on to retry. Refresh details to apply." },
      ] as const).map(option => <label key={option.id} className={options[option.id] ? 'chosen' : ''}><input type="checkbox" checked={!!options[option.id]} onChange={async event => { const next = { ...options, [option.id]: event.target.checked }; setSaving(true); try { await requestBackend({ type: 'apps.options', options: next }) } finally { setSaving(false) } }} /><span><strong>{option.title}</strong><small>{option.text}</small></span></label>)}
    </fieldset>
    <fieldset className="apps-loading-settings" disabled={saving || !window.desktop}><legend>Profile loading mode</legend>
      {([{ id: 'selected', title: "Selected profile only", text: "Other profiles load when selected. Reduces background work and data transfer." }, { id: 'preload', title: "Preload other profiles", text: "Show the selected profile first, then load the others in the background, one at a time. Switch to a prepared list without waiting." }] as const).map(option => <label key={option.id} className={mode === option.id ? 'chosen' : ''}><input type="radio" name="apps-loading-mode" value={option.id} checked={mode === option.id} onChange={async () => { setSaving(true); try { await requestBackend({ type: 'apps.loadingMode', mode: option.id }) } finally { setSaving(false) } }} /><span><strong>{option.title}</strong><small>{option.text}</small></span></label>)}
    </fieldset><p className="apps-settings-note">{saving ? "Saving…" : "Your choice is saved automatically."}{" Icon and size settings apply to the next collection; use Refresh in Apps to update the current list. Loaded lists remain available until the device disconnects, the active device changes, or the app closes. Refresh updates the selected profile."}</p><p className="apps-settings-note">If Apps is already loaded, enabling preloading starts it immediately. Turning it off stops background collection. Device profiles are not switched or unlocked automatically.</p>
  </section>
}
function ApkTransferSettings() {
  const enabled = useBackupStore(s => s.apkZstd)
  const backingUp = useBackupStore(s => s.state?.status === 'running')
  const acting = useAppActionsStore(s => s.action?.status === 'running')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return <div>
    <fieldset className="apps-loading-settings" disabled={saving || backingUp || acting || !window.desktop}><legend>APK transfer</legend>
      <label className={enabled ? 'chosen' : ''}><input type="checkbox" checked={enabled} onChange={async event => {
        setSaving(true); setError(null)
        try { await requestBackend({ type: 'settings.apkZstd', enabled: event.target.checked }, setError) } finally { setSaving(false) }
      }} /><span><strong>Faster Wi-Fi transfer — Zstd (experimental)</strong><small>Compress APK transfers for APK/APKS exports and backups. Uses normal copying when unsupported. Saved files and SHA-256 verification stay unchanged. USB uses normal copying.</small></span></label>
    </fieldset>
    {error && <p role="alert">{error}</p>}
    <p className="apps-settings-note">{saving ? "Saving…" : "Saved automatically. Applies to the next export; off by default."}</p>
  </div>
}
function ExportDestinationSettings() {
  const destination = useBackupStore(s => s.destination)
  const running = useBackupStore(s => s.state?.status === 'running')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function change(mode: 'ask' | 'fixed', choose = false) {
    setSaving(true); setError(null)
    try { await requestBackend(choose ? { type: 'settings.exportFolder' } : { type: 'settings.exportMode', mode }, setError) } finally { setSaving(false) }
  }
  return <div className="export-destination-settings">
    <fieldset className="apps-loading-settings" disabled={saving || running || !window.desktop}><legend>Export destination</legend>
      <label className={destination.mode === 'ask' ? 'chosen' : ''}><input type="radio" name="export-destination" checked={destination.mode === 'ask'} onChange={() => void change('ask')} /><span><strong>Ask every time</strong><small>Choose a destination folder for each APK, APKS or JSON preset export.</small></span></label>
      <label className={destination.mode === 'fixed' ? 'chosen' : ''}><input type="radio" name="export-destination" checked={destination.mode === 'fixed'} onChange={() => void change('fixed')} /><span><strong>Use a fixed folder</strong><small>Choose once and reuse it across exports and app restarts.</small></span></label>
    </fieldset>
    <div className="export-destination-folder"><code>{destination.folder || "No fixed folder selected"}</code><button className="button secondary" disabled={saving || running || !window.desktop} onClick={() => void change('fixed', true)}>{destination.folder ? "Change folder…" : "Choose folder…"}</button></div>
    {error && <p role="alert">{error}</p>}
    <p className="apps-settings-note">{saving ? "Saving…" : "Your choice is saved automatically."}{" Device folders are created inside this destination. If a fixed folder is unavailable, choose another here."}</p>
  </div>
}
export function SettingsSection() {
  const tab = useAppStore(s => s.settingsTab)
  const tabs = [['appearance', "Appearance"], ['workspaces', "Workspaces"], ['apps', "Apps"], ['files', "Files"], ['badges', "Badges"], ['connection', "Connection"], ['screen', "Screen & audio"], ['web-services', "Web services"], ['notifications', "Notifications"]] as const
  return <>
    <div className="settings-categories" role="group" aria-label="Settings categories">
      {tabs.map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} aria-pressed={tab === id} onClick={() => useAppStore.setState({ settingsTab: id })}>{label}</button>)}
    </div>
    <div className="settings-pane" key={tab}>
      {tab === 'workspaces' ? <WorkspaceSettings /> : tab === 'screen' ? <ScreenSettings /> : tab === 'notifications' ? <NotificationSettingsSection /> : tab === 'files' ? <FileCategorySettings /> : tab === 'web-services' ? <WebServicesSettings /> : tab === 'connection' ? <ConnectionSettings /> : tab === 'appearance' ? <AppearanceSection /> : tab === 'badges' ? <BadgeSettingsSection /> : <AppsLoadingSettings />}
    </div>
  </>
}
