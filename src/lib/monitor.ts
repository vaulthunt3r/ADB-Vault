import { t } from "./i18n"
import type { MonitorPoint } from '../store/useMonitorStore'
export function networkRate(points: MonitorPoint[], index: number, name: string, direction: 'received' | 'sent'): number | null {
  const now = points[index]?.sample, before = points[index - 1]?.sample
  if (!now?.network || !before?.network || now.id !== before.id) return null
  const elapsed = (now.time - before.time) / 1000, uptime = now.network.uptime, oldUptime = before.network.uptime
  if (elapsed <= 0 || elapsed > 120 || uptime === null || oldUptime === null || uptime <= oldUptime || Math.abs(uptime - oldUptime - elapsed) > 5) return null
  const a = now.network.interfaces.find(i => i.name === name), b = before.network.interfaces.find(i => i.name === name)
  if (!a || !b || a[direction] < b[direction]) return null
  return (a[direction] - b[direction]) / (uptime - oldUptime)
}
export function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return t("Unavailable")
  const unit = n >= 1024 ** 3 ? 3 : n >= 1024 ** 2 ? 2 : n >= 1024 ? 1 : 0
  return `${(n / 1024 ** unit).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${['B', 'KiB', 'MiB', 'GiB'][unit]}`
}
