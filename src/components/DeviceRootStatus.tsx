import { t, message } from "../lib/i18n"
import { useEffect } from 'react'
import type { DeviceRecord, RootCheck } from '../../electron/contracts'
import { requestBackend } from '../lib/backend'

export function useDetectDeviceRoot(device?: DeviceRecord, disabled = false) {
  useEffect(() => {
    if (device?.status === 'connected' && !device.root && !disabled) void requestBackend({ type: 'connection.root', id: device.id })
  }, [device?.id, device?.status, device?.root?.status, disabled])
}
export function rootDetected(root?: RootCheck) {
  return !!root && (['available', 'detected', 'denied'].includes(root.status) || root.method === 'su' || root.method === 'adb')
}
export function DeviceRootBadge({ device }: { device: DeviceRecord }) {
  const live = device.status === 'connected', detected = live && rootDetected(device.root)
  const absent = live && device.root?.status === 'not-detected'
  const label = detected ? t("Rooted") : absent ? t("Root not detected") : t("Root unknown")
  return <span className={`status-badge ${detected ? 'info' : 'neutral'}`} aria-label={t("Root on device")} title={detected ? t("Root was detected on this phone. Permission for ADB operations is checked separately.") : absent ? t("Root was not detected by ADB. Hidden root may not be visible.") : live ? t("Root detection has not completed or could not be verified.") : t("Reconnect the phone to check root.")}>{label}</span>
}
export function RootAccessNote({ device }: { device: DeviceRecord }) {
  if (device.status !== 'connected' || !device.root) return null
  const root = device.root
  const label = { checking: t("Checking"), available: t("Granted"), detected: t("Checked when needed"), 'not-detected': t("Root not detected"), denied: t("Not granted"), error: t("Could not verify") }[root.status]
  return <p className="component-description root-access-note" role="status">{t("ADB root access: ")}{label}.{['denied', 'error', 'checking'].includes(root.status) && ` ${message(root.message)}`}</p>
}
