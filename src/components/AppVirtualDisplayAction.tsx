import { t as translateUi } from '../lib/i18n'
import { t } from "../lib/i18n"
import { AppWindow } from 'lucide-react'
import type { AndroidApp } from '../../electron/apps-protocol'
import { useAppStore } from '../store/useAppStore'
import { useAppsStore } from '../store/useAppsStore'
import { useConnectionStore } from '../store/useConnectionStore'
import { useScreenStore } from '../store/useScreenStore'
import { HintButton } from './Tooltip'
import { ActionIndicator } from './ui'

export function AppVirtualDisplayAction({ app, ready }: { app: AndroidApp; ready: boolean }) {
  const { deviceId, userId, currentUserId } = useAppsStore()
  const device = useConnectionStore(s => s.devices.find(d => d.id === deviceId))
  const scrcpy = useAppStore(s => s.components.find(c => c.id === 'scrcpy'))
  const available = !!scrcpy?.location && ['Detected', 'Installed', 'Update available'].includes(scrcpy.status)
  const hint = !available ? t("Install or locate scrcpy in Components.") : userId !== currentUserId ? t("Available for the phone’s current Android profile only.") : !app.enabled || app.suspended ? t("Enable or resume this app before launching it.") : translateUi("Open {0} in a separate Android window on your computer.", [app.label])
  return <HintButton className="button secondary" hint={hint} disabled={!ready || !app.enabled || app.suspended || !available || userId !== currentUserId || app.userId !== userId} onClick={() => {
    if (device && userId !== null) useScreenStore.getState().open(device, { packageName: app.packageName, userId, label: app.label })
  }}><AppWindow size={15} />{t("Virtual display")}<ActionIndicator /></HintButton>
}
