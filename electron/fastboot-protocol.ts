export const fastbootModes = ['android', 'bootloader', 'recovery', 'fastboot'] as const
export type FastbootMode = typeof fastbootModes[number]
export const fastbootModeLabels: Record<FastbootMode, string> = {
  android: 'Android', bootloader: 'Bootloader', recovery: 'Recovery', fastboot: 'Fastbootd',
}
export const fastbootFields = {
  product: 'Product', 'version-bootloader': 'Bootloader version',
  'is-userspace': 'Userspace fastboot', unlocked: 'Bootloader unlocked',
  secure: 'Bootloader secure flag', 'current-slot': 'Current slot',
  'battery-voltage': 'Battery voltage (mV)', 'battery-soc-ok': 'Battery sufficient',
} as const
export interface FastbootDevice {
  serial: string; usbPath: string; token: string
  fields: Partial<Record<keyof typeof fastbootFields, string>>
  issues: string[]; inspectedAt: string | null
}
export interface FastbootSnapshot {
  devices: FastbootDevice[]; busy: boolean; checkedAt: string | null
  error: string | null; message: string
}
export function validateFastbootTarget(serial: unknown, token: unknown) {
  if (typeof serial !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,255}$/.test(serial) || typeof token !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(token)) throw new Error('Select a detected Fastboot device again.')
}
export function validateFastbootMode(mode: unknown, confirmed: unknown): asserts mode is FastbootMode {
  if (!fastbootModes.includes(mode as FastbootMode)) throw new Error('Unsupported Fastboot action.')
  if (confirmed !== true) throw new Error('Confirm the Fastboot restart first.')
}
