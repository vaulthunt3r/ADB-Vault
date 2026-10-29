import { randomBytes } from 'node:crypto'
import { isIP } from 'node:net'
import type { BackendEvent, ConnectionSnapshot, DeviceRecord } from './contracts.js'
import { Storage } from './storage.js'
import { checked, run, type Runner } from './process.js'
import { probeDeviceRoot } from './device-root.js'
import { parseDeviceInfo } from './device-info.js'
import { devicePowerCommand, devicePowerLabels, validateDevicePower, type DevicePowerMode } from './device-power.js'

export function endpoint(host: string, port: string) {
  if (!isIP(host) || !/^\d{1,5}$/.test(port) || +port < 1 || +port > 65535) throw new Error('Enter an IP address and a port between 1 and 65535.')
  return `${isIP(host) === 6 ? `[${host}]` : host}:${+port}`
}
function numericAddress(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const parts = value.match(/^(?:\[([^\]]+)\]|([^:]+)):(\d+)$/)
  if (!parts) return undefined
  try { return endpoint(parts[1] || parts[2], parts[3]) } catch { return undefined }
}
function validIdentity(value: unknown): value is string {
  return typeof value === 'string' && !/^(unknown|null|0)$/i.test(value) && /^[\w.-]{4,128}$/.test(value)
}
function savedWirelessAddress(device?: DeviceRecord) {
  const saved = device?.lastWirelessAddress
  return saved && saved.hardwareId === device?.hardwareId && validIdentity(saved.hardwareId) && numericAddress(saved.address) && Number.isFinite(Date.parse(saved.verifiedAt)) ? saved : undefined
}
export function parseDevices(output: string): DeviceRecord[] {
  return output.split(/\r?\n/).flatMap(line => {
    const match = line.trim().match(/^(\S+)\s+(device|offline|unauthorized|recovery|sideload|bootloader)(?:\s+(.*))?$/)
    if (!match) return []
    const [, serial, status, extra = ''] = match
    const model = extra.match(/\bmodel:(\S+)/)?.[1]?.replace(/_/g, ' ')
    const transportId = extra.match(/\btransport_id:(\d+)\b/)?.[1]
    const network = /:\d+$/.test(serial) || /_adb-tls-connect\._tcp/.test(serial)
    const method = serial.startsWith('emulator-') ? 'Emulator' : network ? 'Wi-Fi' : 'USB'
    return [{ id: serial, serial, name: model || serial, android: '—', method, status: status === 'device' ? 'connected' : status, endpoint: serial, lastSeen: new Date().toISOString(), known: false, canDetach: false, ...(transportId ? { transportId } : {}) } as DeviceRecord]
  })
}
export function parseMdns(output: string) {
  return output.split(/\r?\n/).flatMap(line => {
    const match = line.trim().match(/^(\S+)\s+(_adb-tls-(?:pairing|connect)\._tcp\.?)\s+(\S+)/)
    if (!match) return []
    const address = match[3].match(/^(?:\[([^\]]+)\]|([^:]+)):(\d+)$/)
    if (!address) return []
    try { return [{ name: match[1].replace(/\.$/, ''), type: match[2].replace(/\.$/, ''), address: endpoint(address[1] || address[2], address[3]), host: address[1] || address[2] }] } catch { return [] }
  })
}
// Only merge Wi-Fi transports after the phone reports the same hardware identity.
// Model names are not unique; USB remains a separate transport in the UI.
export function mergeWirelessTransports(devices: DeviceRecord[]): DeviceRecord[] {
  const groups = new Map<string, DeviceRecord[]>()
  for (const device of devices) {
    const key = device.method === 'Wi-Fi' && device.hardwareId ? `wifi:${device.hardwareId}` : device.id
    groups.set(key, [...(groups.get(key) || []), device])
  }
  return [...groups].map(([id, group]) => {
    const rank = (d: DeviceRecord) => d.status === 'connected' ? 0 : d.status === 'disconnected' ? 2 : 1
    const preferred = [...group].sort((a, b) => rank(a) - rank(b) || Number(!/:\d+$/.test(a.serial)) - Number(!/:\d+$/.test(b.serial)))[0]
    const live = group.filter(d => d.status !== 'disconnected')
    const aliases = [...new Set((live.length ? live : group).flatMap(d => d.aliases || [d.serial]))]
    const lastWirelessAddress = group.map(savedWirelessAddress).filter((s): s is NonNullable<typeof s> => !!s && s.hardwareId === preferred.hardwareId).sort((a, b) => Date.parse(b.verifiedAt) - Date.parse(a.verifiedAt))[0]
    return { ...preferred, id, known: group.some(d => d.known), ...(preferred.method === 'Wi-Fi' ? { aliases, lastWirelessAddress } : {}) }
  })
}
export class ConnectionService {
  state: ConnectionSnapshot = { devices: [], activeDeviceId: null, scanning: false, busy: false, error: null, message: '', qr: null, adbAvailable: false }
  private timer?: ReturnType<typeof setInterval>
  private scanPending?: Promise<void>
  private forgetting = false
  private qrSecret: { service: string; password: string; expires: number } | null = null
  private qrChecking = false
  private qrGeneration = 0
  private detachSupported = false
  private featuresPath = ''
  private scanError: string | null = null
  // Runtime only: a saved address is not proof of identity for a new ADB transport.
  private transportIdentities = new Map<string, string>()
  private actionFailure: { message: string; recovered: (devices: DeviceRecord[]) => boolean } | null = null
  private detached = new Set<string>()
  private rootPending = new Map<string, Promise<void>>()
  private infoPending = new Map<string, Promise<void>>()
  powerBusy = false
  private reconnectCandidates = new Map<string, { id: string; address: string; service?: string; hardwareId?: string; expiresAt: number }>()
  private reconnectVerifying = false
  private rejectedReconnects = new Set<string>()
  constructor(private storage: Storage, private adbPath: () => string | null, private emit: (event: BackendEvent) => void, private runner: Runner = run) {
    this.state.devices = storage.data.known.map(d => ({ ...d, status: 'disconnected', root: undefined, info: d.info?.status === 'loading' ? undefined : d.info }))
  }
  private publish() { this.emit({ type: 'connection', connection: { ...this.state, devices: this.state.devices.map(d => ({ ...d })) } }) }
  private log(text: string, tone: 'info' | 'success' | 'warning' = 'info', device?: string) { this.emit({ type: 'activity', text, tone, source: 'connection', device }) }
  async command(args: string[], timeout = 12000, input?: string) {
    const file = this.adbPath()
    if (!file) throw new Error('ADB is not available. Install or locate Platform Tools in Components.')
    return checked(await this.runner(file, args, timeout, input))
  }
  start() { if (!this.timer) { void this.scan(); this.timer = setInterval(() => { void this.scan(); void this.checkQr() }, 2000) } }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; this.qrGeneration++; this.qrSecret = null; this.state.qr = null }
  scan(): Promise<void> {
    if (this.reconnectVerifying) return Promise.resolve()
    if (this.forgetting) return this.scanPending || Promise.resolve()
    if (!this.scanPending) this.scanPending = this.scanOnce().finally(() => { this.scanPending = undefined })
    return this.scanPending
  }
  private async scanOnce() {
    this.state.scanning = true
    this.state.adbAvailable = !!this.adbPath(); this.publish()
    try {
      if (!this.state.adbAvailable) throw new Error('ADB is not available. Open Components to install or locate Platform Tools.')
      const file = this.adbPath()!
      if (file !== this.featuresPath) { try { const features = await this.command(['host-features']); this.detachSupported = /libusb|libadbusb/.test(features) } catch { this.detachSupported = false }; this.featuresPath = file }
      const live = parseDevices(await this.command(['devices', '-l']))
      const liveTransports = new Set(live.filter(d => d.status === 'connected' && d.transportId).map(d => `${d.serial}\n${d.transportId}`))
      for (const key of this.transportIdentities.keys()) if (!liveTransports.has(key)) this.transportIdentities.delete(key)
      const previous = new Map(this.state.devices.map(d => [d.id, d]))
      let discovery: Promise<ReturnType<typeof parseMdns>> | undefined
      const discover = () => discovery ||= this.command(['mdns', 'services'], 4000).then(parseMdns).catch(() => [])
      let save = false
      for (const device of live) {
        const old = previous.get(device.id) || this.state.devices.find(d => d.serial === device.serial || d.aliases?.includes(device.serial))
        if (device.method === 'Wi-Fi') {
          if (device.status === 'connected') {
            const transportKey = device.transportId ? `${device.serial}\n${device.transportId}` : undefined
            device.hardwareId = transportKey ? this.transportIdentities.get(transportKey) : undefined
            if (!device.hardwareId) try {
              const target = device.transportId ? ['-t', device.transportId] : ['-s', device.serial]
              const identity = await this.command([...target, 'shell', 'getprop', 'ro.serialno'], 4000)
              if (validIdentity(identity)) {
                device.hardwareId = identity
                if (transportKey) this.transportIdentities.set(transportKey, identity)
              }
            } catch { /* Unverified identities must not merge different phones. */ }
          } else device.hardwareId = old?.hardwareId
          device.aliases = [device.serial]
          if (device.hardwareId) {
            // History is useful only while still bound to this verified physical phone.
            const history = old?.hardwareId === device.hardwareId ? old : this.state.devices.find(d => d.method === 'Wi-Fi' && d.hardwareId === device.hardwareId)
            device.lastWirelessAddress = savedWirelessAddress(history)
            if (device.status === 'connected') {
              let address = numericAddress(device.serial)
              // Resolve once per newly observed connection, not on every background poll.
              if (!address && (!old || old.status !== 'connected' || old.transportId !== device.transportId)) {
                const name = device.serial.replace(/\._adb-tls-connect\._tcp\.?$/, '')
                const services = (await discover()).filter(s => s.type === '_adb-tls-connect._tcp' && s.name === name)
                if (services.length === 1) address = services[0].address
              }
              if (address && (address !== device.lastWirelessAddress?.address || old?.status !== 'connected' || old.transportId !== device.transportId)) {
                device.lastWirelessAddress = { address, hardwareId: device.hardwareId, verifiedAt: new Date().toISOString() }
                save = true
              }
            }
          }
        }
        device.known = old?.known || device.status === 'connected'
        device.canDetach = device.method === 'Wi-Fi' || (device.method === 'USB' && this.detachSupported)
        const sameConnection = device.status === 'connected' && old?.status === 'connected' && device.transportId === old.transportId && device.serial === old.serial && device.hardwareId === old.hardwareId
        const knownAlias = device.method === 'Wi-Fi' && old?.status === 'connected' && old.serial !== device.serial && device.hardwareId && device.hardwareId === old.hardwareId && old.aliases?.includes(device.serial)
        device.root = sameConnection ? old.root : undefined
        device.android = device.status === 'connected' && !sameConnection && !knownAlias ? '—' : old?.android || '—'
        device.info = (device.status === 'connected' && !sameConnection) || (device.status !== 'connected' && old?.info?.status === 'loading') ? undefined : old?.info
        if (old?.status === device.status) device.lastSeen = old.lastSeen
        else { this.log(`${device.name}: ${device.status}.`, device.status === 'connected' ? 'success' : 'warning', device.serial); save = true }
        if (device.status === 'connected' && (device.android === '—' || old?.status !== 'connected')) {
          try { device.android = await this.command([...(device.transportId ? ['-t', device.transportId] : ['-s', device.serial]), 'shell', 'getprop', 'ro.build.version.release'], 4000) || '—' } catch {}
        }
      }
      const present = new Set(live.map(d => d.id))
      const missing = this.state.devices.filter(d => !present.has(d.serial) && !d.aliases?.some(alias => present.has(alias)) && (d.known || this.detached.has(d.id))).map(d => {
        if (d.status !== 'disconnected') { save = true; this.log(`${d.name}: disconnected.`, 'warning', d.serial) }
        return { ...d, status: 'disconnected' as const, root: undefined, info: d.info?.status === 'loading' ? undefined : d.info }
      })
      const activeBefore = this.state.devices.find(d => d.id === this.state.activeDeviceId)
      this.state.devices = mergeWirelessTransports([...live, ...missing])
      const activeAfter = this.state.devices.find(d => d.id === activeBefore?.id || (activeBefore && d.method === activeBefore.method && (d.hardwareId && d.hardwareId === activeBefore.hardwareId || d.aliases?.includes(activeBefore.serial))))
      if (activeAfter) this.state.activeDeviceId = activeAfter.id
      if (this.state.devices.some(d => !previous.has(d.id))) save = true
      if (!this.state.devices.some(d => d.id === this.state.activeDeviceId && d.status === 'connected')) this.state.activeDeviceId = null
      const connected = this.state.devices.filter(d => d.status === 'connected' && ![d.serial, ...(d.aliases || [])].some(alias => this.rejectedReconnects.has(alias)))
      if (this.state.activeDeviceId && !connected.some(d => d.id === this.state.activeDeviceId)) this.state.activeDeviceId = null
      if (!this.state.activeDeviceId && connected.length === 1) this.state.activeDeviceId = connected[0].id
      if (this.state.error === this.scanError) this.state.error = null
      if (this.actionFailure && this.state.error === this.actionFailure.message && this.actionFailure.recovered(this.state.devices)) {
        this.state.error = null; this.actionFailure = null
      }
      this.scanError = null
      if (save) { this.storage.data.known = this.state.devices.filter(d => d.known).slice(0, 100).map(({ root: _root, ...device }) => device); await this.storage.save() }
    } catch (error) {
      this.transportIdentities.clear()
      const message = error instanceof Error ? error.message : String(error)
      if (this.state.error !== message) this.log(message, 'warning')
      this.state.error = message; this.state.activeDeviceId = null
      this.scanError = message
      this.state.devices = this.state.devices.map(d => ({ ...d, status: 'disconnected', root: undefined, info: d.info?.status === 'loading' ? undefined : d.info }))
    } finally { this.state.scanning = false; this.publish() }
  }
  select(id: string) { const device = this.state.devices.find(d => d.id === id); if (!device) throw new Error('Device is no longer available.'); if (device.status === 'connected') this.state.activeDeviceId = id; this.publish() }
  checkRoot(id: string, requestAccess = false): Promise<void> {
    const pending = this.rootPending.get(id)
    if (pending) return pending.then(() => {
      const current = this.state.devices.find(d => d.id === id && d.status === 'connected')
      if (current && (!current.root || requestAccess && current.root.status === 'detected')) return this.checkRoot(id, requestAccess)
    })
    const work = this.readRoot(id, requestAccess).finally(() => this.rootPending.delete(id))
    this.rootPending.set(id, work)
    return work
  }
  private async readRoot(id: string, requestAccess: boolean) {
    const device = this.state.devices.find(d => d.id === id && d.status === 'connected')
    if (!device) throw new Error('Connect and authorize the device before checking root.')
    const checking = { method: device.root?.method, status: 'checking' as const, checkedAt: null, message: requestAccess ? 'Checking root access. The phone may ask you to allow Shell/ADB.' : 'Checking root on the device...' }
    device.root = checking; this.publish()
    const file = this.adbPath()
    const target = device.transportId ? ['-t', device.transportId] : ['-s', device.serial]
    const result = await probeDeviceRoot(async (command, timeout) => {
      if (!file || !this.state.devices.some(d => d.id === id && d.status === 'connected' && d.root === checking)) throw new Error('Device connection changed.')
      return this.runner(file, [...target, 'shell', '-T', command], timeout)
    }, requestAccess)
    const current = this.state.devices.find(d => d.id === id && d.status === 'connected' && d.root === checking)
    if (current) { current.root = result; this.publish() }
  }
  inspect(id: string): Promise<void> {
    const pending = this.infoPending.get(id)
    if (pending) return pending.then(() => {
      // A new connection may arrive while an old read is finishing; read the new session once.
      const current = this.state.devices.find(item => item.id === id)
      if (current?.status === 'connected' && !current.info) return this.inspect(id)
    })
    const work = this.readInfo(id).finally(() => { this.infoPending.delete(id) })
    this.infoPending.set(id, work)
    return work
  }
  private async readInfo(id: string) {
    await this.scanPending
    const device = this.state.devices.find(item => item.id === id && item.status === 'connected')
    if (!device) throw new Error('Connect and authorize this device before reading its information.')
    const info = { status: 'loading' as const, collectedAt: null, fields: {} }
    device.info = info; this.publish()
    const currentRead = () => this.state.devices.find(item => item.id === id && item.status === 'connected' && item.serial === device.serial && item.transportId === device.transportId && item.hardwareId === device.hardwareId && item.info === info)
    try {
      const target = device.transportId ? ['-t', device.transportId] : ['-s', device.serial]
      const fields = parseDeviceInfo(await this.command([...target, 'shell', 'getprop'], 6000))
      if (!Object.keys(fields).length) throw new Error('Device properties are unavailable or access was denied.')
      const current = currentRead()
      if (!current) return
      current.info = { status: 'ready', collectedAt: new Date().toISOString(), fields }
      if (fields.android) current.android = fields.android
      this.log(`Read device and firmware information for ${device.name}.`, 'success', device.serial)
    } catch (error) {
      const current = currentRead()
      if (!current) return
      const message = error instanceof Error ? error.message : String(error)
      current.info = { status: 'error', collectedAt: new Date().toISOString(), fields: {}, error: message }
      this.log(`Device information: ${message}`, 'warning', device.serial)
    } finally { this.publish() }
  }
  async forget(id: string) {
    if (this.state.busy) throw new Error('Wait for the current connection operation.')
    this.forgetting = true; this.state.busy = true; this.publish()
    try {
      // Finish a pending scan before changing history, and pause new scans while saving.
      await this.scanPending
      const device = this.state.devices.find(d => d.id === id && d.known)
      if (!device) throw new Error('This device is no longer in Known devices.')
      if (!['disconnected', 'offline'].includes(device.status)) throw new Error('Disconnect the device before removing it from history.')
      const previous = this.storage.data.known
      this.storage.data.known = previous.filter(d => d.id !== id)
      try { await this.storage.save() } catch (error) { this.storage.data.known = previous; throw error }
      this.state.devices = this.state.devices.flatMap(d => d.id !== id ? [d] : d.status === 'offline' ? [{ ...d, known: false }] : [])
      if (this.state.activeDeviceId === id) this.state.activeDeviceId = null
      this.state.error = null
      this.state.message = `${device.name} removed from ADB Vault history. Phone pairing is unchanged.`
      this.log(this.state.message)
    } finally { this.forgetting = false; this.state.busy = false; this.publish() }
  }
  async action(work: () => Promise<void>, recovered?: (devices: DeviceRecord[]) => boolean) {
    if (this.state.busy) throw new Error('A connection operation is already running.')
    this.state.busy = true; this.state.error = null; this.actionFailure = null; this.publish()
    try { await work(); await this.scan() }
    catch (error) { this.state.error = error instanceof Error ? error.message : String(error); this.actionFailure = recovered ? { message: this.state.error, recovered } : null; this.log(this.state.error, 'warning'); throw error }
    finally { this.state.busy = false; this.publish() }
  }
  async findReconnect() {
    await this.action(async () => {
      this.reconnectCandidates.clear(); this.state.discovery = undefined
      await this.scan()
      let services: ReturnType<typeof parseMdns> = [], message = ''
      try { services = parseMdns(await this.command(['mdns', 'services'])) }
      catch { message = 'Wireless discovery is unavailable. Connected devices are shown; use the current phone address to connect manually.' }
      const expiresAt = Date.now() + 60000
      const candidates: NonNullable<ConnectionSnapshot['discovery']>['candidates'] = []
      for (const device of this.state.devices.filter(d => d.known)) {
        let address = device.serial, service: string | undefined
        if (device.status !== 'connected') {
          if (device.method !== 'Wi-Fi') continue
          const aliases = [device.serial, device.endpoint, ...(device.aliases || [])].map(s => s.replace(/\._adb-tls-connect\._tcp\.?$/, ''))
          const matches = services.filter(s => s.type === '_adb-tls-connect._tcp' && (aliases.includes(s.name) || (device.hardwareId && s.name.startsWith(`adb-${device.hardwareId}-`))))
          // Ambiguous discovery requires a fresh/manual choice, never guess an address.
          if (matches.length !== 1) continue
          address = matches[0].address; service = matches[0].name
        }
        if (candidates.some(c => c.address === address)) continue
        const token = randomBytes(16).toString('hex')
        this.reconnectCandidates.set(token, { id: device.id, address, service, hardwareId: device.hardwareId, expiresAt })
        candidates.push({ token, id: device.id, name: device.name, address, method: device.method, connected: device.status === 'connected' })
      }
      this.state.discovery = { candidates, expiresAt, message: message || (candidates.length ? 'Choose a device and confirm. Existing connections will stay open.' : 'No available known devices found. Reconnect the USB cable and authorize debugging, or enable Wireless debugging on the same network. VPN may prevent a connection. You can also enter the current address manually.') }
    })
  }
  async confirmReconnect(token: string) {
    const candidate = this.reconnectCandidates.get(token)
    if (!candidate || candidate.expiresAt < Date.now()) throw new Error('Search results expired. Find devices again.')
    await this.action(async () => {
      // One-use backend token: the renderer never supplies an executable address.
      this.reconnectCandidates.delete(token)
      await this.scan()
      const device = this.state.devices.find(d => d.id === candidate.id && d.known)
      if (!device) throw new Error('Known device changed. Find devices again.')
      if (device.status === 'connected') { this.select(device.id); this.state.message = `${device.name} is now active.`; return }
      if (!candidate.service) throw new Error('Device is no longer connected. Find devices again or reconnect its cable.')
      const services = parseMdns(await this.command(['mdns', 'services']))
      const service = services.find(s => s.name === candidate.service && s.type === '_adb-tls-connect._tcp' && s.address === candidate.address)
      if (!service) throw new Error('The wireless address changed or disappeared. Find devices again.')
      const output = await this.command(['connect', service.address], 20000)
      if (!/^(already )?connected to /im.test(output)) throw new Error(output || 'ADB did not confirm a connection.')
      if (candidate.hardwareId) {
        const identity = await this.command(['-s', service.address, 'shell', 'getprop', 'ro.serialno'], 5000)
        if (identity !== candidate.hardwareId) throw new Error('Connected identity does not match the selected known device. It was not selected; inspect Connection.')
      }
      await this.scan()
      const live = this.state.devices.find(d => d.status === 'connected' && (d.serial === service.address || d.aliases?.includes(service.address)))
      if (!live) throw new Error('Connection was not ready. Find devices again.')
      this.select(live.id); this.state.message = `${live.name} connected and selected.`; this.log(this.state.message, 'success')
    })
  }
  async connect(host: string, port: string) {
    const address = endpoint(host, port)
    await this.action(async () => {
      if (await this.alreadyConnected(address)) { this.state.message = `Already connected to ${address}.`; return }
      const output = await this.command(['connect', address], 20000)
      if (!/^(already )?connected to /im.test(output)) throw new Error(output || 'ADB did not confirm a connection.')
      this.state.message = output; this.log(output, 'success')
    }, devices => devices.some(d => d.status === 'connected' && (d.serial === address || d.aliases?.includes(address))))
  }
  private async alreadyConnected(address: string, services?: ReturnType<typeof parseMdns>) {
    const live = parseDevices(await this.command(['devices', '-l']))
    if (live.some(d => d.status === 'connected' && d.serial === address)) return true
    try {
      const discovered = services || parseMdns(await this.command(['mdns', 'services']))
      const service = discovered.find(s => s.type === '_adb-tls-connect._tcp' && s.address === address)
      return !!service && live.some(d => d.status === 'connected' && d.serial.replace(/\._adb-tls-connect\._tcp\.?$/, '') === service.name)
    } catch { return false }
  }
  private async pairAddress(address: string, secret: string) {
    const output = await this.command(['pair', address], 30000, `${secret}\n`)
    if (!/Successfully paired/i.test(output)) throw new Error('ADB pairing failed. Check the pairing address, current code, and Wireless debugging screen.')
    const guid = output.match(/guid=([^\]]+)/)?.[1]
    this.log(`Paired with ${address}.`, 'success')
    this.state.message = 'Pairing succeeded. Waiting for the connection service. If the device stays disconnected, enter its connection port below.'
    // Pairing and connection use different ports. Only use a matching advertised service.
    try {
      const services = parseMdns(await this.command(['mdns', 'services']))
      const service = guid ? services.find(s => s.type === '_adb-tls-connect._tcp' && (s.name === guid || s.name.startsWith(`${guid}-`))) : undefined
      if (service) {
        if (await this.alreadyConnected(service.address, services)) this.state.message = 'Pairing succeeded. ADB has already connected to the phone automatically.'
        else { const result = await this.command(['connect', service.address], 15000); if (/connected to/i.test(result)) this.state.message = result }
      }
    } catch { /* Pairing remains successful; manual connection remains available. */ }
  }
  async pair(host: string, port: string, code: string) {
    const address = endpoint(host, port)
    if (!/^\d{6}$/.test(code)) throw new Error('Enter the six-digit pairing code shown on the phone.')
    await this.action(() => this.pairAddress(address, code))
  }
  async reconnect(id: string) {
    const device = this.state.devices.find(d => d.id === id)
    if (!device) throw new Error('Unknown device. Scan again.')
    await this.action(async () => {
      if (device.method === 'Wi-Fi') {
        // Do not let polling select a newly connected phone before identity verification.
        await this.scanPending
        this.reconnectVerifying = true
        try { await this.reconnectWireless(device) } finally { this.reconnectVerifying = false }
      } else if (this.detached.has(id)) { await this.command(['attach', device.serial]); this.detached.delete(id) }
      else if (device.status === 'disconnected') throw new Error('Reconnect the USB cable and enable USB debugging on the phone.')
      else await this.command(['-s', device.serial, 'reconnect'])
    }, devices => devices.some(d => d.status === 'connected' && d.method === device.method && (
      device.method === 'Wi-Fi' && validIdentity(device.hardwareId) ? d.hardwareId === device.hardwareId
        : d.id === device.id || d.serial === device.serial || d.aliases?.includes(device.serial)
    )))
  }
  private async reconnectWireless(device: DeviceRecord) {
    let hardwareId = device.hardwareId
    if (!validIdentity(hardwareId) && device.status === 'connected') {
      hardwareId = await this.command(['-s', device.serial, 'shell', 'getprop', 'ro.serialno'], 5000)
    }
    if (!validIdentity(hardwareId)) throw new Error('This saved phone has no verified identity yet. Connect using the current IP address and connection port from the phone first.')
    let services: ReturnType<typeof parseMdns> = []
    try { services = parseMdns(await this.command(['mdns', 'services'], 4000)) } catch { /* A confirmed address can recover when discovery is unavailable. */ }
    const names = [device.serial, device.endpoint, ...(device.aliases || [])].map(s => s.replace(/\._adb-tls-connect\._tcp\.?$/, ''))
    const matches = services.filter(s => s.type === '_adb-tls-connect._tcp' && (names.includes(s.name) || s.name.startsWith(`adb-${hardwareId}-`)))
    if (matches.length > 1) throw new Error('More than one wireless address was advertised for this phone. Use its current IP address and connection port to choose the correct connection.')
    // Numeric endpoints in older history were stored together with ro.serialno.
    // They remain candidates, never proof that the same phone still owns the IP.
    const saved = savedWirelessAddress(device)?.address || numericAddress(device.endpoint)
    const address = matches[0]?.address || saved
    if (!address) throw new Error('The saved wireless service is not currently advertised and no confirmed IP address is saved. Enable Wireless debugging or enter the current IP address and connection port from the phone.')
    const serviceSerial = matches[0] ? `${matches[0].name}._adb-tls-connect._tcp` : undefined
    const findLive = (devices: DeviceRecord[]) => devices.find(d => d.status === 'connected' && (d.serial === address || (serviceSerial && d.serial.replace(/\.$/, '') === serviceSerial)))
    let created = false, attempted = false, connected: DeviceRecord | undefined
    try {
      connected = findLive(parseDevices(await this.command(['devices', '-l'])))
      if (!connected) {
        attempted = true
        const output = await this.command(['connect', address], 20000)
        if (!/^(already )?connected to /im.test(output)) throw new Error(output || 'ADB did not confirm a connection.')
        created = /^connected to /im.test(output)
      }
    } catch (error) {
      if (attempted) this.rejectedReconnects.add(address)
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`Could not reconnect to ${address}. ${detail} Keep the phone awake and check its current connection port. If VPN is enabled, check that it allows access to the local network; a firewall or unavailable device can also prevent a connection.`)
    }
    try {
      if (!connected) connected = findLive(parseDevices(await this.command(['devices', '-l'])))
      if (!connected) throw new Error('ADB has not made the connection ready for verification.')
      const target = connected.transportId ? ['-t', connected.transportId] : ['-s', connected.serial]
      const actual = await this.command([...target, 'shell', 'getprop', 'ro.serialno'], 5000)
      if (actual !== hardwareId) throw new Error(validIdentity(actual) ? 'A different phone answered at this address.' : 'The phone did not report a verifiable identity.')
      const current = parseDevices(await this.command(['devices', '-l'])).find(d => d.serial === connected!.serial && d.status === 'connected' && d.transportId === connected!.transportId)
      if (!current) throw new Error('The connection changed during identity verification. Try Reconnect again.')
    } catch (error) {
      this.rejectedReconnects.add(address)
      if (connected) this.rejectedReconnects.add(connected.serial)
      let cleanup = ''
      if (created) {
        try { await this.command(['disconnect', address], 5000); cleanup = ' The new connection was closed.' }
        catch { cleanup = ' ADB could not close the new connection; it will not be selected automatically.' }
      }
      throw new Error(`Could not verify the selected phone. ${error instanceof Error ? error.message : String(error)}${cleanup} Check the current address on the selected phone.`)
    }
    this.rejectedReconnects.delete(address)
    this.rejectedReconnects.delete(connected!.serial)
    const confirmed = { address, hardwareId, verifiedAt: new Date().toISOString() }
    device.hardwareId = hardwareId
    device.lastWirelessAddress = confirmed
    for (const record of [...this.state.devices, ...this.storage.data.known]) {
      if (record.method === 'Wi-Fi' && record.hardwareId === hardwareId) record.lastWirelessAddress = confirmed
    }
    await this.storage.save()
    this.state.message = `${device.name}: connection verified at ${address}${matches.length ? '.' : ' using the last confirmed address.'}`
    this.log(this.state.message, 'success', connected!.serial)
  }
  async disconnect(id: string) {
    const device = this.state.devices.find(d => d.id === id)
    if (!device) throw new Error('Unknown device.')
    await this.action(async () => {
      if (device.method === 'Wi-Fi') { for (const alias of device.aliases || [device.endpoint]) await this.command(['disconnect', alias]) }
      else if (device.method === 'USB' && device.canDetach) { await this.command(['detach', device.serial]); this.detached.add(id) }
      else throw new Error('This ADB USB backend cannot detach a single device. Unplug its cable or disable USB debugging on the phone.')
      this.state.message = `${device.name}: disconnect requested.`
    })
  }
  async power(id: string, mode: DevicePowerMode, confirmed: boolean, serial: string, transportId?: string) {
    validateDevicePower(mode, confirmed)
    const device = this.state.devices.find(d => d.id === id)
    if (!device || device.status !== 'connected') throw new Error('Connect the selected phone before changing its power state.')
    if (device.serial !== serial || device.transportId !== transportId) throw new Error('The selected connection changed. Select the phone and confirm again.')
    if (this.state.busy || this.powerBusy) throw new Error('Wait for the current connection operation.')
    this.powerBusy = true
    this.state.busy = true; this.state.error = null; this.actionFailure = null; this.publish()
    const label = devicePowerLabels[mode]
    try {
      // Address the captured transport only. Never fall back to another connected device.
      const target = device.transportId ? ['-t', device.transportId] : ['-s', device.serial]
      const output = await this.command([...target, ...devicePowerCommand(mode)], 15000)
      // Some Android svc implementations print an error/help but exit with code zero.
      if (/error|exception|denied|not permitted|not allowed|failed|failure|unknown|unsupported|not found|usage:|control the power manager/i.test(output)) throw new Error(output.slice(0, 1000))
      this.state.message = `${device.name}: ${label} requested. ${mode === 'shutdown' ? 'The phone will power off; turn it on manually to reconnect.' : 'The connection will be interrupted.'}`
      this.log(this.state.message, 'info', device.serial)
    } catch (error) {
      this.state.error = `${device.name}: could not confirm ${label.toLowerCase()}. ${error instanceof Error ? error.message : String(error)} Check the phone before trying again.`
      this.log(this.state.error, 'warning', device.serial)
      throw new Error(this.state.error)
    } finally {
      this.powerBusy = false; this.state.busy = false; this.publish()
    }
  }
  async newQr() {
    if (this.state.busy) throw new Error('Wait for the current connection operation.')
    const generation = ++this.qrGeneration
    this.qrSecret = null; this.state.qr = null; this.publish()
    let mdns: string
    try { mdns = await this.command(['mdns', 'check']) }
    catch (error) { if (generation !== this.qrGeneration) return; throw error }
    if (generation !== this.qrGeneration) return
    if (/unavailable|not available|disabled|error|failed/i.test(mdns)) throw new Error(`mDNS is unavailable: ${mdns}`)
    const service = `studio-${randomBytes(10).toString('hex')}`
    const password = randomBytes(18).toString('hex')
    const expires = Date.now() + 120000
    this.qrSecret = { service, password, expires }
    this.state.qr = { payload: `WIFI:T:ADB;S:${service};P:${password};;`, expiresAt: expires, status: 'waiting', message: 'Scan with Android Wireless debugging → Pair device with QR code.' }
    this.publish()
  }
  cancelQr() { this.qrGeneration++; this.qrSecret = null; this.state.qr = null; this.publish() }
  private expireQr() { this.qrSecret = null; this.state.qr = { ...this.state.qr!, payload: '', status: 'expired', message: 'QR session expired. Create a new QR code.' }; this.publish() }
  async checkQr() {
    const session = this.qrSecret
    if (!session || this.qrChecking || this.state.busy) return
    if (Date.now() >= session.expires) { this.expireQr(); return }
    this.qrChecking = true
    try {
      const services = parseMdns(await this.command(['mdns', 'services']))
      if (session !== this.qrSecret) return
      if (Date.now() >= session.expires) { this.expireQr(); return }
      if (this.state.busy) return
      const service = services.find(s => s.type === '_adb-tls-pairing._tcp' && s.name === session.service)
      if (!service) return
      this.state.qr = { ...this.state.qr!, status: 'pairing', message: 'Phone found. Pairing…' }; this.publish()
      await this.action(() => this.pairAddress(service.address, session.password))
      if (session === this.qrSecret) { this.qrSecret = null; this.state.qr = { ...this.state.qr!, payload: '', status: 'paired', message: this.state.message } }
    } catch (error) {
      if (session === this.qrSecret) { this.qrSecret = null; this.state.qr = { ...this.state.qr!, payload: '', status: 'failed', message: error instanceof Error ? error.message : String(error) } }
    } finally { this.qrChecking = false; this.publish() }
  }
}
