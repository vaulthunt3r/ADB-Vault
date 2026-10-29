import { Socket, isIPv4 } from 'node:net'
import { setMaxListeners } from 'node:events'
import { networkPath } from './file-locations.js'
import { powershell, run, type Runner } from './process.js'
import { fileBase } from './files-protocol.js'
import { readNetworkMappings, type MappedNetworkFolder } from './file-network-mappings.js'

export interface NetworkScanResult { ranges: string[]; hosts: { address: string; shares: { name: string; path: string; drive?: string }[]; error?: string }[]; checked: number; total: number; cancelled: boolean; warnings: string[] }
export interface LocalNetwork { address: string; prefixLength: number; name?: string }

export const NETWORK_INTERFACES_SCRIPT = `
$networks = @(Get-NetIPConfiguration | Where-Object { $_.NetAdapter.Status -eq 'Up' } | ForEach-Object {
  $name = $_.InterfaceAlias
  foreach ($ip in $_.IPv4Address) { @{ address = $ip.IPAddress; prefixLength = $ip.PrefixLength; name = $name } }
})
ConvertTo-Json -Compress -InputObject $networks
`

// Level 1 enumerates names/types only, using the current Windows session. Never prompts or changes credentials.
// https://learn.microsoft.com/windows/win32/api/lmshare/nf-lmshare-netshareenum
export const NETWORK_SHARES_DECLARATION = `
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class VaultShareDiscovery {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct Share { [MarshalAs(UnmanagedType.LPWStr)] public string Name; public uint Type; [MarshalAs(UnmanagedType.LPWStr)] public string Remark; }
  [DllImport("Netapi32.dll", CharSet=CharSet.Unicode, ExactSpelling=true)]
  public static extern uint NetShareEnum(string server, uint level, out IntPtr buffer, uint maxLength, out uint read, out uint total, ref uint resume);
  [DllImport("Netapi32.dll", ExactSpelling=true)] public static extern uint NetApiBufferFree(IntPtr buffer);
  public class Result { public uint Code; public string[] Names; }
  public static Result Read(string server) {
    var names = new List<string>(); uint resume=0, code=0; int size=Marshal.SizeOf(typeof(Share));
    for (int page=0; page<16; page++) {
      IntPtr buffer=IntPtr.Zero; uint read=0, total=0;
      try {
        code=NetShareEnum(server, 1, out buffer, 32768, out read, out total, ref resume);
        if (code!=0 && code!=234) break;
        for (uint i=0; i<read && names.Count<512; i++) {
          var share=(Share)Marshal.PtrToStructure(IntPtr.Add(buffer, checked((int)i*size)), typeof(Share));
          if ((share.Type & 0xFFFF)==0 && (share.Type & 0x80000000)==0 && !String.IsNullOrEmpty(share.Name) && !share.Name.EndsWith("$")) names.Add(share.Name);
        }
      } finally { if (buffer!=IntPtr.Zero) NetApiBufferFree(buffer); }
      if (code!=234 || names.Count>=512) break;
    }
    return new Result { Code=code, Names=names.ToArray() };
  }
}
'@
`
export const NETWORK_SHARES_SCRIPT = NETWORK_SHARES_DECLARATION + `
$result = [VaultShareDiscovery]::Read('\\\\' + $env:ADB_VAULT_SCAN_HOST)
ConvertTo-Json -Compress -Depth 4 -InputObject @{ code=$result.Code; names=@($result.Names); message=([ComponentModel.Win32Exception]::new([int]$result.Code)).Message }
`

const privateAddress = (address: string) => typeof address === 'string' && isIPv4(address) && (/^10\./.test(address) || /^192\.168\./.test(address) || /^172\.(1[6-9]|2\d|3[01])\./.test(address) || /^169\.254\./.test(address))
export function networkScanTargets(networks: LocalNetwork[]) {
  const addresses = new Set<string>(), ranges = new Set<string>(), warnings: string[] = []
  for (const network of networks.slice(0, 16)) {
    if (!network || !privateAddress(network.address) || !Number.isInteger(network.prefixLength) || network.prefixLength < 1 || network.prefixLength > 32) continue
    const prefix = Math.max(24, network.prefixLength), ip = network.address.split('.').reduce((n, v) => (n * 256 + Number(v)) >>> 0, 0)
    const size = 2 ** (32 - prefix), start = Math.floor(ip / size) * size
    const dotted = (n: number) => [n >>> 24, n >>> 16 & 255, n >>> 8 & 255, n & 255].join('.')
    const range = dotted(start) + '/' + prefix
    if (ranges.has(range)) continue
    if (ranges.size >= 4) { warnings.push('Only the first four connected local network segments were scanned.'); break }
    ranges.add(range)
    if (network.prefixLength < 24) warnings.push(`${network.name || network.address}: scanning the nearby /24 segment. Other segments can be opened by address.`)
    for (let offset = size > 2 ? 1 : 0; offset < size - (size > 2 ? 1 : 0); offset++) addresses.add(dotted(start + offset))
  }
  return { addresses: [...addresses], ranges: [...ranges], warnings }
}

export function probeSmb(address: string, signal: AbortSignal): Promise<boolean> {
  if (!privateAddress(address) || signal.aborted) return Promise.resolve(false)
  return new Promise(resolve => {
    const socket = new Socket()
    const done = (open: boolean) => { signal.removeEventListener('abort', abort); socket.destroy(); resolve(open) }
    const abort = () => done(false)
    signal.addEventListener('abort', abort, { once: true })
    socket.setTimeout(450, () => done(false)); socket.once('error', () => done(false)); socket.once('connect', () => done(true))
    socket.connect(445, address)
  })
}

