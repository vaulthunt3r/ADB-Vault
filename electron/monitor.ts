import type { ConnectionSnapshot } from './contracts.js'
import type { MonitorSample, MonitorTab, MonitorProcess } from './monitor-protocol.js'
import { run, checked, type Runner } from './process.js'

const number = (text: string | undefined): number | null => text !== undefined && text.trim() !== '' && Number.isFinite(Number(text)) ? Number(text) : null
export function parseMemory(text: string): NonNullable<MonitorSample['memory']> {
  const field = (key: string) => { const n = number(text.match(new RegExp(`^${key}:\\s+(\\d+)\\s+kB`, 'm'))?.[1]); return n === null ? null : n * 1024 }
  const total = field('MemTotal'), available = field('MemAvailable')
  return { total: total && total > 0 ? total : null, available: available !== null && total !== null && available <= total ? available : null, free: field('MemFree'), cached: field('Cached'), swapTotal: field('SwapTotal'), swapFree: field('SwapFree') }
}
export function parseProcesses(text: string): MonitorProcess[] {
  const lines = text.trim().split(/\r?\n/), header = lines.shift()?.trim().split(/\s+/) || []
  const pid = header.indexOf('PID'), rss = header.indexOf('RSS'), name = header.indexOf('NAME')
  if (pid < 0 || name < 0) return []
  return lines.flatMap(line => {
    const cols = line.trim().split(/\s+/), p = number(cols[pid]), memory = rss < 0 ? null : number(cols[rss])
    return p !== null && Number.isInteger(p) && p > 0 && cols[name] ? [{ pid: p, name: cols.slice(name).join(' '), rss: memory === null || memory < 0 ? null : memory * 1024, cpu: null }] : []
  })
}
export function parseCpu(text: string) {
  const value = number(text.match(/^\s*([\d.]+)%\s+TOTAL:/m)?.[1])
  const processes = new Map<number, { name: string; cpu: number }>()
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([\d.]+)%\s+(\d+)\/(.+?):\s/)
    if (match && Number.isFinite(Number(match[1]))) processes.set(Number(match[2]), { name: match[3], cpu: Number(match[1]) })
  }
  return { total: value !== null && value >= 0 && value <= 100 ? value : null, window: text.match(/^CPU usage from .+$/m)?.[0] || null, processes }
}
export function parseBattery(text: string, current: string): NonNullable<MonitorSample['battery']> {
  const field = (key: string) => text.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, 'm'))?.[1]?.trim()
  const level = number(field('level')), scale = number(field('scale')), temp = number(field('temperature')), voltage = number(field('voltage'))
  const rawCurrent = /^-?\d+$/.test(current.trim()) ? number(current.trim()) : null
  return {
    level: level !== null && scale !== null && scale > 0 && level >= 0 && level <= scale ? level / scale * 100 : null,
    temperature: temp === null ? null : temp / 10, voltage: voltage === null ? null : voltage / 1000,
    current: rawCurrent === null ? null : rawCurrent / 1000,
    status: ({ '1': 'Unknown', '2': 'Charging', '3': 'Discharging', '4': 'Not charging', '5': 'Full' } as Record<string, string>)[field('status') || ''] || null,
    health: ({ '1': 'Unknown', '2': 'Good', '3': 'Overheat', '4': 'Dead', '5': 'Over voltage', '6': 'Failure', '7': 'Cold' } as Record<string, string>)[field('health') || ''] || null,
    power: ['AC', 'USB', 'Wireless', 'Dock'].filter(key => field(`${key} powered`) === 'true'), technology: field('technology') || null,
  }
}
export function parseNetwork(text: string) {
  return text.split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\s*([^\s:]+):\s*(.+)$/)
    if (!match) return []
    const fields = match[2].trim().split(/\s+/), received = number(fields[0]), sent = number(fields[8])
    return fields.length >= 16 && received !== null && sent !== null && Number.isSafeInteger(received) && Number.isSafeInteger(sent) && received >= 0 && sent >= 0 ? [{ name: match[1], received, sent }] : []
  })
}

/** Read-only, on demand; no root prompt, background timer or connection recovery. */
export class MonitorService {
  private pending = false
  constructor(private adb: () => string | null, private connection: () => ConnectionSnapshot, private runner: Runner = run) {}
  async read(id: string, tab: MonitorTab): Promise<MonitorSample> {
    if (this.pending) throw new Error('A monitor sample is still being collected.')
    const executable = this.adb(), device = this.connection().devices.find(d => d.id === id && d.status === 'connected')
    if (!executable || !device || this.connection().activeDeviceId !== id) throw new Error('Select a connected device.')
    const serial = device.serial, transport = device.transportId
    const sameDevice = () => {
      const c = this.connection(), d = c.devices.find(d => d.id === id)
      return this.adb() === executable && c.activeDeviceId === id && d?.status === 'connected' && d.serial === serial && d.transportId === transport
    }
    const sample: MonitorSample = { id, tab, time: Date.now(), issues: [] }
    const read = async (label: string, command: string): Promise<string> => {
      try {
        if (!sameDevice()) throw new Error('Device connection changed.')
        return checked(await this.runner(executable, [...(transport ? ['-t', transport] : ['-s', serial]), 'shell', command], 8000, undefined, undefined, { maxOutputBytes: 1_000_000 }))
      } catch (error) { sample.issues.push(`${label}: ${error instanceof Error ? error.message : String(error)}`); return '' }
    }
    this.pending = true
    try {
      if (tab === 'processes') {
        const [ps, cpu] = await Promise.all([read('Processes', 'ps -A -o PID,RSS,NAME'), read('CPU', 'dumpsys cpuinfo')])
        sample.processes = parseProcesses(ps)
        const usage = parseCpu(cpu); sample.cpu = { total: usage.total, window: usage.window }
        for (const p of sample.processes) { const match = usage.processes.get(p.pid); if (match && (match.name === p.name || match.name.endsWith('/' + p.name))) p.cpu = match.cpu }
        if (!sample.processes.length) sample.issues.push('Process list unavailable: this Android version may restrict ps or use a different output format.')
        if (usage.total === null) sample.issues.push('CPU usage is not reported by Android.')
      } else if (tab === 'memory') {
        const [mem, ps] = await Promise.all([read('Memory', 'cat /proc/meminfo'), read('Processes', 'ps -A -o PID,RSS,NAME')])
        sample.memory = parseMemory(mem); sample.processes = parseProcesses(ps)
        if (sample.memory.total === null) sample.issues.push('Memory statistics are unavailable.')
        if (!sample.processes.length) sample.issues.push('Per-process memory is unavailable.')
      } else if (tab === 'battery') {
        const [battery, current] = await Promise.all([read('Battery', 'dumpsys battery'), read('Current', 'cat /sys/class/power_supply/battery/current_now')])
        sample.battery = parseBattery(battery, current)
        if (sample.battery.level === null) sample.issues.push('Battery level is unavailable.')
      } else {
        const [net, addresses, uptime] = await Promise.all([read('Network counters', 'cat /proc/net/dev'), read('Addresses', 'ip -o addr show'), read('Uptime', 'cat /proc/uptime')])
        sample.network = { interfaces: parseNetwork(net), addresses: addresses.split(/\r?\n/).filter(l => /^\d+:/.test(l)), uptime: number(uptime.trim().split(/\s+/)[0]) }
        if (!sample.network.interfaces.length) sample.issues.push('Interface traffic counters are unavailable to ADB on this device.')
      }
      if (!sameDevice()) throw new Error('Device connection changed; sample discarded.')
      sample.time = Date.now()
      return sample
    } finally { this.pending = false }
  }
}
