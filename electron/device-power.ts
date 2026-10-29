export const devicePowerModes = ['restart', 'recovery', 'bootloader', 'fastboot', 'shutdown'] as const
export type DevicePowerMode = typeof devicePowerModes[number]
export const devicePowerLabels: Record<DevicePowerMode, string> = {
  restart: 'Restart Android', recovery: 'Restart to Recovery', bootloader: 'Restart to Bootloader / Fastboot', fastboot: 'Restart to Fastbootd', shutdown: 'Power off',
}
export function validateDevicePower(mode: unknown, confirmed: unknown): asserts mode is DevicePowerMode {
  if (!devicePowerModes.includes(mode as DevicePowerMode)) throw new Error('Unsupported device power action.')
  if (confirmed !== true) throw new Error('Confirm the device power action first.')
}
export function devicePowerCommand(mode: DevicePowerMode): string[] {
  switch (mode) {
    case 'restart': return ['reboot']
    case 'recovery': return ['reboot', 'recovery']
    case 'bootloader': return ['reboot', 'bootloader']
    case 'fastboot': return ['reboot', 'fastboot']
    case 'shutdown': return ['shell', 'svc', 'power', 'shutdown']
  }
}
