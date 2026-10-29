import type { BackendRequest, BackendSnapshot } from './contracts.js'
import { fileTaskActive } from './files-protocol.js'
import { restoreBusy } from './app-restore-protocol.js'

export const exitOperationLabels = {
  inspector: 'APK Inspector · Analysing local APKs or saving an inspection report',
  components: 'Components · Checking, installing or updating components and databases',
  connection: 'Connection · Connecting, pairing or changing the device connection',
  qr: 'Connection · QR pairing session',
  deviceInfo: 'Connection · Reading device information or checking root access',
  screen: 'Connection · Screenshot or screen control',
  mirror: 'Connection · Mirror screen',
  power: 'Connection · Phone power operation',
  fastboot: 'Connection · Fastboot operation',
  collection: 'Apps · Reading applications and profiles',
  details: 'Apps · Reading details or scanning APKs',
  badges: 'Apps · Reading application badges',
  backup: 'Apps · Exporting applications or presets',
  restore: 'Apps · Preparing, installing or restoring applications',
  actions: 'Apps · Application actions or permission changes',
  presets: 'Apps · Reading a preset or checking backups',
  files: 'Files · Queued, running or paused file tasks',
  folders: 'Files · Reading folders, storage or properties',
  search: 'Files · Searching categories or updating an index',
  networkFolders: 'Files · Network discovery or SMB connection',
  clipboard: 'Files · Preparing or pasting clipboard files',
  phoneTools: 'Connection · Clipboard or phone data export',
  preview: 'Files · Preparing file previews or opening files',
  monitor: 'Monitor · Reading device statistics or network connections',
  console: 'Console · Running a command',
  diagnostics: 'Connection / Monitor · Collecting Android logs, bug report or battery usage',
  diagnosticExport: 'Activity / Connection · Reading or saving diagnostic reports',
  settings: 'Settings · Saving preferences',
} as const
export type ExitOperation = keyof typeof exitOperationLabels

