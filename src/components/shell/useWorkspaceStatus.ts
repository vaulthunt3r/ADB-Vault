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
    summary: working.length ? "Checking / preparing components" : !adb || !available(adb) ? "ADB is not ready" : issues.length ? "ADB ready · Some components need attention" : updates.length ? "ADB ready · Updates available" : "ADB ready",
    tone: working.length ? 'active' : !adb || !available(adb) ? 'error' : issues.length || updates.length ? 'warning' : 'success',
    rows: [
      { label: "ADB", value: adb ? `${statusLabel(adb.status)}${available(adb) ? ` · ${adb.version}` : ''}` : "Not found" },
      { label: "Other components", value: `${optional.filter(available).length} of ${optional.length} ready` },
      ...working.map(component => ({ label: component.name, value: component.status })),
      ...issues.filter(component => component.id !== 'adb' && !isBusy(component.status)).map(component => ({ label: component.name, value: statusLabel(settledStatus(component)) })),
      ...(updates.length ? [{ label: "Updates", value: updates.map(component => component.name).join(', ') }] : []),
    ],
  }
  const connected = connection.devices.filter(device => device.status === 'connected')
  const device = connection.devices.find(device => device.id === connection.activeDeviceId) ?? connection.devices.find(device => device.id === connection.selectedDeviceId)
  const state = device ? device.status[0].toUpperCase() + device.status.slice(1) : "No device connected"
  const connectionInfo: StatusInfo = {
    summary: connection.busy ? "Connecting device" : device ? `${state} · ${device.method}` : connected.length ? "Select a connected device" : "No device connected",
    tone: connection.busy ? 'active' : device?.status === 'connected' ? 'success' : device?.status === 'offline' ? 'error' : device?.status === 'unauthorized' ? 'warning' : 'neutral',
    rows: device ? [
      { label: "Device", value: device.name },
      { label: "Status", value: state },
      { label: "Transport", value: device.method },
      { label: "Serial / address", value: device.serial },
      ...(device.status === 'unauthorized' ? [{ label: "Required", value: 'Allow USB debugging on the phone' }] : []),
    ] : [],
  }
  const sameDevice = !!device && apps.deviceId === device.id
  const profile = sameDevice ? apps.profiles.find(profile => profile.id === apps.userId) : undefined
  const listStatus = sameDevice ? apps.status : 'idle'
  const connectedTarget = device?.status === 'connected'
  const appsInfo: StatusInfo = {
    summary: listStatus === 'loading' ? "Reading applications" : listStatus === 'error' ? "Could not read applications" : listStatus === 'ready' ? connectedTarget ? "Applications loaded" : "Saved list · Device not connected" : "Applications not read",
    tone: listStatus === 'loading' ? 'active' : listStatus === 'error' ? 'error' : listStatus === 'ready' && connectedTarget ? 'success' : 'neutral',
    rows: [
      ...(device ? [{ label: "Device", value: device.name }] : []),
      { label: "Profile", value: sameDevice && apps.userId !== null ? `${profile?.name ?? "Android profile"} · ID ${apps.userId}` : "Not selected" },
      ...(listStatus === 'ready' ? [{ label: "Applications", value: `${apps.apps.length} loaded` }] : []),
      ...(sameDevice && apps.collectedAt ? [{ label: "Updated", value: new Date(apps.collectedAt).toLocaleString('en-US') }] : []),
      ...(sameDevice && apps.locale ? [{ label: "Names", value: apps.locale }] : []),
      ...(listStatus === 'error' && apps.error ? [{ label: "Error", value: apps.error }] : []),
      ...(sameDevice && apps.backgroundUserId !== null ? [{ label: "Background reading", value: `Profile ID ${apps.backgroundUserId}` }] : []),
    ],
  }
  const selectedFastboot = fastboot.devices.find(d => d.serial === fastboot.selectedSerial)
  if (fastboot.selectedSerial) {
    connectionInfo.summary = fastboot.busy ? "Fastboot operation" : selectedFastboot ? "Fastboot · USB · Last detected" : "Fastboot · Search again"
    connectionInfo.tone = fastboot.busy ? 'active' : fastboot.error ? 'warning' : 'neutral'
    connectionInfo.rows = [{ label: "Serial", value: fastboot.selectedSerial }, ...(fastboot.checkedAt ? [{ label: "Last search", value: new Date(fastboot.checkedAt).toLocaleString('en-US') }] : [])]
  }
  const slots = [inspector.before, inspector.after], loading = slots.some(s => s.status === 'loading'), error = slots.some(s => s.status === 'error'), loaded = slots.filter(s => s.result).length
  if (loading || error || loaded) appsInfo.rows.push({ label: "Local APKs", value: loading ? "Analysing" : error ? "Inspection needs attention" : `${loaded} inspected` })
  if (loading) { appsInfo.tone = 'active'; appsInfo.summary = 'Analysing local APK' }
  return { components: componentInfo, connection: connectionInfo, apps: appsInfo }
}
