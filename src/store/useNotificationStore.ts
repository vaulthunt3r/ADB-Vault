import { create } from 'zustand'
import { notificationSettings, defaultNotificationSettings, type NotificationSettings } from '../../electron/notifications-protocol'

export const useNotificationStore = create<{ settings: NotificationSettings; receive: (value: unknown) => void }>(set => ({
  settings: defaultNotificationSettings(),
  receive: value => set({ settings: notificationSettings(value) }),
}))
