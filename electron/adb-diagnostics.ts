import type { AdbDiagnostics, BackendEvent } from './contracts.js'
import { parseMdns } from './connections.js'
import { checked, run, type Runner } from './process.js'

export function parseServerStatus(output: string) {
  const fields: Record<string, string> = {}
  const allowed = new Set(['version', 'build', 'executable_absolute_path', 'log_absolute_path', 'usb_backend', 'mdns_backend', 'mdns_enabled', 'os'])
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([a-z_]+):\s*(.+)$/)
    if (!match || !allowed.has(match[1])) continue
    let value = match[2].trim()
    if (value.startsWith('"')) { try { value = JSON.parse(value) } catch { value = value.slice(1, -1) } }
    fields[match[1]] = value
  }
  return fields
}
export class AdbDiagnosticsService {
  state: AdbDiagnostics = { status: 'idle', collectedAt: null, executable: null, fields: {}, services: [], servicesAvailable: false, issues: [] }
  private pending?: Promise<void>
  constructor(private adbPath: () => string | null, private emit: (event: BackendEvent) => void, private runner: Runner = run) {}
  private publish() { this.emit({ type: 'adbDiagnostics', diagnostics: this.state }) }
  refresh() {
    if (!this.pending) this.pending = this.read().finally(() => { this.pending = undefined })
    return this.pending
  }
  private async read() {
    const executable = this.adbPath()
    this.state = { status: 'loading', collectedAt: null, executable, fields: {}, services: [], servicesAvailable: false, issues: [] }; this.publish()
    const result: AdbDiagnostics = { ...this.state, status: 'ready', fields: {}, issues: [] }
    if (!executable) result.issues.push({ check: 'ADB', message: 'Install or locate Platform Tools first.' })
    else {
      const checks = [['version'], ['server-status'], ['host-features'], ['mdns', 'check'], ['mdns', 'services']]
      const responses = await Promise.allSettled(checks.map(args => this.runner(executable, args, 6000).then(checked)))
      responses.forEach((response, index) => {
        const check = checks[index].join(' ')
        if (response.status === 'rejected') { result.issues.push({ check, message: String(response.reason instanceof Error ? response.reason.message : response.reason).slice(0, 1200) }); return }
        const output = response.value
        if (/unknown command|not supported|not available|disabled|failed|error:/i.test(output)) { result.issues.push({ check, message: output.slice(0, 1200) }); return }
        if (index === 0) {
          const protocol = output.match(/Android Debug Bridge version (\S+)/)?.[1]
          const version = output.match(/^Version (\S+)/m)?.[1]
          if (protocol) result.fields.protocol = protocol
          if (version) result.fields.clientVersion = version
          if (!protocol) result.issues.push({ check, message: 'Unrecognized ADB version response.' })
        } else if (index === 1) {
          const server = parseServerStatus(output)
          Object.assign(result.fields, server)
          if (Object.keys(server).length) result.fields.serverStatus = 'Responding'
          else result.issues.push({ check, message: 'Server status fields are unavailable in this ADB version.' })
        } else if (index === 2) result.fields.hostFeatures = output
        else if (index === 3) result.fields.mdnsCheck = output || 'No diagnostic output.'
        else {
          result.services = parseMdns(output)
          result.servicesAvailable = !!result.services.length || /List of discovered mdns services/i.test(output)
          if (!result.servicesAvailable) result.issues.push({ check, message: 'Unrecognized service discovery response.' })
        }
      })
    }
    if (this.adbPath() !== executable) {
      this.state = { status: 'idle', collectedAt: null, executable: this.adbPath(), fields: {}, services: [], servicesAvailable: false, issues: [] }; this.publish(); return
    }
    this.state = { ...result, collectedAt: new Date().toISOString() }; this.publish()
    this.emit({ type: 'activity', source: 'components', tone: result.issues.length ? 'warning' : 'success', text: `ADB diagnostics checked${result.issues.length ? ` with ${result.issues.length} unavailable checks` : ''}.` })
  }
}
