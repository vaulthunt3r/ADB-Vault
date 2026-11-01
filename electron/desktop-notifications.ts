import type { Notification } from 'electron'
import { notificationChannels, type NotificationChannels, type NotificationDestination, type NotificationSettings, type OperationAlert } from './notifications-protocol.js'

export interface NotificationSystem {
  isSupported(): boolean
  create(options: Electron.NotificationConstructorOptions): Notification
  beep(): void
}

export class DesktopNotifications {
  private active = new Set<Notification>()
  private stopped = false
  constructor(private settings: () => NotificationSettings, private navigate: (destination: NotificationDestination, taskPanel?: boolean) => void, private system: NotificationSystem) {}
  async show(alert: OperationAlert, delivery = notificationChannels(this.settings(), alert.event)): Promise<void> {
    if (this.stopped) return
    const preferences = this.settings()
    const settings: NotificationChannels = { desktop: preferences.desktop && delivery.desktop, sound: preferences.sound && delivery.sound }
    if (!settings.desktop) { if (settings.sound) this.system.beep(); return }
    if (!this.system.isSupported()) {
      if (settings.sound) this.system.beep()
      throw new Error('Desktop notifications are unavailable on this system.')
    }
    const notification = this.system.create({ title: `ADB Vault · ${alert.title}`, body: alert.body.slice(0, 500), silent: !settings.sound })
    this.active.add(notification)
    while (this.active.size > 40) { const oldest = this.active.values().next().value!; oldest.close(); this.active.delete(oldest) }
    notification.on('click', () => { if (!this.stopped) this.navigate(alert.destination, alert.taskPanel) })
    notification.once('close', () => this.active.delete(notification))
    // The OS plays the sound for a toast. Do not also beep and produce a double alert.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error('Windows did not confirm the notification. Check Windows notification settings and try again.')) }, 8000)
      notification.once('show', () => { clearTimeout(timer); resolve() })
      notification.once('failed', (_event, error) => { clearTimeout(timer); this.active.delete(notification); reject(new Error(`Windows notification failed: ${error}`)) })
      try { notification.show() } catch (error) { clearTimeout(timer); this.active.delete(notification); reject(error) }
    })
  }
  async test() {
    const settings = this.settings()
    if (!settings.desktop && !settings.sound) throw new Error('Enable desktop notifications or sounds first.')
    await this.show({ event: 'apps-loaded', title: 'Test notification', body: 'Your notification settings are working. Click to return to Settings.', destination: 'settings', category: 'completed' }, settings)
  }
  stop() { this.stopped = true; for (const notification of this.active) notification.close(); this.active.clear() }
}
