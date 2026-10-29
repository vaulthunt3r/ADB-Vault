export interface ConsoleTarget { id: string; serial: string; transportId?: string }
export type ConsoleMode = 'adb' | 'shell'
export interface ConsoleCommand { mode: ConsoleMode; command: string }
export interface ConsoleRun extends ConsoleCommand {
  id: string; target: ConsoleTarget; deviceName: string
  status: 'running' | 'stopping' | 'success' | 'error' | 'cancelled'
  startedAt: string; endedAt?: string; exitCode: number | null
  output: { stream: 'stdout' | 'stderr'; text: string }[]
  truncated: boolean; message: string
}
export interface AdbConsoleState { revision: number; run: ConsoleRun | null; history: ConsoleCommand[] }
export type AdbConsoleRequest =
  | { type: 'console.run'; target: ConsoleTarget; mode: ConsoleMode; command: string; timeout: number }
  | { type: 'console.stop'; id: string }
  | { type: 'console.clear' }

export function validateConsoleRun(value: unknown): asserts value is Extract<AdbConsoleRequest, { type: 'console.run' }> {
  const r = value as Extract<AdbConsoleRequest, { type: 'console.run' }> | undefined
  if (!r || !['adb', 'shell'].includes(r.mode)) throw new Error('Choose ADB or Android shell.')
  if (typeof r.command !== 'string' || !r.command.trim() || r.command.length > 8192 || /[\x00-\x08\x0b-\x1f\x7f]/.test(r.command)) throw new Error('Enter a command (up to 8192 characters).')
  if (![30000, 120000, 600000].includes(r.timeout)) throw new Error('Choose a supported time limit.')
  const t = r.target
  if (!t || typeof t !== 'object' || ['id', 'serial'].some(k => {
    const v = t[k as 'id' | 'serial']
    return typeof v !== 'string' || !v || v.length > 512 || /[\x00-\x1f]/.test(v)
  })) throw new Error('Choose a connected phone.')
  if (t.transportId !== undefined && (typeof t.transportId !== 'string' || !/^\d+$/.test(t.transportId))) throw new Error('Invalid device transport.')
}
