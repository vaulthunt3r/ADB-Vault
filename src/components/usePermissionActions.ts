import { useRef, useState } from 'react'
import type { AndroidApp } from '../../electron/apps-protocol'
import type { AppPermission } from '../../electron/app-details-protocol'
import { permissionRestriction } from '../../electron/app-permissions-protocol'
import { useAppsStore } from '../store/useAppsStore'
import { useConnectionStore } from '../store/useConnectionStore'
import { useAppActionsStore } from '../store/useAppActionsStore'
import { useAppStore } from '../store/useAppStore'
import { useBackupStore } from '../store/useBackupStore'
import { useRestoreBusy } from '../store/useRestoreStore'
import { requestBackend } from '../lib/backend'

export function usePermissionActions(app: AndroidApp, loading: boolean) {
  const apps = useAppsStore(), connection = useConnectionStore()
  const action = useAppActionsStore(s => s.action)
  const componentsBusy = useAppStore(s => s.components.some(c => ['Checking', 'Downloading', 'Installing'].includes(c.status)))
  const backupBusy = useBackupStore(s => s.state?.status === 'running'), restoreBusy = useRestoreBusy()
  const lock = useRef(false), [pending, setPending] = useState<string | null>(null)
  const [requestError, setRequestError] = useState<{ permission: string; message: string } | null>(null)
  const device = connection.devices.find(d => d.id === apps.deviceId)
  const contextReady = !!window.desktop && apps.status === 'ready' && apps.userId === app.userId && connection.activeDeviceId === apps.deviceId && device?.status === 'connected'
  const busy = !!pending || action?.status === 'running' || backupBusy || restoreBusy || componentsBusy || connection.busy || loading || apps.badgeRead?.status === 'running' || apps.details?.data?.analysis?.status === 'running'
  const sameAction = action?.action === 'permission' && action.id === apps.deviceId && action.userId === app.userId && action.packageName === app.packageName
  const shared = apps.apps.some(a => a.packageName !== app.packageName && a.uid === app.uid)
  return {
    pending: pending || (sameAction && action.status === 'running' ? action.permission : null),
    error: requestError || (sameAction && action.status === 'error' ? { permission: action.permission, message: action.message } : null),
    reason: (entry: AppPermission) => permissionRestriction(entry, app.targetSdk, shared) || (!contextReady ? "Connect this device and select its loaded profile." : busy ? "Wait for the current operation to finish." : null),
    change: async (entry: AppPermission) => {
      if (lock.current || busy || !contextReady || entry.granted === null || permissionRestriction(entry, app.targetSdk, shared)) return
      lock.current = true; setPending(entry.name); setRequestError(null)
      try { await requestBackend({ type: 'apps.permission', id: apps.deviceId!, userId: app.userId, packageName: app.packageName, permission: entry.name, granted: !entry.granted, expectedGranted: entry.granted }, message => setRequestError({ permission: entry.name, message })) }
      finally { lock.current = false; setPending(null) }
    },
  }
}
