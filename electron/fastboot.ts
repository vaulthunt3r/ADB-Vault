import { randomUUID } from 'node:crypto'
import type { BackendEvent } from './contracts.js'
import { checked, run, type Runner, type CommandResult } from './process.js'
import { fastbootFields, fastbootModeLabels, validateFastbootMode, validateFastbootTarget, type FastbootMode, type FastbootDevice, type FastbootSnapshot } from './fastboot-protocol.js'

export function parseFastbootDevices(output: string) {
  return output.split(/\r?\n/).flatMap(line => {
    const match = line.trim().match(/^([a-zA-Z0-9][a-zA-Z0-9._-]{0,255})\s+fastboot(?:d)?(?:\s+(.*))?$/)
    return match ? [{ serial: match[1], usbPath: match[2]?.trim().replace(/^usb:/, '') || '' }] : []
  })
}
export function fastbootVariable(result: CommandResult, name: string) {
  const output = [result.stdout, result.stderr].join('\n')
  if (result.code !== 0 || /\bFAILED\b|fastboot: error:/i.test(output)) throw new Error(output.trim().slice(0, 500) || 'Not reported by this device.')
  const value = output.split(/\r?\n/).map(line => line.replace(/^\s*\((?:bootloader|fastbootd?)\)\s*/, '').trim()).find(line => line.startsWith(`${name}:`))?.slice(name.length + 1).trim()
  if (!value) throw new Error('Not reported by this device.')
  return value.slice(0, 500)
}

/** On-demand USB Fastboot operations, independent of the ADB device poller. */
export class FastbootService {
  state: FastbootSnapshot = { devices: [], busy: false, checkedAt: null, error: null, message: '' }
  private controller = new AbortController()
  private pending?: Promise<CommandResult>
  constructor(private executable: () => string | null, private emit: (event: BackendEvent) => void, private runner: Runner = run) {}
  private publish() { this.emit({ type: 'fastboot', state: structuredClone(this.state) }) }
  private command(file: string, args: string[], timeout = 5000) {
    if (this.controller.signal.aborted) throw new Error('ADB Vault is closing.')
    this.pending = this.runner(file, args, timeout, undefined, undefined, { signal: this.controller.signal, maxOutputBytes: 64000 })
    return this.pending
  }
  async shutdown() { this.controller.abort(); await this.pending?.catch(() => {}) }
  private async operation(work: (file: string) => Promise<void>, serial?: string) {
    if (this.state.busy) throw new Error('Wait for the current Fastboot operation.')
    const file = this.executable()
    if (!file) throw new Error('Install or locate Fastboot in Components first.')
    this.state.busy = true; this.state.error = null; this.state.message = ''; this.publish()
    try { await work(file) }
    catch (error) {
      this.state.error = error instanceof Error ? error.message : String(error)
      this.emit({ type: 'activity', source: 'connection', device: serial, tone: 'warning', text: `Fastboot: ${this.state.error}` })
      throw error
    } finally { this.state.busy = false; this.publish() }
  }
  async scan() {
    await this.operation(async file => {
      // Clear stale evidence even when enumeration fails.
      this.state.devices = []; this.state.checkedAt = null
      const found = parseFastbootDevices(checked(await this.command(file, ['devices', '-l'])))
      this.state.devices = found.filter(d => found.filter(other => other.serial === d.serial).length === 1).map(d => ({ ...d, token: randomUUID(), fields: {}, issues: [], inspectedAt: null }))
      this.state.checkedAt = new Date().toISOString()
      this.state.message = found.length !== this.state.devices.length ? 'Duplicate serial numbers detected. Connect only one of those devices and search again.' : this.state.devices.length ? `${this.state.devices.length} Fastboot device(s) detected over USB.` : 'No Fastboot devices found. Connect a phone in Bootloader / Fastbootd by USB; its Windows driver may differ from ADB.'
      this.emit({ type: 'activity', source: 'connection', tone: 'info', text: this.state.message })
    })
  }
  private async target(file: string, serial: string, token: string): Promise<FastbootDevice> {
    validateFastbootTarget(serial, token)
    const saved = this.state.devices.find(d => d.serial === serial && d.token === token)
    if (!saved) throw new Error('Fastboot selection changed. Search and select the device again.')
    const found = parseFastbootDevices(checked(await this.command(file, ['devices', '-l']))).filter(d => d.serial === serial)
    if (found.length !== 1 || found[0].usbPath !== saved.usbPath) {
      this.state.devices = this.state.devices.filter(d => d !== saved)
      throw new Error('The selected Fastboot connection changed or disappeared. Search again.')
    }
    return saved
  }
  async inspect(serial: string, token: string) {
    await this.operation(async file => {
      const device = await this.target(file, serial, token)
      device.fields = {}; device.issues = []; device.inspectedAt = null
      for (const field of Object.keys(fastbootFields) as (keyof typeof fastbootFields)[]) {
        // Unsupported variables are expected; transport/time-out errors stop collection.
        const result = await this.command(file, ['-s', serial, 'getvar', field], 3000)
        if (/failed to (?:read|write)|device disconnected|no devices|status read failed|usb (?:read|write) error/i.test(`${result.stdout}\n${result.stderr}`)) {
          this.state.devices = this.state.devices.filter(d => d !== device)
          throw new Error('Fastboot communication was interrupted. Search for the device again.')
        }
        try { device.fields[field] = fastbootVariable(result, field) }
        catch (error) { device.issues.push(`${fastbootFields[field]}: ${error instanceof Error ? error.message : String(error)}`) }
      }
      device.inspectedAt = new Date().toISOString()
      this.emit({ type: 'activity', source: 'connection', device: serial, tone: 'info', text: `Fastboot: read device information for ${serial}${device.issues.length ? `; ${device.issues.length} fields unavailable` : ''}.` })
    }, serial)
  }
  async reboot(serial: string, token: string, mode: FastbootMode, confirmed: boolean) {
    validateFastbootMode(mode, confirmed)
    await this.operation(async file => {
      await this.target(file, serial, token)
      try {
        const result = await this.command(file, ['-s', serial, 'reboot', ...(mode === 'android' ? [] : [mode])], mode === 'fastboot' ? 30000 : 10000)
        const output = [result.stdout, result.stderr].join('\n')
        checked(result)
        if (/\bFAILED\b|fastboot: error:/i.test(output)) throw new Error(output.trim().slice(0, 600))
      } catch (error) {
        throw new Error(`${error instanceof Error ? error.message : String(error)} Check the phone before trying again; no retry was sent.`)
      } finally {
        // The command may have taken effect even if its reply was lost.
        this.state.devices = this.state.devices.filter(d => d.serial !== serial)
      }
      this.state.message = `Restart to ${fastbootModeLabels[mode]} requested for ${serial}. Wait for the phone; search again for Fastboot or reconnect ADB after Android starts.`
      this.emit({ type: 'activity', source: 'connection', device: serial, tone: 'info', text: this.state.message })
    }, serial)
  }
}
