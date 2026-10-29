import type { ConfirmationContent } from './confirmation-protocol.js'
import type { AndroidApp as AndroidApplication } from './apps-protocol.js'
import { batchActionLabels, cleanupLabels, type AppActionId, type AppActionState, type BatchActionId, type CleanupPart } from './app-actions-protocol.js'
import type { PackageActionOptions } from './package-actions-protocol.js'
import type { RestoreState } from './app-restore-protocol.js'

const context = (device: string, profile: string, userId: number) => [{ label: 'Device', value: device }, { label: 'Profile', value: `${profile} · ID ${userId}` }]
function actionContent(action: AppActionId | BatchActionId, options?: PackageActionOptions, cleanup?: CleanupPart[]): Pick<ConfirmationContent, 'tone' | 'description' | 'effects' | 'details'> {
  const parts = cleanup || (action.startsWith('clear-') ? [action.slice(6) as CleanupPart] : [])
  const effects: string[] = [], details: string[] = []
  if (action.startsWith('clear-')) {
    if (parts.includes('data')) effects.push('App settings, local databases, login data and cache will be permanently deleted. Android may also remove external app data.')
    if (parts.includes('cache') && !parts.includes('data')) effects.push('Deletes cache only where Android supports safe per-app cache clearing. App data will not be reset as a fallback.')
    if (parts.includes('obb')) effects.push('OBB game assets will be permanently deleted. Games may need to download them again.')
    if (parts.includes('media')) effects.push('Files in the app’s Android/media folder will be permanently deleted, including any photos, recordings and downloads stored there.')
    if (parts.some(p => p === 'obb' || p === 'media')) {
      effects.push('Applications will be stopped and remain stopped.')
      details.push('OBB and media cleanup targets only the selected profile’s primary-storage Android/obb and Android/media package folders. Shared DCIM/Downloads folders and removable SD cards are not targeted.')
    }
    if (parts.some(p => p !== 'cache')) effects.push('Deleted data cannot be recovered by this action. An APK-only backup does not preserve it.')
    details.push('Applications stay installed. Cleanup may be partial if a step fails.')
    return { tone: 'danger', description: `Clear ${parts.map(p => cleanupLabels[p] + (p === 'data' ? ' (includes cache)' : '')).join(', ')} in the selected profile.`, effects, details }
  }
  if (action === 'install-existing') return { tone: 'normal', description: 'Restore this application to the selected Android profile using APK files already on the phone.', effects: ['Deleted app data is not recovered.', 'Existing disabled or frozen state is kept.'], details: ['Android may reject protected packages. No APK is downloaded or installed from the computer.'] }
  if (action === 'uninstall') return { tone: 'danger', description: 'Remove the application from this Android profile.', effects: options?.keepData ? ['Asks Android to retain app data and cache. This is not a backup.', 'Other profiles and system APKs in the firmware are not targeted.'] : ['The application and its data will be removed from this profile.', 'Other profiles and system APKs in the firmware are not targeted.', 'An APK-only backup does not preserve app data.'], details: [] }
  if (action === 'disable') return { tone: 'warning', description: 'Make the application unavailable in this profile.', effects: ['Applications will stop and stay disabled until you enable them again.'], details: [] }
  if (action === 'enable') return { tone: 'normal', description: 'Make the application available in this profile again.', effects: ['Enables the selected applications.'], details: [] }
  if (action === 'suspend') return { tone: 'warning', description: 'Freeze access to the application in this profile using Android suspension.', effects: ['Android blocks opening the app and hides its notifications. App files and data stay on the phone.'], details: ['This does not disable the package or guarantee that background services stop. Android may reject protected applications. Use Unfreeze to remove the suspension set through ADB.'] }
  if (action === 'unsuspend') return { tone: 'normal', description: 'Remove the suspension set through ADB in this profile.', effects: ['The app can open again if it is enabled and no other policy suspends it.'], details: ['Suspension set by a device administrator or another app may remain.'] }
  return { tone: 'warning', description: 'Stop the application in this profile.', effects: ['Unsaved work can be lost. Background activity may stop until the app is launched again.'], details: [] }
}
const systemWarning = 'System applications are included. Changing them can affect device functions.'
export function singleActionConfirmation(action: AppActionId, application: AndroidApplication, device: string, profile: string, options?: PackageActionOptions): ConfirmationContent {
  const title = ({ 'install-existing': 'Restore to profile', 'clear-cache': 'Clear application cache', 'clear-data': 'Clear application data', 'clear-obb': 'Delete application OBB files', 'clear-media': 'Delete application media files', uninstall: 'Uninstall application', disable: 'Disable application', suspend: 'Freeze application', unsuspend: 'Unfreeze application' } as Partial<Record<AppActionId, string>>)[action] || 'Force-stop application'
  return { ...actionContent(action, options), title, confirmLabel: title, context: context(device, profile, application.userId), applications: [{ label: application.label, packageName: application.packageName, iconPng: application.iconPng, system: application.system }], warnings: [...(application.system ? [systemWarning] : []), ...(options?.root ? ['Using confirmed root access.'] : [])] }
}
export function batchActionConfirmation(state: AppActionState, apps: AndroidApplication[]): ConfirmationContent {
  const batch = state.batch!, affected = batch.items.filter(i => i.status === 'pending')
  const parts = [...new Set(affected.flatMap(i => i.steps?.map(s => s.part) || []))]
  const content = actionContent(state.action as BatchActionId, state.options, state.action === 'clear-storage' ? parts : undefined)
  const title = batchActionLabels[state.action as BatchActionId]
  return { ...content, title, confirmLabel: title, context: context(batch.deviceName, batch.profileName, state.userId),
    selection: { total: batch.items.length, affected: affected.length, skipped: batch.items.length - affected.length },
    applications: batch.items.map((item, index) => ({ label: item.label, packageName: item.packageName, system: item.system, iconPng: index < 50 ? apps.find(a => a.packageName === item.packageName && a.userId === state.userId)?.iconPng : undefined, skipped: item.status === 'skipped', note: item.status === 'skipped' ? `Skipped: ${item.message}` : item.steps?.map(s => cleanupLabels[s.part]).join(', ') })),
    warnings: [...(affected.some(i => i.system) ? [systemWarning] : []), ...(state.options?.root ? ['Using confirmed root access.'] : [])],
    details: [...content.details || [], 'Completed changes are not rolled back. Stop finishes the current application.'] }
}
export function restoreConfirmation(state: RestoreState): ConfirmationContent {
  const base = { context: context(state.deviceName, state.profileName, state.userId) }
  if (state.batch) {
    const installing = state.sourceKind === 'install'
    const labels = { apk: 'APK/APKS', data: 'App data', cache: 'Cache', obb: 'OBB', media: 'Media' }
    return { ...base, title: installing ? 'Install applications' : 'Restore applications', confirmLabel: installing ? 'Install selected' : 'Restore selected', tone: installing ? 'normal' : 'danger',
      description: installing ? 'Install the selected APK/APKS files in this profile.' : 'Restore the selected components from your backup.',
      applications: state.batch.items.map(i => ({ label: i.label, packageName: i.packageName, note: `Version ${i.versionCode} · ${i.components.map(p => labels[p]).join(', ') || 'Skipped — no chosen components saved'}` })),
      effects: installing ? ['Existing applications may be updated.', 'Shared application code can affect other profiles on this device.'] : ['Selected APK/APKS will be installed first. Selected saved file directories will then be replaced.', 'Applications may be stopped. Private files require phone root and granted Shell access.', 'Shared application code can affect other profiles. Keystore keys and system accounts are not restored.'],
      warnings: ['Completed applications are not rolled back if another fails.'],
      details: installing ? ['Android checks signatures and compatibility. No uninstall or downgrade fallback is attempted.', 'Applications are installed in order. Stop finishes the current application. A lost connection can leave its outcome uncertain.'] : [`Backup: ${state.source}`, 'Each copy is verified before use. Missing components are skipped. Data restoration requires matching APKs and an unlocked profile.', 'Stop finishes the current application. Connection loss may require manual recovery.'] }
  }
  const application = state.applications.find(a => a.packageName === state.packageName)!
  const files = state.operation === 'files'
  return { ...base, title: files ? 'Restore application files' : 'Install application copy', confirmLabel: files ? 'Replace selected files' : 'Install application', tone: files ? 'danger' : 'normal',
    description: files ? `Restore ${state.selectedParts?.join(', ')} from your backup.` : 'Install this verified APK and all saved splits.',
    applications: [{ label: application.label, packageName: application.packageName, note: `Version ${application.versionName || '—'} (${application.versionCode})` }],
    effects: files ? ['The app will be stopped. Existing files in the saved directories will be replaced.', 'Keystore keys, system accounts, grants and device identifiers are not restored. Some apps may require login again.'] : ['Existing app data is retained by Android. The app may be stopped during installation.', 'Updating shared application code can affect other profiles.', 'Data, cache, OBB and media will not be restored.'],
    warnings: files ? ['A lost connection during replacement may require manual recovery.'] : [],
    details: files ? ['Unselected components and directories absent from the backup are retained. Temporary recovery copies are kept during replacement.', 'The matching APK/APKS must already be installed.'] : ['Android may reject incompatible signatures or downgrades. The app will not be uninstalled to bypass an error.'] }
}
