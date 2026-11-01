export const appColumns = [
  { id: 'label', label: "Application", width: 240, visible: true },
  { id: 'packageName', label: "Package name", width: 240, visible: false },
  { id: 'versionName', label: "Version", width: 105, visible: true },
  { id: 'versionCode', label: "Version code", width: 105, visible: false },
  { id: 'apkSizeBytes', label: "APK size", width: 100, visible: true },
  { id: 'packaging', label: "Package layout", width: 120, visible: true },
  { id: 'kind', label: "Type", width: 110, visible: true },
  { id: 'enabled', label: "Status", width: 120, visible: true },
  { id: 'debuggable', label: "Debuggable", width: 110, visible: false },
  { id: 'dataBytes', label: "Data (includes cache)", width: 140, visible: false },
  { id: 'dataWithoutCache', label: "Data (excludes cache)", width: 150, visible: false },
  { id: 'cacheBytes', label: "Cache", width: 110, visible: false },
  { id: 'firstInstallTime', label: "Installation date", width: 175, visible: false },
  { id: 'lastUpdateTime', label: "Last update date", width: 175, visible: false },
  { id: 'targetSdk', label: "Target SDK", width: 95, visible: false },
  { id: 'minSdk', label: "Minimum SDK", width: 105, visible: false },
  { id: 'installer', label: "Installer", width: 200, visible: false },
  { id: 'uid', label: "UID", width: 95, visible: false },
] as const
export type AppColumnId = typeof appColumns[number]['id']
export const defaultAppVisibility = (): Record<string, boolean> => Object.fromEntries(appColumns.map(c => [c.id, c.visible]))
