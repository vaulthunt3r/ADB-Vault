export type ComponentId = 'adb' | 'fastboot' | 'driver' | 'runtime' | 'scrcpy' | 'geoip' | import('./database-protocol.js').DatabaseId
export type ComponentStatus = 'Not installed' | 'Detected' | 'Installed' | 'Package ready' | 'Update available' | 'Downloading' | 'Installing' | 'Checking' | 'Repair needed' | 'Not detected' | 'Version mismatch' | 'Download failed' | 'Install failed' | 'Blocked' | 'Manual action required'
export interface ComponentRecord {
  id: ComponentId; name: string; subtitle: string; description: string; publisher: string
  group: 'Core components' | 'Optional components' | 'Detection databases'; version: string; targetVersion: string; size: string
  status: ComponentStatus; location: string | null; progress: number; message?: string; sourceUrl?: string; managed?: boolean
}
export type DeviceStatus = 'connected' | 'disconnected' | 'unauthorized' | 'offline' | 'bootloader' | 'recovery' | 'sideload'
export interface RootCheck {
  status: 'checking' | 'available' | 'detected' | 'not-detected' | 'denied' | 'error'
  message: string; checkedAt: string | null; method?: 'adb' | 'su'
}
export interface DeviceInfo {
  status: 'loading' | 'ready' | 'error'; collectedAt: string | null; error?: string
  fields: Partial<Record<'manufacturer' | 'model' | 'product' | 'codename' | 'android' | 'sdk' | 'securityPatch' | 'build' | 'fingerprint' | 'abis'
    | 'socModel' | 'socManufacturer' | 'board' | 'hardware' | 'bootloader' | 'baseband' | 'buildDate' | 'buildType' | 'buildTags' | 'verifiedBoot' | 'bootloaderState' | 'slot', string>>
}
export interface AdbDiagnostics {
  status: 'idle' | 'loading' | 'ready'; collectedAt: string | null; executable: string | null
  fields: Record<string, string>; services: { name: string; type: string; address: string }[]; servicesAvailable: boolean
  issues: { check: string; message: string }[]
}
export type ActivitySource = 'components' | 'connection' | 'apps' | 'files' | 'system'
export interface DeviceRecord {
  id: string; name: string; serial: string; android: string; method: 'USB' | 'Wi-Fi' | 'Emulator'
  status: DeviceStatus; endpoint: string; lastSeen: string; known: boolean; canDetach: boolean; message?: string
  hardwareId?: string; aliases?: string[]; transportId?: string
  lastWirelessAddress?: { address: string; hardwareId: string; verifiedAt: string }
  info?: DeviceInfo
  root?: RootCheck
}
export interface QrSession { payload: string; expiresAt: number; status: 'waiting' | 'pairing' | 'paired' | 'expired' | 'failed'; message: string }
export interface ReconnectCandidate { token: string; id: string; name: string; method: DeviceRecord['method']; address: string; connected: boolean }
export interface ConnectionSnapshot { devices: DeviceRecord[]; activeDeviceId: string | null; scanning: boolean; busy: boolean; error: string | null; message: string; qr: QrSession | null; adbAvailable: boolean; discovery?: { candidates: ReconnectCandidate[]; expiresAt: number; message: string } }
export interface BackendSnapshot { appNotes?: import('./app-notes-protocol.js').AppNotesState; apkInspector?: import('./apk-inspector-protocol.js').ApkInspectorState; phoneTools?: import('./phone-tools-protocol.js').PhoneToolsState; adbConsole?: import('./adb-console-protocol.js').AdbConsoleState; screenSessions?: import('./screen-protocol.js').ScreenSession[]; confirmation?: import('./confirmation-protocol.js').ConfirmationState; notifications?: import('./notifications-protocol.js').NotificationSettings; history?: import('./history-protocol.js').HistorySnapshot; androidDiagnostics?: import('./android-diagnostics-protocol.js').AndroidDiagnosticsState; failureDiagnostics?: import('./failure-diagnostics-protocol.js').FailureDiagnostic[]; apkZstd?: boolean; fileSearch?: import('./file-search-protocol.js').FileSearchState; files?: import('./files-protocol.js').FilesState; fastboot?: import('./fastboot-protocol.js').FastbootSnapshot; restore?: import('./app-restore-protocol.js').RestoreState | null; exportDestination?: import('./app-backup-protocol.js').ExportDestinationSettings; backup?: import('./app-backup-protocol.js').BackupState | null; presetPreview?: import('./app-backup-protocol.js').PresetPreview | null; components: ComponentRecord[]; connection: ConnectionSnapshot; apps: import('./apps-protocol.js').AppsSnapshot; adbDiagnostics?: AdbDiagnostics; stopAdbOnExit?: boolean; appAction?: import('./app-actions-protocol.js').AppActionState | null }
export type BackendEvent = { type: 'appNotes'; state: import('./app-notes-protocol.js').AppNotesState } | { type: 'apkInspector'; state: import('./apk-inspector-protocol.js').ApkInspectorState } | { type: 'phoneTools'; state: import('./phone-tools-protocol.js').PhoneToolsState } | { type: 'adbConsole'; state: import('./adb-console-protocol.js').AdbConsoleState } | { type: 'screenSessions'; sessions: import('./screen-protocol.js').ScreenSession[] } | { type: 'confirmation'; state: import('./confirmation-protocol.js').ConfirmationState } | { type: 'notificationOpen'; taskPanel?: boolean; destination: import('./notifications-protocol.js').NotificationDestination } | { type: 'history'; overview: import('./history-protocol.js').HistoryOverview } | { type: 'notice'; text: string } | { type: 'androidDiagnostics'; state: import('./android-diagnostics-protocol.js').AndroidDiagnosticsState } | { type: 'failureDiagnostic'; diagnostic: import('./failure-diagnostics-protocol.js').FailureDiagnostic } | { type: 'fileSearch'; state: import('./file-search-protocol.js').FileSearchState } | { type: 'files'; state: import('./files-protocol.js').FilesState } | { type: 'fastboot'; state: import('./fastboot-protocol.js').FastbootSnapshot } | { type: 'restore'; state: import('./app-restore-protocol.js').RestoreState } | { type: 'backup'; state: import('./app-backup-protocol.js').BackupState } | { type: 'appAction'; state: import('./app-actions-protocol.js').AppActionState } | { type: 'adbDiagnostics'; diagnostics: AdbDiagnostics } | { type: 'apps'; apps: import('./apps-protocol.js').AppsSnapshot } | { type: 'components'; components: ComponentRecord[] } | { type: 'connection'; connection: ConnectionSnapshot } | { type: 'activity'; text: string; tone: 'info' | 'success' | 'warning'; source?: ActivitySource; device?: string }
export type BackendRequest = import('./app-notes-protocol.js').AppNotesRequest | { type: 'confirmation.answer'; id: string; accepted: boolean } | { type: 'history.list' | 'history.clear' } | { type: 'history.read'; sessionId: string }
  | import('./apk-inspector-protocol.js').ApkInspectorRequest
  | import('./adb-console-protocol.js').AdbConsoleRequest
  | import('./phone-tools-protocol.js').PhoneToolsRequest
  | import('./network-protocol.js').PhoneNetworkRequest
  | import('./android-diagnostics-protocol.js').AndroidDiagnosticsRequest
  | { type: 'diagnostics.read' | 'diagnostics.export'; id: string }
  | import('./files-protocol.js').FilesRequest
  | import('./file-search-protocol.js').FileSearchRequest
  | { type: 'connection.fastboot.scan' }
  | { type: 'connection.fastboot.inspect'; serial: string; token: string }
  | { type: 'connection.fastboot.reboot'; serial: string; token: string; mode: import('./fastboot-protocol.js').FastbootMode; confirmed: true }
  | { type: 'connection.screen'; id: string; serial: string; transportId?: string; action: import('./device-screen.js').ScreenAction; options?: import('./screen-protocol.js').ScreenLaunch }
  | { type: 'connection.screenCapabilities' }
  | { type: 'connection.screenApplications'; id: string; serial: string; transportId?: string }
  | { type: 'connection.cameraModes'; id: string; serial: string; transportId?: string }
  | { type: 'connection.screenStop'; sessionId: string }
  | { type: 'connection.screenOnTop'; sessionId: string; enabled: boolean }
  | { type: 'connection.cameraPanel'; sessionId: string }
  | { type: 'connection.touchControls'; sessionId: string }
  | { type: 'connection.cameraControl'; sessionId: string; command: import('./screen-protocol.js').CameraCommand }
  | { type: 'connection.cameraZoom'; sessionId: string; value: number }
  | { type: 'connection.cameraUpdate'; sessionId: string; update: import('./screen-protocol.js').CameraUpdate; confirmedSplit?: boolean }
  | { type: 'connection.power'; id: string; serial: string; transportId?: string; mode: import('./device-power.js').DevicePowerMode; confirmed: true }
  | { type: 'web.open'; url: string }
  | { type: 'apps.prepareScan'; id: string; userId: number; packageName: string; url: string }
  | { type: 'monitor.read'; id: string; tab: import('./monitor-protocol.js').MonitorTab }
  | { type: 'apps.restoreOpen'; id: string; userId: number }
  | { type: 'apps.installOpen'; id: string; userId: number; files?: import('./files-protocol.js').FileInstallSelection }
  | { type: 'apps.restorePrepare'; packageName: string }
  | { type: 'apps.restoreInstall'; token: string }
  | { type: 'apps.restoreCancel' }
  | { type: 'apps.restoreBatch'; plan: import('./app-restore-protocol.js').RestoreBatchRequest }
  | { type: 'apps.restoreRetry' }
  | { type: 'apps.restoreFiles'; token: string; components: Exclude<import('./app-backup-protocol.js').BackupPart, 'apk'>[] }
  | { type: 'connection.root'; id: string; requestAccess?: boolean }
  | { type: 'apps.backup' | 'apps.savePreset'; selection: import('./app-backup-protocol.js').BackupRequest }
  | { type: 'apps.loadPreset'; id: string; userId: number }
  | { type: 'apps.cancelBackup' | 'apps.openBackup' | 'apps.refreshBackups' }
  | { type: 'apps.revealBackup'; file: string }
  | { type: 'apps.action'; options?: import('./package-actions-protocol.js').PackageActionOptions; id: string; userId: number; packageName: string; action: import('./app-actions-protocol.js').AppActionId }
  | ({ type: 'apps.permission' } & import('./app-permissions-protocol.js').PermissionChange)
  | { type: 'apps.batchAction'; plan: import('./app-actions-protocol.js').BatchActionRequest }
  | { type: 'apps.retryBatchAction' }
  | { type: 'apps.cancelAction' | 'apps.openExport' }
  | { type: 'apps.badges'; id: string; userId: number } | { type: 'apps.cancelBadges' }
  | { type: 'snapshot' } | { type: 'components.detect' } | { type: 'components.installAll' }
  | { type: 'components.adbDiagnostics' } | { type: 'connection.info'; id: string }
  | { type: 'apps.refresh'; id: string; userId?: number } | { type: 'apps.cancel' }
  | { type: 'apps.selectProfile'; id: string; userId: number }
  | { type: 'apps.details' | 'apps.scan'; id: string; userId: number; packageName: string }
  | { type: 'apps.loadingMode'; mode: 'selected' | 'preload' }
  | { type: 'apps.options'; options: import('./apps-protocol.js').AppsOptions }
  | { type: 'settings.notifications'; settings: import('./notifications-protocol.js').NotificationSettings }
  | { type: 'notifications.test' }
  | { type: 'settings.stopAdbOnExit'; enabled: boolean }
  | { type: 'settings.apkZstd'; enabled: boolean }
  | { type: 'settings.exportMode'; mode: 'ask' | 'fixed' }
  | { type: 'settings.exportFolder' }
  | { type: 'components.action'; id: ComponentId; action: 'detect' | 'install' | 'repair' }
  | { type: 'components.locate'; id: ComponentId; folder: string } | { type: 'components.open' | 'components.source'; id: ComponentId }
  | { type: 'connection.scan' } | { type: 'connection.select'; id: string }
  | { type: 'connection.connect'; host: string; port: string }
  | { type: 'connection.pair'; host: string; port: string; code: string }
  | { type: 'connection.reconnect'; id: string } | { type: 'connection.disconnect'; id: string }
  | { type: 'connection.forget'; id: string }
  | { type: 'connection.find' } | { type: 'connection.confirmReconnect'; token: string }
  | { type: 'connection.qr' } | { type: 'connection.cancelQr' }
