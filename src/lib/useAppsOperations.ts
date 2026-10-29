import { useAppsStore } from '../store/useAppsStore'
import { useConnectionStore } from '../store/useConnectionStore'
import { useAppActionsStore } from '../store/useAppActionsStore'
import { useBackupStore } from '../store/useBackupStore'
import { useRestoreBusy } from '../store/useRestoreStore'

export function useAppsOperations() {
  const { deviceId, userId, status, badgeRead } = useAppsStore()
  const { activeDeviceId, devices } = useConnectionStore()
  const actionBusy = useAppActionsStore(s => s.action?.status === 'running')
  const running = useBackupStore(s => s.state?.status === 'running')
  const restoring = useRestoreBusy()
  const ready = !!deviceId && userId !== null && status === 'ready' && activeDeviceId === deviceId && devices.some(d => d.id === deviceId && d.status === 'connected')
  return { running, blocked: restoring || !ready || actionBusy || badgeRead?.status === 'running' }
}
