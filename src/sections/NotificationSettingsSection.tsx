import { t as translateUi } from '../lib/i18n'
import { message } from "../lib/i18n"
import { t } from "../lib/i18n"
import { useState } from 'react'
import { useNotificationStore } from '../store/useNotificationStore'
import { requestBackend } from '../lib/backend'
import { notificationEvents, type NotificationSettings, type NotificationChannels } from '../../electron/notifications-protocol'

export function NotificationSettingsSection() {
  const settings = useNotificationStore(s => s.settings)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [tested, setTested] = useState(false)
  const save = async (updated: NotificationSettings) => {
    setBusy(true); setError(''); setTested(false)
    try { await requestBackend({ type: 'settings.notifications', settings: updated }, setError) }
    finally { setBusy(false) }
  }
  const option = (key: keyof NotificationChannels | 'backgroundOnly', title: string, description: string) =>
    <label className={settings[key] ? 'chosen' : ''} key={key}><input type="checkbox" checked={settings[key]} onChange={event => void save({ ...settings, [key]: event.target.checked })} /><span><strong>{t(title)}</strong><small>{t(description)}</small></span></label>
  return <section className="section-content" aria-labelledby="notifications-settings-title">
    <div className="section-heading"><div><div className="eyebrow section-eyebrow">{t("SETTINGS / NOTIFICATIONS")}</div><h1 id="notifications-settings-title">{t("Notifications")}</h1><p>{t("Choose how ADB Vault reports results while it is running.")}</p></div></div>
    <fieldset className="apps-loading-settings" disabled={busy || !window.desktop}><legend>{t("Delivery")}</legend>
      {option('desktop', translateUi("Desktop notifications"), translateUi("Show native Windows notifications. Click an alert to return to the relevant workspace."))}
      {option('sound', translateUi("Sound alerts"), translateUi("Play a system sound. Works independently of desktop notifications."))}
      {option('backgroundOnly', translateUi("Only when ADB Vault is in the background"), translateUi("Suppress both sounds and desktop alerts while this window is active. The test button always uses the selected delivery options."))}
    </fieldset>
    <p className="apps-settings-note">{t("Choose sound and desktop alerts separately for each event. The delivery switches above mute an entire channel without resetting your choices below. Error events are independent of successful results.")}</p>
    <table className="notification-events-table" aria-label={t("Notification events")}>
      <thead><tr><th scope="col">{t("Event")}</th><th scope="col">{t("Sound")}</th><th scope="col">{t("Desktop")}</th></tr></thead>
      {[...new Set(notificationEvents.map(event => event.group))].map(group => <tbody key={group}>
        <tr><th scope="rowgroup" colSpan={3} className="notification-event-group">{t(group)}</th></tr>
        {notificationEvents.filter(event => event.group === group).map(event => <tr key={event.id}>
          <th scope="row"><strong>{t(event.label)}</strong><small>{message(event.description)}</small></th>
          {(['sound', 'desktop'] as const).map(channel => <td key={channel}><input type="checkbox" aria-label={`${t(event.label)}: ${t(channel === 'sound' ? 'Sound' : 'Desktop')}`} checked={settings.events[event.id][channel]} disabled={busy || !window.desktop || !settings[channel]}
            onChange={e => void save({ ...settings, events: { ...settings.events, [event.id]: { ...settings.events[event.id], [channel]: e.target.checked } } })} /></td>)}
        </tr>)}
      </tbody>)}
    </table>
    <button className="button secondary" disabled={busy || !window.desktop || !settings.desktop && !settings.sound} onClick={async () => {
      setBusy(true); setError(''); setTested(false)
      try { setTested(await requestBackend({ type: 'notifications.test' }, setError)) } finally { setBusy(false) }
    }}>{t("Test notification")}</button>
    {error && <p role="alert">{message(error)}</p>}
    {tested && <p role="status">{t("Test sent using your current settings. Windows may place it in Notification Center without showing a banner.")}</p>}
    <p className="apps-settings-note">{busy ? t("Applying…") : t("Settings are saved automatically.")}{t(" Windows notification permissions, Do not disturb / Focus assist, and system volume also apply. Previous sessions and cancelled tasks do not produce alerts.")}</p>
  </section>
}