export type BackendReply = { ok: true; snapshot: BackendSnapshot; notice?: string; screenApplications?: import('./screen-applications.js').ScreenApplications; screenCapabilities?: import('./screen-protocol.js').ScreenCapabilities; cameraModes?: import('./screen-protocol.js').CameraInfo[]; historySession?: import('./history-protocol.js').SavedSession; phoneConnections?: import('./network-protocol.js').PhoneConnections; phoneTrace?: import('./network-protocol.js').PhoneTrace; fileClipboard?: import('./files-protocol.js').FileClipboardSelection; fileTaskIds?: string[]; networkScan?: import('./file-network-discovery.js').NetworkScanResult; diagnosticReport?: import('./failure-diagnostics-protocol.js').FailureDiagnosticReport; fileIndex?: import('./file-search-protocol.js').FileIndexInfo; fileListing?: import('./files-protocol.js').FileListing; fileStorages?: import('./files-protocol.js').FileStorage[]; fileProperties?: import('./files-protocol.js').FileProperties; folder?: string; thumbnail?: string; filePreview?: import('./file-preview-protocol.js').FilePreview; monitor?: import('./monitor-protocol.js').MonitorSample; scanPreparation?: import('./web-services.js').ScanPreparation } | { ok: false; error: string; snapshot: BackendSnapshot }
export interface DesktopBridge {
  apkPath?: (file: File) => string
  writeClipboard?: (text: string) => Promise<void>
  readClipboard?: () => Promise<string>
  control: (command: 'minimize' | 'maximize' | 'close') => Promise<void>
  locate: () => Promise<string | null>
  request: (request: BackendRequest) => Promise<BackendReply>
  subscribe: (listener: (event: BackendEvent) => void) => () => void
}
