import type { IpInfo } from '../../electron/network-protocol'

// Bundled SVGs work offline and do not depend on Windows emoji fonts.
const flags = import.meta.glob<string>('../../node_modules/flag-icons/flags/4x3/*.svg', {
  eager: true, query: '?url', import: 'default',
})

const scopes: Record<string, { label: string; help: string }> = {
  Unspecified: { label: 'No destination address', help: 'No specific remote address is assigned. This socket may be waiting for incoming connections or may not have a peer yet. There is no country to look up.' },
  'Private network': { label: 'Local / private network', help: 'An internal address, for example on your Wi-Fi network or inside a VPN. It is not a public Internet address, so GeoIP cannot assign a country.' },
  Loopback: { label: 'This phone', help: 'A connection within the phone itself (loopback). It does not identify an external server.' },
  'Link local': { label: 'Local network segment', help: 'An address used on the directly connected network. It has no GeoIP country.' },
}

export function NetworkCountry({ info }: { info: IpInfo }) {
  const code = info.countryCode?.toUpperCase()
  if (!code || !/^[A-Z]{2}$/.test(code)) {
    const scope = scopes[info.scope]
    return <span title={scope?.help} tabIndex={scope ? 0 : undefined}>{(scope?.label && scope.label) || (info.scope === 'Public / other' ? "Unknown country" : info.scope)}</span>
  }
  const flag = code === 'XX' ? undefined : flags[`../../node_modules/flag-icons/flags/4x3/${code.toLowerCase()}.svg`]
  return <span className="network-country">
    {flag && <img className="country-flag" src={flag} width={24} height={18} alt="" />}
    <span>{info.country ? `${info.country} (${code})` : code}</span>
  </span>
}
