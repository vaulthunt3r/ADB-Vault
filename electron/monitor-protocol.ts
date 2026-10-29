export const monitorTabs = ['processes', 'memory', 'battery', 'network'] as const
export type MonitorTab = typeof monitorTabs[number]
export interface MonitorProcess { pid: number; name: string; cpu: number | null; rss: number | null }
export interface MonitorSample {
  id: string; tab: MonitorTab; time: number; issues: string[]
  cpu?: { total: number | null; window: string | null }
  processes?: MonitorProcess[]
  memory?: { total: number | null; available: number | null; free: number | null; cached: number | null; swapTotal: number | null; swapFree: number | null }
  battery?: { level: number | null; temperature: number | null; voltage: number | null; current: number | null; status: string | null; health: string | null; power: string[]; technology: string | null }
  network?: { interfaces: { name: string; received: number; sent: number }[]; addresses: string[]; uptime: number | null }
}
