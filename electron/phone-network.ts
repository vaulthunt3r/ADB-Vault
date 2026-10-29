import { isIP } from 'node:net'
import type { ConnectionSnapshot } from './contracts.js'
import type { GeoIpService } from './geoip.js'
import { run, type Runner } from './process.js'
import type { NetworkTarget, PhoneConnections, PhoneSocket, PhoneTrace, TraceHop } from './network-protocol.js'

export function validateNetworkTarget(input: unknown): asserts input is NetworkTarget {
  const target = input as NetworkTarget | undefined
  if (!target || typeof target !== 'object' || ['id', 'serial'].some(k => typeof target[k as 'id'] !== 'string' || !target[k as 'id'] || target[k as 'id'].length > 512 || /[\x00-\x1f]/.test(target[k as 'id']))) throw new Error('Invalid phone identity.')
  if (target.transportId !== undefined && (typeof target.transportId !== 'string' || !/^\d+$/.test(target.transportId))) throw new Error('Invalid phone transport.')
}
export function validateTraceAddress(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.includes('%') || !isIP(value)) throw new Error('Choose a numeric IPv4 or IPv6 address.')
  if (['0.0.0.0', '::'].includes(value)) throw new Error('This socket has no destination address.')
}
const tcpStates: Record<string, string> = { '01': 'Established', '02': 'SYN sent', '03': 'SYN received', '04': 'FIN wait 1', '05': 'FIN wait 2', '06': 'Time wait', '07': 'Closed', '08': 'Close wait', '09': 'Last ACK', '0A': 'Listen', '0B': 'Closing', '0C': 'New SYN received' }
function endpoint(value: string, family: 4 | 6) {
  const [hex, port] = value.split(':')
  if (!(family === 4 ? /^[A-F\d]{8}$/i : /^[A-F\d]{32}$/i).test(hex) || !/^[A-F\d]{4}$/i.test(port)) throw new Error('Invalid socket endpoint.')
  // Android's supported ARM and x86 ABIs store each /proc address word little-endian.
  const words = hex.match(/.{8}/g)!.map(word => word.match(/../g)!.reverse().join(''))
  const address = family === 4 ? words[0].match(/../g)!.map(v => parseInt(v, 16)).join('.') : new URL(`http://[${words.join('').match(/.{4}/g)!.join(':')}]/`).hostname.slice(1, -1)
  return { address, port: parseInt(port, 16) }
}
export function parseSocketTable(text: string, protocol: 'TCP' | 'UDP', family: 4 | 6): PhoneSocket[] {
  const lines = text.trim().split(/\r?\n/)
  if (!/local_address\s+rem(?:ote)?_address/.test(lines[0] || '')) throw new Error('Socket table unavailable or unreadable.')
  const sockets: PhoneSocket[] = []
  for (const line of lines.slice(1)) {
    const fields = line.trim().split(/\s+/)
    if (!line.trim()) continue
    if (fields.length < 10 || !/^\d+:$/.test(fields[0]) || !/^\d+$/.test(fields[7]) || !/^[A-F\d]{2}$/i.test(fields[3])) throw new Error('Incomplete socket table; retry the reading.')
    const local = endpoint(fields[1], family), remote = endpoint(fields[2], family), uid = Number(fields[7])
    if (!Number.isSafeInteger(uid)) throw new Error('Invalid socket UID.')
    sockets.push({ key: `${protocol}/${family}/${fields[1]}/${fields[2]}/${uid}/${fields[9]}`, protocol, family, localAddress: local.address, localPort: local.port, remoteAddress: remote.address, remotePort: remote.port, uid, userId: Math.floor(uid / 100000), state: protocol === 'UDP' && fields[3] === '07' ? 'Unconnected' : tcpStates[fields[3].toUpperCase()] || fields[3], packages: [], ip: { scope: '' } })
  }
  return sockets
}
export function parsePackageUids(text: string): Map<number, string[]> {
  const result = new Map<number, string[]>()
  for (const line of text.split(/\r?\n/)) {
    // With --user all, PackageManager emits a comma-separated UID for each
    // profile containing this package (e.g. uid:10202,1110202).
    const match = /^package:([\w.]+)\s+uid:(\d+(?:,\s*\d+)*)\s*$/.exec(line.trim())
    if (!match) continue
    for (const value of match[2].split(',')) {
      const uid = Number(value)
      if (!Number.isSafeInteger(uid) || uid > 0xffffffff) continue
      const list = result.get(uid) || []
      if (!list.includes(match[1])) list.push(match[1])
      result.set(uid, list)
    }
  }
  return result
}
export function parseTrace(text: string): TraceHop[] {
  return text.split(/\r?\n/).flatMap(line => {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line)
    if (!match || +match[1] < 1 || +match[1] > 16) return []
    const address = match[2].split(/\s+/).find(part => !!isIP(part)) || null
    const latency = /([\d.]+)\s*ms\b/.exec(match[2])
    return [{ ttl: +match[1], address, milliseconds: latency ? Number(latency[1]) : null }]
  })
}

