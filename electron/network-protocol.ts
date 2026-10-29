import type { ComponentRecord, DeviceRecord } from './contracts.js'

export type NetworkTarget = Pick<DeviceRecord, 'id' | 'serial' | 'transportId'>
export interface IpInfo { scope: string; countryCode?: string; country?: string; asn?: number; organization?: string }
export interface PhoneSocket {
  key: string; protocol: 'TCP' | 'UDP'; family: 4 | 6; localAddress: string; localPort: number
  remoteAddress: string; remotePort: number; state: string; uid: number; userId: number
  packages: string[]; ip: IpInfo
}
export interface PhoneConnections {
  target: NetworkTarget; time: number; sockets: PhoneSocket[]; issues: string[]; geoip: string
}
export interface TraceHop { ttl: number; address: string | null; milliseconds: number | null; ip?: IpInfo }
export interface PhoneTrace {
  target: NetworkTarget; address: string; time: number; hops: TraceHop[]; output: string
  status: 'complete' | 'partial' | 'unavailable'; message: string
}
export type PhoneNetworkRequest =
  | { type: 'network.connections'; target: NetworkTarget; requestId: string }
  | { type: 'network.trace'; target: NetworkTarget; requestId: string; address: string }
  | { type: 'network.cancel'; requestId: string }

export const geoipComponent: ComponentRecord = {
  id: 'geoip', name: 'GeoIP', subtitle: 'Offline country and network lookup', publisher: 'MaxMind',
  description: 'Optional local GeoLite2 / GeoIP2 Country or City and ASN databases (.mmdb). Adds approximate IP country and network owner to phone connections. Addresses are not sent to an online lookup service. Supply your own database files and replace them when needed.',
  group: 'Optional components', version: '—', targetVersion: 'Local MMDB files', size: '—',
  status: 'Not installed', location: null, progress: 0, managed: false,
  sourceUrl: 'https://dev.maxmind.com/geoip/geolite2-free-geolocation-data/',
  message: 'Optional. Choose a folder containing Country / City and/or ASN .mmdb files.',
}
