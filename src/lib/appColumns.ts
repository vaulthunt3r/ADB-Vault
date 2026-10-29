import { t } from "./i18n"
export const appColumns = [
  { id: 'label', get label() { return t("Application") }, width: 240, visible: true },
  { id: 'packageName', get label() { return t("Package name") }, width: 240, visible: false },
  { id: 'versionName', get label() { return t("Version") }, width: 105, visible: true },
  { id: 'versionCode', get label() { return t("Version code") }, width: 105, visible: false },
  { id: 'apkSizeBytes', get label() { return t("APK size") }, width: 100, visible: true },
  { id: 'packaging', get label() { return t("Package layout") }, width: 120, visible: true },
  { id: 'kind', get label() { return t("Type") }, width: 110, visible: true },
  { id: 'enabled', get label() { return t("Status") }, width: 120, visible: true },
  { id: 'debuggable', get label() { return t("Debuggable") }, width: 110, visible: false },
  { id: 'dataBytes', get label() { return t("Data (includes cache)") }, width: 140, visible: false },
  { id: 'dataWithoutCache', get label() { return t("Data (excludes cache)") }, width: 150, visible: false },
  { id: 'cacheBytes', get label() { return t("Cache") }, width: 110, visible: false },
  { id: 'firstInstallTime', get label() { return t("Installation date") }, width: 175, visible: false },
  { id: 'lastUpdateTime', get label() { return t("Last update date") }, width: 175, visible: false },
  { id: 'targetSdk', get label() { return t("Target SDK") }, width: 95, visible: false },
  { id: 'minSdk', get label() { return t("Minimum SDK") }, width: 105, visible: false },
  { id: 'installer', get label() { return t("Installer") }, width: 200, visible: false },
  { id: 'uid', get label() { return t("UID") }, width: 95, visible: false },
] as const
export type AppColumnId = typeof appColumns[number]['id']
export const defaultAppVisibility = (): Record<string, boolean> => Object.fromEntries(appColumns.map(c => [c.id, c.visible]))
