import type { RootCheck } from './contracts.js'
import type { CommandResult } from './process.js'

export type RootCommand = (command: string, timeout: number) => Promise<CommandResult>
// Passive detection never asks the root manager for access. A visible su binary is
// evidence of a root mechanism, not proof that Shell has permission to use it.
export async function probeDeviceRoot(command: RootCommand, requestAccess = false): Promise<RootCheck> {
  const result = (status: RootCheck['status'], message: string, method?: 'adb' | 'su'): RootCheck => ({ status, message, checkedAt: new Date().toISOString(), method })
  let method: 'adb' | 'su' | undefined
  try {
    const identity = await command('id -u', 6000)
    if (identity.code !== 0 || !/^\d+$/.test(identity.stdout.trim())) throw new Error('Could not read the ADB shell identity.')
    if (identity.stdout.trim() === '0') return result('available', 'ADB shell already has root access on this device.', 'adb')
    const detection = await command('if command -v su >/dev/null 2>&1; then echo ADB_VAULT_SU_FOUND; else echo ADB_VAULT_SU_MISSING; fi', 6000)
    if (detection.code !== 0) throw new Error('Could not check for root on this device.')
    if (detection.stdout.trim() === 'ADB_VAULT_SU_MISSING') return result('not-detected', 'Root was not detected by ADB. Internal data and cache backup require root on the phone. Root hidden from Shell cannot be detected.')
    if (detection.stdout.trim() !== 'ADB_VAULT_SU_FOUND') throw new Error('Unexpected response while checking root.')
    method = 'su'
    if (!requestAccess) return result('detected', 'A root command was found. Check access to verify permission for Shell/ADB.', 'su')
    const access = await command('su -c id', 20000)
    if (access.code === 0 && /^uid=0\b/.test(access.stdout.trim())) return result('available', 'Root access for Shell/ADB was confirmed on this device.', 'su')
    if (/permission denied|access denied|not allowed|denied|not permitted/i.test(`${access.stderr}\n${access.stdout}`) || access.code === 0 && /^uid=\d+\b/.test(access.stdout.trim())) return result('denied', 'Root was detected, but Shell/ADB was not granted access. Allow it in the phone\'s root manager, then check again.', 'su')
    return result('error', 'Root was detected, but access could not be verified. Check the phone and try again.', 'su')
  } catch (error) {
    return result('error', /timed out/i.test(String(error)) ? 'Root check timed out. Check the phone for an access prompt and try again.' : 'Could not check root. Check the device connection and try again.', method)
  }
}
