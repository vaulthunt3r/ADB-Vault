import type { DeviceInfo } from './contracts.js'

export function parseDeviceInfo(output: string): DeviceInfo['fields'] {
  const properties = new Map<string, string>()
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\[([^\]]+)\]: \[(.*)\]$/)
    if (match && match[2].trim() && !/^(unknown|null)$/i.test(match[2].trim())) properties.set(match[1], match[2].trim())
  }
  const keys: Record<keyof DeviceInfo['fields'], string[]> = {
    manufacturer: ['ro.product.manufacturer'], model: ['ro.product.model'], product: ['ro.product.name'], codename: ['ro.product.device'],
    android: ['ro.build.version.release'], sdk: ['ro.build.version.sdk'], securityPatch: ['ro.build.version.security_patch'],
    build: ['ro.build.display.id', 'ro.build.id'], fingerprint: ['ro.build.fingerprint'], abis: ['ro.product.cpu.abilist', 'ro.product.cpu.abi'],
    socModel: ['ro.soc.model'], socManufacturer: ['ro.soc.manufacturer'], board: ['ro.product.board'], hardware: ['ro.hardware'],
    bootloader: ['ro.bootloader'], baseband: ['gsm.version.baseband'], buildDate: ['ro.build.date'],
    buildType: ['ro.build.type'], buildTags: ['ro.build.tags'], verifiedBoot: ['ro.boot.verifiedbootstate'],
    bootloaderState: ['ro.boot.flash.locked', 'ro.boot.vbmeta.device_state'], slot: ['ro.boot.slot_suffix', 'ro.boot.slot'],
  }
  const fields: DeviceInfo['fields'] = {}
  for (const [field, candidates] of Object.entries(keys)) {
    const value = candidates.map(key => properties.get(key)).find(Boolean)
    if (value) fields[field as keyof DeviceInfo['fields']] = value
  }
  const seconds = properties.get('ro.build.date.utc')
  if (seconds && /^\d{1,12}$/.test(seconds) && Number(seconds) > 0) {
    const date = new Date(Number(seconds) * 1000)
    if (Number.isFinite(date.getTime())) fields.buildDate = date.toISOString()
  }
  if (fields.bootloaderState) {
    const states = new Map([['1', 'locked'], ['0', 'unlocked'], ['locked', 'locked'], ['unlocked', 'unlocked']])
    fields.bootloaderState = keys.bootloaderState.map(key => states.get(properties.get(key)?.toLowerCase() || '')).find(Boolean)
  }
  if (fields.slot && /^_?[ab]$/i.test(fields.slot)) fields.slot = fields.slot.replace(/^_/, '').toUpperCase()
  return fields
}
