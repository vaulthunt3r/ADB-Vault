import { t } from "./i18n"
export const toolbarActions = [
  { id: 'workspace', get label() { return t("Workspace action") }, get description() { return t("Check components, refresh installed applications or open a local APK in the current view.") } },
  { id: 'screenshot', get label() { return t("Screenshot") }, get description() { return t("Save the selected phone screen to this computer.") } },
  { id: 'mirror', get label() { return t("Mirror screen") }, get description() { return t("Open the selected phone in scrcpy.") } },
  { id: 'screenOptions', get label() { return t("Screen & recording") }, get description() { return t("Choose capture mode, sound and recording options.") } },
  { id: 'virtualDisplay', get label() { return t("Virtual display") }, get description() { return t("Choose an application for a separate Android window.") } },
  { id: 'openWindows', get label() { return t("Open windows") }, get description() { return t("Show running windows, touch controls and recording controls.") } },
  { id: 'camera', get label() { return t("Camera") }, get description() { return t("Choose a phone camera and preview or recording options.") } },
  { id: 'cameraControls', get label() { return t("Camera controls") }, get description() { return t("Show live controls for the selected phone’s running camera.") } },
  { id: 'wake', get label() { return t("Wake screen") }, get description() { return t("Wake the selected phone’s screen.") } },
  { id: 'sleep', get label() { return t("Sleep screen") }, get description() { return t("Put the selected phone’s screen to sleep.") } },
  { id: 'logcat', get label() { return t("Android logs") }, get description() { return t("Open Logcat for the selected phone.") } },
  { id: 'bugreport', get label() { return t("Bug report") }, get description() { return t("Open diagnostic report options for the selected phone.") } },
  { id: 'tasks', get label() { return t("File tasks") }, get description() { return t("Open the current file operation queue.") } },
  { id: 'activity', get label() { return t("Activity") }, get description() { return t("Open the current session history.") } },
  { id: 'connection', get label() { return t("Connection") }, get description() { return t("Open device connections.") } },
  { id: 'restart', get label() { return t("Restart") }, get description() { return t("Choose Android, Recovery, Bootloader or Fastbootd, then confirm the restart.") } },
  { id: 'powerOff', get label() { return t("Power off") }, get description() { return t("Shut down the selected phone after confirmation. Turn it back on manually.") } },
  { id: 'clipboard', get label() { return t("Clipboard") }, get description() { return t("Transfer text between the computer and phone, or create a local QR code.") } },
  { id: 'contacts', get label() { return t("Export contacts") }, get description() { return t("Preview and select contacts, then save them as VCF or CSV.") } },
  { id: 'calls', get label() { return t("Export call log") }, get description() { return t("Preview call history, filter by date and save selected entries as CSV or JSON.") } },
  { id: 'sms', get label() { return t("Export SMS") }, get description() { return t("Preview messages, filter by date and save selected SMS as JSON or HTML.") } },
  { id: 'root', get label() { return t("Check root access") }, get description() { return t("Check existing ADB or su access. This does not root the phone.") } },
  { id: 'deviceInfo', get label() { return t("Refresh device information") }, get description() { return t("Read hardware, Android build, radio and boot properties again.") } },
  { id: 'reconnect', get label() { return t("Reconnect device") }, get description() { return t("Retry the selected phone’s ADB connection.") } },
  { id: 'disconnect', get label() { return t("Disconnect device") }, get description() { return t("Disconnect the selected device from ADB. USB detaching depends on the backend.") } },
  { id: 'findDevices', get label() { return t("Find devices") }, get description() { return t("Scan for ADB devices and update the connection list.") } },
  { id: 'fastboot', get label() { return t("Find Fastboot devices") }, get description() { return t("Search USB devices already in Fastboot mode.") } },
  { id: 'localApks', get label() { return t("Local APKs") }, get description() { return t("Inspect one APK or compare two versions on this computer. No phone required.") } },
  { id: 'install', get label() { return t("Install") }, get description() { return t("Choose APK/APKS files to install into the selected Android profile.") } },
  { id: 'backup', get label() { return t("Backup") }, get description() { return t("Open backup options for checked applications, or import a selection preset.") } },
  { id: 'restore', get label() { return t("Restore application") }, get description() { return t("Open a saved application backup and review restore options for this profile.") } },
] as const
export type ToolbarActionId = typeof toolbarActions[number]['id']
export const toolbarGroups = [
  { get label() { return t("Workspace & navigation") }, actions: ['workspace', 'tasks', 'activity', 'connection'] },
  { get label() { return t("Screen & camera") }, actions: ['screenshot', 'mirror', 'screenOptions', 'virtualDisplay', 'openWindows', 'camera', 'cameraControls', 'wake', 'sleep'] },
  { get label() { return t("Diagnostics") }, actions: ['logcat', 'bugreport'] },
  { get label() { return t("Device & connection") }, actions: ['restart', 'powerOff', 'root', 'deviceInfo', 'reconnect', 'disconnect', 'findDevices', 'fastboot'] },
  { get label() { return t("Phone tools") }, actions: ['clipboard', 'contacts', 'calls', 'sms'] },
  { get label() { return t("Applications") }, actions: ['localApks', 'install', 'backup', 'restore'] },
] satisfies { label: string; actions: ToolbarActionId[] }[]
export const toolbarWorkspaces = [
  { id: 'components', get label() { return t("Components") } }, { id: 'connection', get label() { return t("Connection") } },
  { id: 'apps', get label() { return t("Apps") } }, { id: 'files', get label() { return t("Files") } },
  { id: 'monitor', get label() { return t("Monitor") } }, { id: 'activity', get label() { return t("Activity") } }, { id: 'console', get label() { return t("Console") } }, { id: 'settings', get label() { return t("Settings") } },
] as const
export type ToolbarWorkspace = typeof toolbarWorkspaces[number]['id']
export type ToolbarScope = 'shared' | ToolbarWorkspace
export interface ToolbarConfig { pinned: ToolbarActionId[]; operationPosition: 'start' | 'end'; showDevice: boolean }
export function toolbarConfig(state: ToolbarConfig & { overrides: Partial<Record<ToolbarWorkspace, ToolbarConfig>> }, scope: ToolbarScope): ToolbarConfig {
  return scope === 'shared' ? state : state.overrides[scope] ?? state
}
export const defaultToolbarActions: ToolbarActionId[] = ['workspace', 'screenshot']
export const toolbarActionIds = toolbarActions.map(action => action.id)

export function normalizeToolbarActions(value: unknown): ToolbarActionId[] {
  return Array.isArray(value)
    ? [...new Set(value)].filter((id): id is ToolbarActionId => toolbarActionIds.includes(id as ToolbarActionId))
    : [...defaultToolbarActions]
}

// Keep a prefix, rather than filling gaps with later, narrower actions.
export function fittingToolbarActions(widths: number[], available: number, gap: number): number {
  let used = 0, count = 0
  for (const width of widths) {
    const next = used + width + (count ? gap : 0)
    if (next > available) break
    used = next; count++
  }
  return count
}
