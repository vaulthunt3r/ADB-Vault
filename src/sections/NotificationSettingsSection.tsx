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
    <label className={settings[key] ? 'chosen' : ''} key={key}><input type="checkbox" checked={settings[key]} onChange={event => void save({ ...settings, [key]: event.target.checked })} /><span><strong>{title}</strong><small>{description}</small></span></label>
  return <section className="section-content" aria-labelledby="notifications-settings-title">
    <div className="section-heading"><div><div className="eyebrow section-eyebrow">SETTINGS / NOTIFICATIONS</div><h1 id="notifications-settings-title">Notifications</h1><p>Choose how ADB Vault reports results while it is running.</p></div></div>
    <fieldset className="apps-loading-settings" disabled={busy || !window.desktop}><legend>Delivery</legend>
      {option('desktop', "Desktop notifications", "Show native Windows notifications. Click an alert to return to the relevant workspace.")}
      {option('sound', "Sound alerts", "Play a system sound. Works independently of desktop notifications.")}
      {option('backgroundOnly', "Only when ADB Vault is in the background", "Suppress both sounds and desktop alerts while this window is active. The test button always uses the selected delivery options.")}
    </fieldset>
    <p className="apps-settings-note">Choose sound and desktop alerts separately for each event. The delivery switches above mute an entire channel without resetting your choices below. Error events are independent of successful results.</p>
    <table className="notification-events-table" aria-label="Notification events">
      <thead><tr><th scope="col">Event</th><th scope="col">Sound</th><th scope="col">Desktop</th></tr></thead>
      {[...new Set(notificationEvents.map(event => event.group))].map(group => <tbody key={group}>
        <tr><th scope="rowgroup" colSpan={3} className="notification-event-group">{group}</th></tr>
        {notificationEvents.filter(event => event.group === group).map(event => <tr key={event.id}>
          <th scope="row"><strong>{event.label}</strong><small>{event.description}</small></th>
          {(['sound', 'desktop'] as const).map(channel => <td key={channel}><input type="checkbox" aria-label={`${event.label}: ${channel === 'sound' ? 'Sound' : 'Desktop'}`} checked={settings.events[event.id][channel]} disabled={busy || !window.desktop || !settings[channel]}
            onChange={e => void save({ ...settings, events: { ...settings.events, [event.id]: { ...settings.events[event.id], [channel]: e.target.checked } } })} /></td>)}
        </tr>)}
      </tbody>)}
    </table>
    <button className="button secondary" disabled={busy || !window.desktop || !settings.desktop && !settings.sound} onClick={async () => {
      setBusy(true); setError(''); setTested(false)
      try { setTested(await requestBackend({ type: 'notifications.test' }, setError)) } finally { setBusy(false) }
    }}>Test notification</button>
    {error && <p role="alert">{error}</p>}
    {tested && <p role="status">Test sent using your current settings. Windows may place it in Notification Center without showing a banner.</p>}
    <p className="apps-settings-note">{busy ? "Applying…" : "Settings are saved automatically."}{" Windows notification permissions, Do not disturb / Focus assist, and system volume also apply. Previous sessions and cancelled tasks do not produce alerts."}</p>
  </section>
}