export class PhoneNetworkService {
  private current?: { id: string; target: NetworkTarget; controller: AbortController; done: Promise<unknown> }
  private packageCache?: { key: string; time: number; packages: Map<number, string[]> }
  constructor(private adb: () => string | null, private connection: () => ConnectionSnapshot, private geoip: GeoIpService, private runner: Runner = run) {}
  get busy() { return !!this.current }
  private assertTarget(target: NetworkTarget) {
    const state = this.connection(), device = state.devices.find(d => d.id === target.id)
    if (state.activeDeviceId !== target.id || device?.status !== 'connected' || device.serial !== target.serial || device.transportId !== target.transportId) throw new Error('The phone connection changed. Refresh the selected phone before retrying.')
  }
  contextChanged() { if (this.current) { try { this.assertTarget(this.current.target) } catch { this.current.controller.abort() } } }
  async cancel(id: string) { if (this.current?.id === id) { this.current.controller.abort(); await this.current.done.catch(() => {}) } }
  async shutdown() { this.current?.controller.abort(); await this.current?.done.catch(() => {}) }
  private async operation<T>(id: string, target: NetworkTarget, action: (shell: (command: string, timeout?: number) => ReturnType<Runner>, signal: AbortSignal) => Promise<T>): Promise<T> {
    validateNetworkTarget(target)
    this.assertTarget(target)
    if (this.current) throw new Error('A phone network reading is still running.')
    const executable = this.adb()
    if (!executable) throw new Error('Install or locate ADB first.')
    const controller = new AbortController(), pinned = { ...target }
    const shell = async (command: string, timeout = 8000) => {
      this.assertTarget(pinned)
      if (controller.signal.aborted) throw new Error('Network operation cancelled.')
      const result = await this.runner(executable, [...(pinned.transportId ? ['-t', pinned.transportId] : ['-s', pinned.serial]), 'shell', command], timeout, undefined, undefined, { signal: controller.signal, maxOutputBytes: 2 * 1024 * 1024 })
      this.assertTarget(pinned)
      if (controller.signal.aborted) throw new Error('Network operation cancelled.')
      return result
    }
    const done = Promise.resolve().then(() => action(shell, controller.signal))
    this.current = { id, target: pinned, controller, done }
    try { const result = await done; this.assertTarget(pinned); if (controller.signal.aborted) throw new Error('Network operation cancelled.'); return result }
    finally { if (this.current?.id === id) this.current = undefined }
  }
  connections(target: NetworkTarget, id: string): Promise<PhoneConnections> {
    return this.operation(id, target, async (shell, signal) => {
      const issues: string[] = [], sockets: PhoneSocket[] = []
      for (const [protocol, family, file] of [['TCP', 4, 'tcp'], ['TCP', 6, 'tcp6'], ['UDP', 4, 'udp'], ['UDP', 6, 'udp6']] as const) {
        try {
          const result = await shell(`cat /proc/net/${file}`)
          if (result.code) throw new Error((result.stderr || result.stdout || 'Access denied').trim().slice(0, 400))
          sockets.push(...parseSocketTable(result.stdout, protocol, family))
        } catch (error) { if (signal.aborted) throw error; this.assertTarget(target); issues.push(`${protocol} IPv${family}: ${error instanceof Error ? error.message : error}`) }
      }
      const key = JSON.stringify(target)
      let packages = this.packageCache?.key === key && Date.now() - this.packageCache.time < 60000 ? this.packageCache.packages : undefined
      if (!packages && sockets.length) {
        try {
          const result = await shell('cmd package list packages -U --user all')
          if (result.code || !result.stdout.includes('package:')) throw new Error((result.stderr || result.stdout || 'Package UIDs unavailable').slice(0, 400))
          packages = parsePackageUids(result.stdout)
          if (!packages.size) throw new Error('Package UIDs unavailable.')
          this.packageCache = { key, time: Date.now(), packages }
        } catch (error) { if (signal.aborted) throw error; this.assertTarget(target); issues.push(`App attribution unavailable: ${error instanceof Error ? error.message : error}`) }
      }
      if (sockets.length > 5000) issues.push('Showing the first 5,000 sockets; narrow the active applications on the phone.')
      return { target, time: Date.now(), sockets: sockets.slice(0, 5000).map(s => ({ ...s, packages: packages?.get(s.uid) || [], ip: this.geoip.lookup(s.remoteAddress) })), issues, geoip: this.geoip.record.status === 'Detected' ? this.geoip.record.version : 'GeoIP not loaded' }
    })
  }
  trace(target: NetworkTarget, id: string, address: string): Promise<PhoneTrace> {
    validateTraceAddress(address)
    return this.operation(id, target, async (shell, signal) => {
      // Fixed command and numeric-only address. Never fall back to a host-side traceroute.
      const args = `${isIP(address) === 6 ? '-6 ' : ''}-n -m 16 -q 1 -w 1 ${address}`
      const command = `traceroute ${args}`
      let output = '', code = 1
      try {
        let result = await shell(command, 25000)
        // Some Android builds include the applet but omit /system/bin/traceroute.
        if (result.code && /(?:not found|inaccessible|No such file)/i.test(result.stderr + result.stdout)) result = await shell(`toybox traceroute ${args}`, 25000)
        output = [result.stdout, result.stderr].filter(Boolean).join('\n').slice(0, 64000); code = result.code
      }
      catch (error) {
        if (signal.aborted) throw error
        this.assertTarget(target)
        const partial = (error as { commandResult?: { stdout?: string; stderr?: string } }).commandResult
        output = [partial?.stdout, partial?.stderr, error instanceof Error ? error.message : String(error)].filter(Boolean).join('\n').slice(0, 64000)
      }
      const hops = parseTrace(output).map(hop => ({ ...hop, ip: hop.address ? this.geoip.lookup(hop.address) : undefined }))
      const canonical = (ip: string) => isIP(ip) === 6 ? new URL(`http://[${ip}]/`).hostname : ip
      const reached = hops.some(hop => hop.address && canonical(hop.address) === canonical(address))
      const denied = /(?:Operation not permitted|Permission denied)/i.test(output)
      return { target, address, time: Date.now(), hops, output, status: reached ? 'complete' : hops.length ? 'partial' : 'unavailable', message: reached ? 'The destination replied to the route check.' : hops.length ? 'The destination did not reply within 16 network hops. An asterisk means that hop did not reply; it does not necessarily mean the connection is broken.' : denied ? 'Route check is unavailable: Android blocked the diagnostic command. This check currently runs without root. You can still view connections and IP information.' : code ? 'Route check could not run on this phone. Open Technical details to see Android’s response.' : 'No network hops replied to the route check.' }
    })
  }
}
