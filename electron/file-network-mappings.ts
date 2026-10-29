import { isIPv4 } from 'node:net'
import { networkPath, networkRoot } from './file-locations.js'
import { powershell, run, type Runner } from './process.js'

export interface MappedNetworkFolder { path: string; drive: string; addresses: string[] }

// Read only provider paths from the current Windows session; never credentials.
export const NETWORK_MAPPINGS_SCRIPT = `
$dns = @{}
$folders = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=4' | ForEach-Object {
  $remote = $_.ProviderName
  if ($remote -and $remote.StartsWith('\\\\')) {
    $server = $remote.Split([char]'\\')[2]
    if (-not $dns.ContainsKey($server)) {
      $dns[$server] = @()
      try {
        $lookup = [Net.Dns]::GetHostAddressesAsync($server)
        if ($lookup.Wait(1500)) { $dns[$server] = @($lookup.Result | Where-Object AddressFamily -eq InterNetwork | ForEach-Object IPAddressToString) }
      } catch {}
    }
    @{ path=$remote; drive=$_.DeviceID; addresses=@($dns[$server]) }
  }
})
ConvertTo-Json -Compress -Depth 4 -InputObject $folders
`

export async function readNetworkMappings(signal?: AbortSignal, runner: Runner = run): Promise<MappedNetworkFolder[]> {
  const raw = JSON.parse(await powershell(NETWORK_MAPPINGS_SCRIPT, undefined, 12_000, (file, args, timeout, input, env, options) => runner(file, args, timeout, input, env, { ...options, signal })))
  if (!Array.isArray(raw)) throw new Error('Windows returned an invalid mapped drive list.')
  return raw.slice(0, 26).flatMap(value => {
    try {
      const path = networkPath(value.path)
      return [{ path, drive: /^[A-Z]:$/i.test(value.drive) ? value.drive : '', addresses: Array.isArray(value.addresses) ? value.addresses.filter((a: unknown) => typeof a === 'string' && isIPv4(a)) : [] }]
    } catch { return [] }
  })
}

/** Only an exact share on a mapped server whose current address matches may replace an IP. */
export function preferredNetworkPath(folder: string, mappings: MappedNetworkFolder[]) {
  const root = networkRoot(folder), [, , server, share] = root.split('\\')
  if (!isIPv4(server)) return folder
  const mapped = mappings.find(m => m.addresses.includes(server) && networkRoot(m.path).split('\\')[3].toLowerCase() === share.toLowerCase())
  return mapped ? networkRoot(mapped.path) + folder.slice(root.length) : folder
}
