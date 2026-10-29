import { restoreBusy } from '../../electron/app-restore-protocol'
import type { FileEntry, FileInstallSelection } from '../../electron/files-protocol'
import { useRestoreStore } from '../store/useRestoreStore'
import { useConnectionStore } from '../store/useConnectionStore'
import { useAppsStore } from '../store/useAppsStore'
import { requestBackend } from './backend'

export const isInstallFile = (entry: FileEntry) => entry.kind === 'file' && /\.(apk|apks)$/i.test(entry.name)
let preparationCancelled = false

export function cancelFilePreparation() {
  if (!useRestoreStore.getState().filePreparing) return
  preparationCancelled = true
  void requestBackend({ type: useAppsStore.getState().status === 'loading' ? 'apps.cancel' : 'apps.restoreCancel' })
}

export async function openFileInstallation(files: FileInstallSelection) {
  const restore = useRestoreStore.getState()
  if (restore.filePreparing || restoreBusy(restore.state)) return
  preparationCancelled = false
  const connection = useConnectionStore.getState(), target = connection.devices.find(d => d.id === connection.activeDeviceId && d.status === 'connected')
  useRestoreStore.setState({ visible: true, mode: 'install', fileSelection: files, filePreparing: true, fileError: '', state: null })
  const fail = (fileError: string) => useRestoreStore.setState({ fileError })
  try {
    if (!target) throw new Error('Connect and select the destination device in Connection.')
    const before = useAppsStore.getState()
    if (before.status === 'loading') throw new Error('Wait for application collection to finish.')
    if (before.deviceId !== target.id || before.status !== 'ready' || before.userId === null) {
      if (!await requestBackend({ type: 'apps.refresh', id: target.id }, fail)) return
    }
    if (preparationCancelled) throw new Error('Preparation cancelled. Nothing was installed.')
    const current = useConnectionStore.getState(), device = current.devices.find(d => d.id === target.id), apps = useAppsStore.getState()
    if (current.activeDeviceId !== target.id || device?.status !== 'connected' || device.serial !== target.serial || device.transportId !== target.transportId) throw new Error('The destination connection changed. Select the files again.')
    if (apps.deviceId !== target.id || apps.status !== 'ready' || apps.userId === null) throw new Error('Could not read the destination profile. Try again when application collection is complete.')
    await requestBackend({ type: 'apps.installOpen', id: target.id, userId: apps.userId, files }, fail)
    if (preparationCancelled) fail('Preparation cancelled. Nothing was installed.')
  } catch (error) { fail(error instanceof Error ? error.message : String(error)) }
  finally { useRestoreStore.setState({ filePreparing: false }) }
}
