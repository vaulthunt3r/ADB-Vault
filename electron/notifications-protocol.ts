export const notificationEvents = [
  { id: 'apps-reading', group: 'Apps', label: 'Reading apps started', description: 'A new application collection starts.', category: 'completed', enabled: false },
  { id: 'apps-loaded', group: 'Apps', label: 'Reading apps finished', description: 'The application list for a profile is ready.', category: 'completed', enabled: true },
  { id: 'apps-scanned', group: 'Apps', label: 'Badge collection finished', description: 'The batch application badge scan is complete.', category: 'completed', enabled: true },
  { id: 'apps-apk-scan', group: 'Apps', label: 'Scan APKs finished', description: 'APK analysis for the selected application is complete.', category: 'completed', enabled: false },
  { id: 'apps-backup', group: 'Apps', label: 'Backup finished', description: 'One result for the whole backup batch.', category: 'completed', enabled: true },
  { id: 'apps-preset', group: 'Apps', label: 'Preset saved', description: 'The application preset has been exported.', category: 'completed', enabled: true },
  { id: 'apps-install', group: 'Apps', label: 'Installation finished', description: 'The APK / APKS installation or installation batch is complete.', category: 'completed', enabled: true },
  { id: 'apps-restore', group: 'Apps', label: 'Restore finished', description: 'The restore operation or restore batch is complete.', category: 'completed', enabled: true },
  { id: 'apps-action', group: 'Apps', label: 'Application action finished', description: 'Export, uninstall, enable / disable, permission changes and other application actions.', category: 'completed', enabled: true },
  { id: 'apps-error', group: 'Apps', label: 'Application operation errors', description: 'Failed or partially completed collection, scan, backup, installation, restore or app action.', category: 'problems', enabled: true },
  { id: 'file-copy', group: 'Files', label: 'Copy finished', description: 'The entire copy task is complete.', category: 'completed', enabled: true },
  { id: 'file-move', group: 'Files', label: 'Move finished', description: 'The entire move task is complete.', category: 'completed', enabled: true },
  { id: 'file-delete', group: 'Files', label: 'Delete finished', description: 'The entire delete task is complete.', category: 'completed', enabled: true },
  { id: 'file-change', group: 'Files', label: 'Other file changes finished', description: 'Rename, create a file / folder or change permissions.', category: 'completed', enabled: true },
  { id: 'file-search', group: 'Files', label: 'Search finished', description: 'A file search or category scan is complete.', category: 'completed', enabled: true },
  { id: 'file-index', group: 'Files', label: 'Index finished', description: 'The file search index has been built.', category: 'completed', enabled: true },
  { id: 'file-conflict', group: 'Files', label: 'File conflict needs a decision', description: 'A destination name already exists; the task is waiting for your choice.', category: 'problems', enabled: true },
  { id: 'file-error', group: 'Files', label: 'File operation errors', description: 'Failed or partially completed file tasks, searches or indexing.', category: 'problems', enabled: true },
  { id: 'device-connected', group: 'Connection', label: 'Device connected / reconnected', description: 'A device becomes connected. The initial device list is silent.', category: 'completed', enabled: false },
  { id: 'device-disconnected', group: 'Connection', label: 'Device disconnected', description: 'A connected device disappears, goes offline or becomes unauthorized.', category: 'disconnected', enabled: true },
  { id: 'component-ready', group: 'Components', label: 'Component installation finished', description: 'A component or database download / installation is complete. Routine checks are silent.', category: 'completed', enabled: true },
  { id: 'component-error', group: 'Components', label: 'Component installation errors', description: 'A download or installation failed or needs attention.', category: 'problems', enabled: true },
  { id: 'diagnostic-logcat', group: 'Diagnostics', label: 'Android log ready', description: 'Logcat collection has finished.', category: 'completed', enabled: true },
  { id: 'diagnostic-bugreport', group: 'Diagnostics', label: 'Bug report ready', description: 'The diagnostic report is ready.', category: 'completed', enabled: true },
  { id: 'diagnostic-battery', group: 'Diagnostics', label: 'Battery report ready', description: 'Application battery usage has been collected.', category: 'completed', enabled: true },
  { id: 'diagnostic-error', group: 'Diagnostics', label: 'Android diagnostic errors', description: 'Logcat, bug report or battery collection failed.', category: 'problems', enabled: true },
] as const
export type NotificationEventId = typeof notificationEvents[number]['id']
export interface NotificationChannels { desktop: boolean; sound: boolean }
export interface NotificationSettings extends NotificationChannels {
  backgroundOnly: boolean
  events: Record<NotificationEventId, NotificationChannels>
}
export const defaultNotificationSettings = (): NotificationSettings => ({
  desktop: true, sound: true, backgroundOnly: false,
  events: Object.fromEntries(notificationEvents.map(event => [event.id, { desktop: event.enabled, sound: event.enabled }])) as NotificationSettings['events'],
})
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
export function notificationSettings(value: unknown): NotificationSettings {
  const settings = defaultNotificationSettings()
  if (!record(value)) return settings
  for (const key of ['desktop', 'sound', 'backgroundOnly'] as const) if (typeof value[key] === 'boolean') settings[key] = value[key]
  for (const event of notificationEvents) {
    // Migrate the original three event switches without re-enabling muted categories.
    if (value[event.category] === false) settings.events[event.id] = { desktop: false, sound: false }
    const saved = record(value.events) ? value.events[event.id] : undefined
    if (record(saved)) for (const channel of ['desktop', 'sound'] as const) if (typeof saved[channel] === 'boolean') settings.events[event.id][channel] = saved[channel]
  }
  return settings
}
export function validateNotificationSettings(value: unknown): NotificationSettings {
  if (!record(value) || Object.keys(value).length !== 4
    || ['desktop', 'sound', 'backgroundOnly'].some(key => typeof value[key] !== 'boolean')
    || !record(value.events) || Object.keys(value.events).length !== notificationEvents.length) throw new Error('Invalid notification settings.')
  for (const event of notificationEvents) {
    const channels = value.events[event.id]
    if (!record(channels) || Object.keys(channels).length !== 2 || typeof channels.desktop !== 'boolean' || typeof channels.sound !== 'boolean') throw new Error('Invalid notification event settings.')
  }
  return notificationSettings(value)
}
export function notificationChannels(settings: NotificationSettings, event: NotificationEventId): NotificationChannels {
  return { desktop: settings.desktop && settings.events[event].desktop, sound: settings.sound && settings.events[event].sound }
}
export type NotificationDestination = 'activity' | 'apps' | 'files' | 'connection' | 'components' | 'monitor' | 'settings'
export interface OperationAlert {
  event: NotificationEventId
  title: string
  body: string
  destination: NotificationDestination
  taskPanel?: boolean
  category: 'completed' | 'problems' | 'disconnected'
}