export class NetworkDiscovery {
  private active?: { id: string; controller: AbortController; promise: Promise<NetworkScanResult> }
  constructor(private runner: Runner = run, private probe = probeSmb, private readMappings = (signal: AbortSignal) => readNetworkMappings(signal, runner)) {}
  cancel(id: string) { if (this.active?.id === id) this.active.controller.abort() }
  async shutdown() { this.active?.controller.abort(); await this.active?.promise.catch(() => {}) }
  scan(id: string) {
    if (this.active) throw new Error('Wait for the current network search to stop.')
    if (process.platform !== 'win32') throw new Error('Network discovery currently uses Windows SMB services.')
    const controller = new AbortController(), promise = this.execute(controller.signal)
    this.active = { id, controller, promise }
    return promise.finally(() => { this.active = undefined })
  }
  private async execute(cancel: AbortSignal): Promise<NetworkScanResult> {
    const signal = AbortSignal.any([cancel, AbortSignal.timeout(60_000)])
    setMaxListeners(32, signal)
    const result: NetworkScanResult = { ranges: [], hosts: [], checked: 0, total: 0, cancelled: false, warnings: [] }
    const call = (script: string, env: NodeJS.ProcessEnv | undefined, timeout: number) => powershell(script, env, timeout, (exe, args, time, input, vars, options) => this.runner(exe, args, time, input, vars, { ...options, signal }))
    let mappings: MappedNetworkFolder[] = []
    try {
      try { mappings = await this.readMappings(signal) } catch { if (!signal.aborted) result.warnings.push('Could not read existing Windows network drives. Search will use network addresses.') }
      for (const mapped of mappings) {
        const server = mapped.path.split('\\')[2]
        let host = result.hosts.find(h => h.address.toLowerCase() === server.toLowerCase())
        if (!host) { host = { address: server, shares: [] }; result.hosts.push(host) }
        if (!host.shares.some(s => s.path.toLowerCase() === mapped.path.toLowerCase())) host.shares.push({ name: fileBase(mapped.path), path: mapped.path, drive: mapped.drive })
      }
      signal.throwIfAborted()
      const raw = JSON.parse(await call(NETWORK_INTERFACES_SCRIPT, undefined, 15_000)) as LocalNetwork[]
      if (!Array.isArray(raw)) throw new Error('Windows returned an invalid network list.')
      const targets = networkScanTargets(raw)
      result.ranges = targets.ranges; result.total = targets.addresses.length; result.warnings.push(...targets.warnings)
      if (!targets.addresses.length) { result.warnings.push('No connected local IPv4 network was found. Open a network folder by address.'); return result }
      let next = 0
      const available: string[] = []
      await Promise.all(Array.from({ length: Math.min(24, targets.addresses.length) }, async () => {
        while (next < targets.addresses.length && !signal.aborted) {
          const address = targets.addresses[next++]
          if (await this.probe(address, signal)) available.push(address)
          result.checked++
        }
      }))
      if (available.length > 32) result.warnings.push('Showing the first 32 SMB devices. Other devices can be opened by address.')
      // Keep discovered hosts even if cancellation or a credentials error prevents share enumeration.
      for (const address of available.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
        const mapped = mappings.find(m => m.addresses.includes(address)), server = mapped?.path.split('\\')[2] || address
        if (result.hosts.some(h => h.address.toLowerCase() === server.toLowerCase()) || result.hosts.length >= 32) continue
        result.hosts.push({ address: server, shares: [], error: 'Shared folders have not been read.' })
      }
      next = 0
      await Promise.all(Array.from({ length: Math.min(4, result.hosts.length) }, async () => {
        while (next < result.hosts.length && !signal.aborted) {
          const host = result.hosts[next++]
          try {
            const raw = JSON.parse(await call(NETWORK_SHARES_SCRIPT, { ADB_VAULT_SCAN_HOST: host.address }, 10_000)) as { code: number; names: string[]; message: string }
            if (!Array.isArray(raw.names) || !Number.isInteger(raw.code)) throw new Error('Invalid shared folder list.')
            const seen = new Set(host.shares.map(s => s.path.toLowerCase()))
            for (const name of raw.names.slice(0, 512)) {
              if (typeof name !== 'string' || name.endsWith('$') || /[\\/]/.test(name)) continue
              try { const path = networkPath('\\\\' + host.address + '\\' + name); if (!seen.has(path.toLowerCase())) { host.shares.push({ name, path }); seen.add(path.toLowerCase()) } } catch { /* Not a disk share path. */ }
            }
            host.error = raw.code === 0 ? undefined : raw.code === 5 ? 'Windows denied access to the shared folder list. Sign in to this device or enter a folder address.' : raw.code === 234 ? 'The shared folder list is incomplete.' : `Cannot read shared folders (${raw.code}): ${String(raw.message).slice(0, 300)}`
          } catch (error) { host.error = signal.aborted ? 'Search stopped before shared folders were read.' : error instanceof Error ? error.message : String(error) }
        }
      }))
    } catch (error) { if (!signal.aborted) { if (!result.hosts.length) throw error; result.warnings.push(`Network scan incomplete: ${error instanceof Error ? error.message : String(error)}`) } }
    if (signal.aborted) { result.cancelled = true; result.warnings.push(cancel.aborted ? 'Search stopped. Results may be incomplete.' : 'The network search time limit was reached. Results may be incomplete.') }
    return result
  }
}
