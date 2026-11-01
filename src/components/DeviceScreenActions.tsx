import { ActionIndicator } from './ui'
import { HintButton } from './Tooltip'
import { useScreenStore } from '../store/useScreenStore'
import { ScreenSessions } from './ScreenControls'
import { Settings2 } from 'lucide-react'
import { useAndroidDiagnosticsStore } from '../store/useAndroidDiagnosticsStore'
import { useRef, useState } from 'react'
import { Camera, LoaderCircle, MonitorSmartphone, Moon, Sun } from 'lucide-react'
import type { DeviceRecord } from '../../electron/contracts'
import type { ScreenAction } from '../../electron/device-screen'
import { useConnectionStore } from '../store/useConnectionStore'
import { useAppStore } from '../store/useAppStore'
import { useAppActionsStore } from '../store/useAppActionsStore'
import { useBackupStore } from '../store/useBackupStore'
import { useRestoreBusy } from '../store/useRestoreStore'
import { requestBackend } from '../lib/backend'

const actions = [
  { action: 'open', label: "Mirror screen", icon: MonitorSmartphone, hint: "View and control this phone in a separate scrcpy window." },
  { action: 'screenshot', label: "Screenshot", icon: Camera, hint: "Save the phone screen as a PNG image on this computer." },
  { action: 'wake', label: "Wake screen", icon: Sun, hint: "Wake the screen. This does not bypass the phone lock." },
  { action: 'sleep', label: "Sleep screen", icon: Moon, hint: "Turn off the screen without shutting down the phone. Some phones pause Wi-Fi debugging while asleep." },
] as const

export function DeviceScreenActions({ device }: { device: DeviceRecord }) {
  const [pending, setPending] = useState<ScreenAction | null>(null), submitting = useRef(false)
  const diagnostic = useAndroidDiagnosticsStore(s => s.pending || s.job?.status === 'running')
  const connection = useConnectionStore(s => s.busy || !s.adbAvailable)
  const components = useAppStore(s => s.components)
  const componentPending = useAppStore(s => s.componentPending || s.bulkBusy)
  const appAction = useAppActionsStore(s => s.action?.status === 'running')
  const backup = useBackupStore(s => s.state?.status === 'running')
  const restore = useRestoreBusy()
  const scrcpy = components.find(c => c.id === 'scrcpy')
  const available = !!scrcpy?.location && ['Detected', 'Installed', 'Update available'].includes(scrcpy.status)
  const blocked = diagnostic || !!pending || connection || device.status !== 'connected' || appAction || backup || restore || componentPending || components.some(c => ['Checking', "Downloading", "Installing"].includes(c.status))
  return <>
    {actions.map(({ action, label, icon: Icon, hint }) => <HintButton key={action} className="button secondary" disabled={blocked || action === 'open' && !available} hint={action === 'open' && !available ? "Install or locate scrcpy in Components first." : hint} onClick={async () => {
      if (submitting.current) return
      submitting.current = true; setPending(action)
      try { await requestBackend({ type: 'connection.screen', id: device.id, serial: device.serial, transportId: device.transportId, action }) }
      finally { submitting.current = false; setPending(null) }
    }}>{pending === action ? <LoaderCircle size={14} className="spin" /> : <Icon size={14} />}{pending === action ? action === 'screenshot' ? "Saving screenshot…" : "Please wait…" : label}{action === 'screenshot' && pending !== action && <ActionIndicator picker />}</HintButton>)}
    <HintButton hint="Choose screen mirroring, a virtual display or a camera, with audio and recording options." className="button secondary" disabled={blocked || !available} onClick={() => useScreenStore.getState().open(device)}><Settings2 size={14} />{"Screen & recording"}<ActionIndicator /></HintButton>
    <ScreenSessions deviceId={device.id} />
    {!available && <p className="component-description">Mirror screen requires scrcpy. Install or locate it in Components.</p>}
  </>
}
