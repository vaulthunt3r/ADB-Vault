import { readFile, readdir, stat, writeFile, mkdir, rename } from 'node:fs/promises'
import path from 'node:path'
import { isIP } from 'node:net'
import { Reader, type CountryResponse, type AsnResponse } from 'maxmind'
import { geoipComponent, type IpInfo } from './network-protocol.js'
import type { ComponentRecord } from './contracts.js'

export function ipScope(address: string): string {
  const family = isIP(address)
  if (!family) return 'Invalid address'
  if (family === 6) {
    const ip = new URL(`http://[${address}]/`).hostname.slice(1, -1).toLowerCase()
    if (ip === '::') return 'Unspecified'
    if (ip === '::1') return 'Loopback'
    if (ip.startsWith('::ffff:')) {
      const parts = ip.slice(7).split(':').map(v => parseInt(v, 16))
      return ipScope(`${parts[0] >> 8}.${parts[0] & 255}.${parts[1] >> 8}.${parts[1] & 255}`)
    }
    if (/^f[cd]/.test(ip)) return 'Private network'
    if (/^fe[89ab]/.test(ip)) return 'Link local'
    if (ip.startsWith('ff')) return 'Multicast'
    if (ip.startsWith('2001:db8:')) return 'Documentation'
    return 'Public / other'
  }
  const [a, b, c] = address.split('.').map(Number)
  if (a === 0) return 'Unspecified'
  if (a === 127) return 'Loopback'
  if (a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168) return 'Private network'
  if (a === 169 && b === 254) return 'Link local'
  if (a === 100 && b >= 64 && b <= 127) return 'Shared address space'
  if (a >= 224) return a < 240 ? 'Multicast' : 'Reserved'
  if (a === 192 && b === 0 && (c === 0 || c === 2) || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113) return 'Special use'
  return 'Public / other'
}

export class GeoIpService {
  record: ComponentRecord = { ...geoipComponent }
  private country?: Reader<CountryResponse>
  private asn?: Reader<AsnResponse>
  private pending = false
  constructor(private root: string, private changed: () => void = () => {}) {}
  private async load(folder: string) {
    if (!path.isAbsolute(folder)) throw new Error('Choose an absolute folder path.')
    const files = (await readdir(folder)).filter(f => /\.mmdb$/i.test(f)).sort()
    if (!files.length || files.length > 8) throw new Error('Choose a folder containing 1–8 MMDB files.')
    let country: Reader<CountryResponse> | undefined, asn: Reader<AsnResponse> | undefined
    const descriptions: string[] = []
    for (const file of files) {
      const filename = path.join(folder, file), size = (await stat(filename)).size
      if (!size || size > 128 * 1024 * 1024) throw new Error(`${file}: database size must be below 128 MB.`)
      const reader = new Reader<CountryResponse & AsnResponse>(await readFile(filename))
      const type = reader.metadata.databaseType
      if (/^(GeoLite2|GeoIP2)-(Country|City)$/.test(type)) country = reader
      else if (/^(GeoLite2|GeoIP2)-ASN$/.test(type)) asn = reader
      else continue
      descriptions.push(`${type} · ${reader.metadata.buildEpoch.toISOString().slice(0, 10)}`)
    }
    if (!country && !asn) throw new Error('No supported GeoLite2 / GeoIP2 Country, City or ASN database found.')
    return { country, asn, descriptions }
  }
  async locate(folder: string) {
    if (this.pending) throw new Error('GeoIP is already loading.')
    this.pending = true
    try {
      const loaded = await this.load(folder)
      await mkdir(this.root, { recursive: true })
      const config = path.join(this.root, 'geoip.json')
      await writeFile(config + '.tmp', JSON.stringify({ folder }))
      await rename(config + '.tmp', config)
      this.apply(folder, loaded)
    } finally { this.pending = false }
  }
  private apply(folder: string, loaded: Awaited<ReturnType<GeoIpService['load']>>) {
    this.country = loaded.country; this.asn = loaded.asn
    this.record = { ...geoipComponent, status: 'Detected', location: folder, version: loaded.descriptions.join('; '), message: 'Local lookup enabled. Country is approximate; ASN identifies the network, not the application developer.' }
    this.changed()
  }
  async initialize() {
    if (this.pending) return
    this.pending = true
    try {
      let config: { folder: string }
      try { config = JSON.parse(await readFile(path.join(this.root, 'geoip.json'), 'utf8')) }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
      this.apply(config.folder, await this.load(config.folder))
    } catch (error) {
      this.country = undefined; this.asn = undefined
      this.record = { ...geoipComponent, status: 'Repair needed', message: `GeoIP unavailable: ${error instanceof Error ? error.message : error}` }
      this.changed()
    } finally { this.pending = false }
  }
  lookup(address: string): IpInfo {
    const scope = ipScope(address)
    if (scope !== 'Public / other') return { scope }
    try {
      const country = this.country?.get(address)?.country, asn = this.asn?.get(address)
      return { scope, countryCode: country?.iso_code, country: country?.names.en, asn: asn?.autonomous_system_number, organization: asn?.autonomous_system_organization }
    } catch { return { scope } }
  }
}
