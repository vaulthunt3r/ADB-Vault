export const toolbarActions = [
  { id: 'workspace', label: "Workspace action", description: "Check components, refresh installed applications or open a local APK in the current view." },
  { id: 'screenshot', label: "Screenshot", description: "Save the selected phone screen to this computer." },
  { id: 'mirror', label: "Mirror screen", description: "Open the selected phone in scrcpy." },
  { id: 'screenOptions', label: "Screen & recording", description: "Choose capture mode, sound and recording options." },
  { id: 'virtualDisplay', label: "Virtual display", description: "Choose an application for a separate Android window." },
  { id: 'openWindows', label: "Open windows", description: "Show running windows, touch controls and recording controls." },
  { id: 'camera', label: "Camera", description: "Choose a phone camera and preview or recording options." },
  { id: 'cameraControls', label: "Camera controls", description: "Show live controls for the selected phone’s running camera." },
  { id: 'wake', label: "Wake screen", description: "Wake the selected phone’s screen." },
  { id: 'sleep', label: "Sleep screen", description: "Put the selected phone’s screen to sleep." },
  { id: 'logcat', label: "Android logs", description: "Open Logcat for the selected phone." },
  { id: 'bugreport', label: "Bug report", description: "Open diagnostic report options for the selected phone." },
  { id: 'tasks', label: "File tasks", description: "Open the current file operation queue." },
  { id: 'activity', label: "Activity", description: "Open the current session history." },
  { id: 'connection', label: "Connection", description: "Open device connections." },
  { id: 'restart', label: "Restart", description: "Choose Android, Recovery, Bootloader or Fastbootd, then confirm the restart." },
  { id: 'powerOff', label: "Power off", description: "Shut down the selected phone after confirmation. Turn it back on manually." },
  { id: 'clipboard', label: "Clipboard", description: "Transfer text between the computer and phone, or create a local QR code." },
  { id: 'contacts', label: "Export contacts", description: "Preview and select contacts, then save them as VCF or CSV." },
  { id: 'calls', label: "Export call log", description: "Preview call history, filter by date and save selected entries as CSV or JSON." },
  { id: 'sms', label: "Export SMS", description: "Preview messages, filter by date and save selected SMS as JSON or HTML." },
  { id: 'root', label: "Check root access", description: "Check existing ADB or su access. This does not root the phone." },
  { id: 'deviceInfo', label: "Refresh device information", description: "Read hardware, Android build, radio and boot properties again." },
  { id: 'reconnect', label: "Reconnect device", description: "Retry the selected phone’s ADB connection." },
  { id: 'disconnect', label: "Disconnect device", description: "Disconnect the selected device from ADB. USB detaching depends on the backend." },
  { id: 'findDevices', label: "Find devices", description: "Scan for ADB devices and update the connection list." },
  { id: 'fastboot', label: "Find Fastboot devices", description: "Search USB devices already in Fastboot mode." },
  { id: 'localApks', label: "Local APKs", description: "Inspect one APK or compare two versions on this computer. No phone required." },
  { id: 'install', label: "Install", description: "Choose APK/APKS files to install into the selected Android profile." },
  { id: 'backup', label: "Backup", description: "Open backup options for checked applications, or import a selection preset." },
  { id: 'restore', label: "Restore application", description: "Open a saved application backup and review restore options for this profile." },
] as const
export type ToolbarActionId = typeof toolbarActions[number]['id']
export const toolbarGroups = [
  { label: "Workspace & navigation", actions: ['workspace', 'tasks', 'activity', 'connection'] },
  { label: "Screen & camera", actions: ['screenshot', 'mirror', 'screenOptions', 'virtualDisplay', 'openWindows', 'camera', 'cameraControls', 'wake', 'sleep'] },
  { label: "Diagnostics", actions: ['logcat', 'bugreport'] },
  { label: "Device & connection", actions: ['restart', 'powerOff', 'root', 'deviceInfo', 'reconnect', 'disconnect', 'findDevices', 'fastboot'] },
  { label: "Phone tools", actions: ['clipboard', 'contacts', 'calls', 'sms'] },
  { label: "Applications", actions: ['localApks', 'install', 'backup', 'restore'] },
] satisfies { label: string; actions: ToolbarActionId[] }[]
export const toolbarWorkspaces = [
  { id: 'components', label: "Components" }, { id: 'connection', label: "Connection" },
  { id: 'apps', label: "Apps" }, { id: 'files', label: "Files" },
  { id: 'monitor', label: "Monitor" }, { id: 'activity', label: "Activity" }, { id: 'console', label: "Console" }, { id: 'settings', label: "Settings" },
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
