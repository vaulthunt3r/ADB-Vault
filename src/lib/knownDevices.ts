import type { DeviceRecord } from '../../electron/contracts'

export function orderedKnownDevices(devices: DeviceRecord[], activeId: string | null) {
  const rank = (d: DeviceRecord) => d.id === activeId && d.status === 'connected' ? 0 : d.status === 'connected' ? 1 : 2
  // Keep existing order within each group: polling timestamps must not reshuffle rows.
  return devices.filter(d => d.known).sort((a, b) => rank(a) - rank(b))
}