// Every IPC command must explicitly declare its close behaviour, including new commands.
// Null commands only inspect existing state, cancel work, or open an already saved result.
export const requestExitOperation: Record<BackendRequest['type'], ExitOperation | null> = {
  'inspector.open': 'inspector', 'inspector.clear': null, 'inspector.cancel': null, 'inspector.swap': null, 'inspector.export': 'inspector',
  'apps.notesSave': 'settings', 'apps.notesDelete': 'settings', 'apps.notesExport': 'settings', 'apps.notesImport': 'settings',
  'confirmation.answer': null,
  snapshot: null,
  'settings.notifications': 'settings', 'notifications.test': null,
  'history.list': null, 'history.read': null, 'history.clear': 'settings',
  'components.detect': 'components', 'components.installAll': 'components',
  'components.action': 'components', 'components.locate': 'components',
  'components.adbDiagnostics': 'components', 'components.open': null, 'components.source': null,
  'connection.scan': 'connection', 'connection.select': 'connection', 'connection.connect': 'connection',
  'connection.pair': 'connection', 'connection.reconnect': 'connection', 'connection.disconnect': 'connection',
  'connection.forget': 'connection', 'connection.find': 'connection', 'connection.confirmReconnect': 'connection',
  'connection.qr': 'qr', 'connection.cancelQr': null,
  'connection.root': 'deviceInfo', 'connection.info': 'deviceInfo',
  'connection.screen': 'screen', 'connection.power': 'power',
  'connection.screenCapabilities': null, 'connection.screenApplications': 'screen', 'connection.screenStop': 'screen', 'connection.screenOnTop': 'screen',
  'connection.cameraModes': 'screen', 'connection.cameraPanel': null, 'connection.touchControls': null, 'connection.cameraControl': 'screen', 'connection.cameraZoom': 'screen', 'connection.cameraUpdate': 'screen',
  'connection.fastboot.scan': 'fastboot', 'connection.fastboot.inspect': 'fastboot', 'connection.fastboot.reboot': 'fastboot',
  'apps.refresh': 'collection', 'apps.selectProfile': 'collection', 'apps.cancel': null,
  'apps.loadingMode': 'settings', 'apps.options': 'settings',
  'apps.details': 'details', 'apps.scan': 'details', 'apps.badges': 'badges', 'apps.cancelBadges': null,
  'apps.backup': 'backup', 'apps.savePreset': 'backup', 'apps.cancelBackup': null, 'apps.openBackup': null, 'apps.revealBackup': null,
  'apps.loadPreset': 'presets', 'apps.refreshBackups': 'presets',
  'apps.action': 'actions', 'apps.batchAction': 'actions', 'apps.retryBatchAction': 'actions',
  'apps.permission': 'actions', 'apps.prepareScan': 'actions', 'apps.cancelAction': null, 'apps.openExport': null,
  'apps.restoreOpen': 'restore', 'apps.installOpen': 'restore', 'apps.restorePrepare': 'restore',
  'apps.restoreInstall': 'restore', 'apps.restoreFiles': 'restore', 'apps.restoreBatch': 'restore',
  'apps.restoreRetry': 'restore', 'apps.restoreCancel': null,
  'files.enqueue': 'files', 'files.control': 'files', 'files.resolve': 'files',
  'files.list': 'folders', 'files.properties': 'folders', 'files.storages': 'folders', 'files.chooseFolder': 'folders',
  'files.search': 'search', 'files.search.cancel': null,
  'files.index.info': 'search', 'files.index.build': 'search', 'files.index.delete': 'search',
  'files.network.scan': 'networkFolders', 'files.network.scan.cancel': null, 'files.network.connect': 'networkFolders',
  'files.clipboard.write': 'clipboard', 'files.clipboard.read': 'clipboard', 'files.clipboard.paste': 'clipboard',
  'files.open': 'preview', 'files.preview': 'preview', 'files.preview.close': null,
  'files.thumbnail': 'preview', 'files.thumbnail.cancel': null,
  'monitor.read': 'monitor', 'network.connections': 'monitor', 'network.trace': 'monitor', 'network.cancel': null,
  'console.run': 'console', 'console.stop': null, 'console.clear': null,
  'phoneTools.read': 'phoneTools', 'phoneTools.clipboard.read': 'phoneTools', 'phoneTools.clipboard.write': 'phoneTools',
  'phoneTools.export': 'phoneTools', 'phoneTools.cancel': null, 'phoneTools.reveal': null, 'phoneTools.clear': null,
  'androidDiagnostics.start': 'diagnostics', 'androidDiagnostics.cancel': null, 'androidDiagnostics.reveal': null,
  'androidDiagnostics.exportLog': 'diagnosticExport', 'diagnostics.read': 'diagnosticExport', 'diagnostics.export': 'diagnosticExport',
  'settings.stopAdbOnExit': 'settings', 'settings.apkZstd': 'settings',
  'settings.exportMode': 'settings', 'settings.exportFolder': 'settings', 'web.open': null,
}

export function collectExitOperations(s: BackendSnapshot, pending: Iterable<ExitOperation> = [], mirrors = 0): string[] {
  const active = new Set(pending)
  if (s.apkInspector?.before.status === 'loading' || s.apkInspector?.after.status === 'loading') active.add('inspector')
  if (s.files?.tasks.some(fileTaskActive)) active.add('files')
  if (s.fileSearch?.status === 'running') active.add('search')
  if (s.backup?.status === 'running') active.add('backup')
  if (restoreBusy(s.restore)) active.add('restore')
  if (s.appAction?.status === 'running') active.add('actions')
  if (s.apps.status === 'loading' || s.apps.backgroundUserId != null) active.add('collection')
  if (s.apps.details?.status === 'loading' || s.apps.details?.data?.analysis?.status === 'running') active.add('details')
  if (s.apps.badgeRead?.status === 'running') active.add('badges')
  if (s.adbConsole?.run && ['running', 'stopping'].includes(s.adbConsole.run.status)) active.add('console')
  if (s.phoneTools?.job?.status === 'running') active.add('phoneTools')
  if (s.androidDiagnostics?.job?.status === 'running') active.add('diagnostics')
  if (s.adbDiagnostics?.status === 'loading') active.add('components')
  if (s.fastboot?.busy) active.add('fastboot')
  if (s.connection.busy) active.add('connection')
  if (s.connection.qr && ['waiting', 'pairing'].includes(s.connection.qr.status) && s.connection.qr.expiresAt > Date.now()) active.add('qr')
  if (s.connection.devices.some(d => d.info?.status === 'loading' || d.root?.status === 'checking')) active.add('deviceInfo')
  if (mirrors) active.add('mirror')
  return [...active].map(key => exitOperationLabels[key])
}
