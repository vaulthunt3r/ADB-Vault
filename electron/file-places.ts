import type { DeviceRecord } from './contracts.js'
import type { FileLocation } from './files-protocol.js'

export function savedFileLocation(location: FileLocation, devices: DeviceRecord[] = []): FileLocation {
  const { transportId: _transport, ...saved } = location
  const device = matchingDevice(location, devices)
  return { ...saved, root: false, ...(device?.hardwareId ? { hardwareId: device.hardwareId } : {}) }
}

export const bookmarkKey = (l: FileLocation) => JSON.stringify([l.kind, l.kind === 'device' ? l.hardwareId || l.id || l.serial : '', l.kind === 'local' ? l.path.replace(/\\+$/, '').toLowerCase() : l.path.replace(/\/+$/, '') || '/'])

function matchingDevice(location: FileLocation, devices: DeviceRecord[]) {
  if (location.kind !== 'device') return undefined
  return location.hardwareId
    ? devices.find(d => d.hardwareId === location.hardwareId)
    : devices.find(d => d.id === location.id && (d.serial === location.serial || d.aliases?.includes(location.serial || '')))
      || devices.find(d => d.serial === location.serial || d.aliases?.includes(location.serial || ''))
}

export function resolveSavedFileLocation(location: FileLocation, devices: DeviceRecord[]): FileLocation {
  if (location.kind === 'local') return { ...location, root: false }
  const connected = devices.filter(d => ['connected', 'recovery'].includes(d.status))
  const device = matchingDevice(location, connected)
  if (!device) throw new Error('The phone for this saved location is not connected. Connect that phone and try again.')
  return { ...location, id: device.id, serial: device.serial, transportId: device.transportId, hardwareId: device.hardwareId, root: false }
}

/** Resolve only a new, explicit read. Never use this to redirect an in-flight task. */
export function resolveFileReadLocation(location: FileLocation, devices: DeviceRecord[]): FileLocation {
  if (location.kind === 'local') return location
  // Older Files tabs did not store hardwareId, but Wi-Fi group IDs already
  // contain the identity verified by ConnectionService (wifi:<ro.serialno>).
  const identity = location.hardwareId || (location.id?.startsWith('wifi:') ? location.id.slice(5) : undefined)
  const connected = devices.filter(d => ['connected', 'recovery'].includes(d.status))
  const exact = connected.filter(d => d.id === location.id && d.serial === location.serial && d.transportId === location.transportId && (!identity || d.hardwareId === identity))
  let candidates = exact
  if (!candidates.length && identity) {
    candidates = connected.filter(d => d.hardwareId === identity)
    const sameSource = candidates.filter(d => d.id === location.id)
    if (sameSource.length) candidates = sameSource
  }
  if (!candidates.length && !identity) candidates = connected.filter(d => d.method === 'USB' && d.id === location.id && d.serial === location.serial)
  if (candidates.length !== 1) throw new Error('The original phone is unavailable or its identity cannot be confirmed. Select that phone in Files and refresh its folder.')
  const device = candidates[0]
  return { ...location, id: device.id, serial: device.serial, transportId: device.transportId, hardwareId: device.hardwareId }
}
