import { ActionIndicator } from './ui'
import { HintButton } from './Tooltip'
import { useAdbConsoleStore } from '../store/useAdbConsoleStore'
import { usePhoneToolsStore } from '../store/usePhoneToolsStore'
import { useAndroidDiagnosticsStore } from '../store/useAndroidDiagnosticsStore'
import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, Power, RotateCw } from 'lucide-react'
import type { DeviceRecord } from '../../electron/contracts'
import { devicePowerLabels, type DevicePowerMode } from '../../electron/device-power'
import { useConnectionStore } from '../store/useConnectionStore'
import { useAppsStore } from '../store/useAppsStore'
import { useAppActionsStore } from '../store/useAppActionsStore'
import { useBackupStore } from '../store/useBackupStore'
import { useRestoreBusy } from '../store/useRestoreStore'
import { useAppStore } from '../store/useAppStore'
import { useFastbootStore } from '../store/useFastbootStore'
import { requestBackend } from '../lib/backend'

export function usePowerBlocked(requiresAdb = true) {
  const phoneTools = usePhoneToolsStore(s => s.pending || s.job?.status === 'running' && s.job.action !== 'export')
  const consoleBusy = useAdbConsoleStore(s => s.pending || s.run?.status === 'running' || s.run?.status === 'stopping')
  const diagnostic = useAndroidDiagnosticsStore(s => s.pending || s.job?.status === 'running')
  const fastboot = useFastbootStore(s => s.busy)
  const connection = useConnectionStore(s => s.busy || requiresAdb && !s.adbAvailable)
  const apps = useAppsStore(s => s.status === 'loading' || s.backgroundUserId !== null || s.details?.status === 'loading' || s.badgeRead?.status === 'running')
  const action = useAppActionsStore(s => s.action?.status === 'running')
  const backup = useBackupStore(s => s.state?.status === 'running')
  const restore = useRestoreBusy()
  const components = useAppStore(s => s.componentPending || s.bulkBusy || s.components.some(c => ['Checking', "Downloading", "Installing"].includes(c.status)))
  return phoneTools || consoleBusy || diagnostic || connection || apps || action || backup || restore || components || fastboot
}

export function DevicePowerActions({ device }: { device: DeviceRecord }) {
  const [dialog, setDialog] = useState<{ device: DeviceRecord; shutdown: boolean } | null>(null)
  const blocked = usePowerBlocked() || device.status !== 'connected'
  return <>
    <HintButton hint="Choose Android, Recovery, Bootloader or Fastbootd, then confirm the restart." className="button secondary" disabled={blocked} onClick={() => setDialog({ device: { ...device }, shutdown: false })}><RotateCw size={14} />Restart<ActionIndicator /></HintButton>
    <HintButton hint="Shut down the phone after confirmation. You will need to turn it on manually." className="button secondary" disabled={blocked} onClick={() => setDialog({ device: { ...device }, shutdown: true })}><Power size={14} />Power off<ActionIndicator /></HintButton>
    {dialog && <DevicePowerDialog device={dialog.device} shutdown={dialog.shutdown} close={() => setDialog(null)} />}
  </>
}

export function DevicePowerDialog({ device, shutdown, close }: { device: DeviceRecord; shutdown: boolean; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null), cancel = useRef<HTMLButtonElement>(null), submitting = useRef(false)
  const [mode, setMode] = useState<DevicePowerMode>(shutdown ? 'shutdown' : 'restart')
  const [pending, setPending] = useState(false), [error, setError] = useState('')
  const blocked = usePowerBlocked()
  const current = useConnectionStore(s => s.devices.find(d => d.id === device.id))
  const available = current?.status === 'connected' && current.serial === device.serial && current.transportId === device.transportId
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const dialog = ref.current; dialog?.showModal(); cancel.current?.focus()
    return () => { dialog?.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  const warning = shutdown
    ? "The phone will shut down completely. ADB Vault will lose all control of it and cannot turn it back on. You will need to turn on the phone manually and reconnect."
    : mode === 'bootloader' || mode === 'fastboot'
      ? `The phone will restart into ${mode === 'fastboot' ? "Fastbootd" : "Bootloader / Fastboot"}. Normal ADB control will be unavailable. Connect it by USB and use Find Fastboot devices in Connection to return to Android, or use the phone’s buttons. Mode support depends on the phone.`
      : mode === 'recovery'
        ? "The phone will restart into Recovery. The connection will be interrupted; ADB control may be unavailable. To return to Android, choose Reboot system on the phone. Mode support depends on the phone."
        : "The phone will restart and the connection will be interrupted. After startup, unlock the phone; you may need to reconnect Wi-Fi debugging."
  return <dialog ref={ref} className="locate-dialog" aria-labelledby="device-power-title" aria-describedby="device-power-warning" onCancel={event => { event.preventDefault(); if (!submitting.current) close() }}>
    <form onSubmit={async event => {
      event.preventDefault()
      if (submitting.current || blocked || !available) return
      submitting.current = true; setPending(true); setError('')
      try {
        if (await requestBackend({ type: 'connection.power', id: device.id, serial: device.serial, transportId: device.transportId, mode, confirmed: true }, setError)) {
          useAppStore.getState().notify(`${device.name}: ${devicePowerLabels[mode]} requested`)
          close()
        }
      } finally { submitting.current = false; setPending(false) }
    }}>
      <h2 id="device-power-title">{shutdown ? "Power off phone?" : "Restart phone"}</h2>
      <p><strong>{device.name}</strong><br /><span className="forget-device-address">{device.method} · {device.serial}</span></p>
      {!shutdown && <fieldset disabled={pending} className="device-power-options"><legend>Restart to</legend>{(['restart', 'recovery', 'bootloader', 'fastboot'] as const).map(value => <label key={value}><input type="radio" name="restart-mode" value={value} checked={mode === value} onChange={() => setMode(value)} />{value === 'restart' ? "Android" : value === 'recovery' ? "Recovery" : value === 'fastboot' ? "Fastbootd" : "Bootloader / Fastboot"}</label>)}</fieldset>}
      <p id="device-power-warning">{warning}</p>
      {!available && !pending && <p className="field-error" role="status">The selected connection changed or is no longer available. Close this dialog and select the phone again.</p>}
      {blocked && !pending && <p className="component-description" role="status">Wait for the current operation to finish.</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="dialog-footer"><button ref={cancel} type="button" className="button secondary" disabled={pending} onClick={close}>Cancel</button><button type="submit" className="button primary" disabled={pending || blocked || !available}>{pending ? <LoaderCircle size={14} className="spin" /> : shutdown ? <Power size={14} /> : <RotateCw size={14} />}{pending ? "Sending command…" : shutdown ? "Power off phone" : "Restart phone"}</button></div>
    </form>
  </dialog>
}
