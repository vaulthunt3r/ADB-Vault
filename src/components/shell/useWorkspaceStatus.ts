import { locale as uiLocale } from '../../lib/i18n'
import { t } from "../../lib/i18n"
import { isBusy, isReady, needsAttention, settledStatus, statusLabel } from '../../lib/components'
import { useAppStore, type Section } from '../../store/useAppStore'
import { useConnectionStore } from '../../store/useConnectionStore'
import { useAppsStore } from '../../store/useAppsStore'
import { useFastbootStore } from '../../store/useFastbootStore'
import { useApkInspectorStore } from '../../store/useApkInspectorStore'

type Tone = 'success' | 'warning' | 'error' | 'neutral' | 'active'
export interface StatusInfo { summary: string; tone: Tone; rows: { label: string; value: string }[] }

export function useWorkspaceStatus(): Partial<Record<Section, StatusInfo>> {
  const components = useAppStore(s => s.components)
  const connection = useConnectionStore(), apps = useAppsStore()
  const fastboot = useFastbootStore()
  const inspector = useApkInspectorStore()
  const available = (component: typeof components[number]) => !!component.location && (isReady(settledStatus(component)) || settledStatus(component) === 'Update available')
  const adb = components.find(component => component.id === 'adb')
  const working = components.filter(component => isBusy(component.status))
  const issues = components.filter(component => needsAttention(settledStatus(component)) && settledStatus(component) !== 'Update available')
  const updates = components.filter(component => settledStatus(component) === 'Update available')
  const optional = components.filter(component => component.id !== 'adb')
  const componentInfo: StatusInfo = {
    summary: working.length ? t("Checking / preparing components") : !adb || !available(adb) ? t("ADB is not ready") : issues.length ? t("ADB ready · Some components need attention") : updates.length ? t("ADB ready · Updates available") : t("ADB ready"),
    tone: working.length ? 'active' : !adb || !available(adb) ? 'error' : issues.length || updates.length ? 'warning' : 'success',
    rows: [
      { label: t("ADB"), value: adb ? `${statusLabel(adb.status)}${available(adb) ? ` · ${adb.version}` : ''}` : t("Not found") },
      { label: t("Other components"), value: `${optional.filter(available).length} of ${optional.length} ready` },
      ...working.map(component => ({ label: component.name, value: component.status })),
      ...issues.filter(component => component.id !== 'adb' && !isBusy(component.status)).map(component => ({ label: component.name, value: statusLabel(settledStatus(component)) })),
      ...(updates.length ? [{ label: t("Updates"), value: updates.map(component => component.name).join(', ') }] : []),
    ],
  }
  const connected = connection.devices.filter(device => device.status === 'connected')
  const device = connection.devices.find(device => device.id === connection.activeDeviceId) ?? connection.devices.find(device => device.id === connection.selectedDeviceId)
  const state = device ? device.status[0].toUpperCase() + device.status.slice(1) : t("No device connected")
  const connectionInfo: StatusInfo = {
    summary: connection.busy ? t("Connecting device") : device ? `${state} · ${device.method}` : connected.length ? t("Select a connected device") : t("No device connected"),
    tone: connection.busy ? 'active' : device?.status === 'connected' ? 'success' : device?.status === 'offline' ? 'error' : device?.status === 'unauthorized' ? 'warning' : 'neutral',
    rows: device ? [
      { label: t("Device"), value: device.name },
      { label: t("Status"), value: state },
      { label: t("Transport"), value: device.method },
      { label: t("Serial / address"), value: device.serial },
      ...(device.status === 'unauthorized' ? [{ label: t("Required"), value: 'Allow USB debugging on the phone' }] : []),
    ] : [],
  }
  const sameDevice = !!device && apps.deviceId === device.id
  const profile = sameDevice ? apps.profiles.find(profile => profile.id === apps.userId) : undefined
  const listStatus = sameDevice ? apps.status : 'idle'
  const connectedTarget = device?.status === 'connected'
  const appsInfo: StatusInfo = {
    summary: listStatus === 'loading' ? t("Reading applications") : listStatus === 'error' ? t("Could not read applications") : listStatus === 'ready' ? connectedTarget ? t("Applications loaded") : t("Saved list · Device not connected") : t("Applications not read"),
    tone: listStatus === 'loading' ? 'active' : listStatus === 'error' ? 'error' : listStatus === 'ready' && connectedTarget ? 'success' : 'neutral',
    rows: [
      ...(device ? [{ label: t("Device"), value: device.name }] : []),
      { label: t("Profile"), value: sameDevice && apps.userId !== null ? `${profile?.name ?? t("Android profile")} · ID ${apps.userId}` : t("Not selected") },
      ...(listStatus === 'ready' ? [{ label: t("Applications"), value: `${apps.apps.length} loaded` }] : []),
      ...(sameDevice && apps.collectedAt ? [{ label: t("Updated"), value: new Date(apps.collectedAt).toLocaleString(uiLocale()) }] : []),
      ...(sameDevice && apps.locale ? [{ label: t("Names"), value: apps.locale }] : []),
      ...(listStatus === 'error' && apps.error ? [{ label: t("Error"), value: apps.error }] : []),
      ...(sameDevice && apps.backgroundUserId !== null ? [{ label: t("Background reading"), value: `Profile ID ${apps.backgroundUserId}` }] : []),
    ],
  }
  const selectedFastboot = fastboot.devices.find(d => d.serial === fastboot.selectedSerial)
  if (fastboot.selectedSerial) {
    connectionInfo.summary = fastboot.busy ? t("Fastboot operation") : selectedFastboot ? t("Fastboot · USB · Last detected") : t("Fastboot · Search again")
    connectionInfo.tone = fastboot.busy ? 'active' : fastboot.error ? 'warning' : 'neutral'
    connectionInfo.rows = [{ label: t("Serial"), value: fastboot.selectedSerial }, ...(fastboot.checkedAt ? [{ label: t("Last search"), value: new Date(fastboot.checkedAt).toLocaleString(uiLocale()) }] : [])]
  }
  const slots = [inspector.before, inspector.after], loading = slots.some(s => s.status === 'loading'), error = slots.some(s => s.status === 'error'), loaded = slots.filter(s => s.result).length
  if (loading || error || loaded) appsInfo.rows.push({ label: t("Local APKs"), value: loading ? t("Analysing") : error ? t("Inspection needs attention") : `${loaded} inspected` })
  if (loading) { appsInfo.tone = 'active'; appsInfo.summary = 'Analysing local APK' }
  return { components: componentInfo, connection: connectionInfo, apps: appsInfo }
}
