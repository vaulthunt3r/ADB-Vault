import { networkPath, networkRoot } from './file-locations.js'
import { powershell, run, type Runner } from './process.js'
import { preferredNetworkPath, readNetworkMappings, type MappedNetworkFolder } from './file-network-mappings.js'

// Native Windows authentication owns credentials; no password crosses IPC,
// argv, environment, application preferences or Activity.
// https://learn.microsoft.com/windows/win32/api/winnetwk/nf-winnetwk-wnetaddconnection3w
export const NETWORK_CONNECT_DECLARATION = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class VaultNetwork {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct Resource {
    public uint scope, type, displayType, usage;
    [MarshalAs(UnmanagedType.LPWStr)] public string localName;
    [MarshalAs(UnmanagedType.LPWStr)] public string remoteName;
    [MarshalAs(UnmanagedType.LPWStr)] public string comment;
    [MarshalAs(UnmanagedType.LPWStr)] public string provider;
  }
  [DllImport("mpr.dll", CharSet=CharSet.Unicode, ExactSpelling=true)]
  public static extern uint WNetAddConnection3W(IntPtr owner, ref Resource resource, string password, string user, uint flags);
}
'@
`

export const NETWORK_CONNECT_SCRIPT = `
if ($env:ADB_VAULT_SHARE_PROMPT -ne '1') {
  try {
    $entries = [IO.Directory]::EnumerateFileSystemEntries($env:ADB_VAULT_FOLDER).GetEnumerator()
    try { $null = $entries.MoveNext() } finally { $entries.Dispose() }
    ConvertTo-Json -Compress -InputObject @{ code=0; message='Existing Windows access' }
    return
  } catch {}
}
` + NETWORK_CONNECT_DECLARATION + `
$resource = New-Object VaultNetwork+Resource
$resource.type = 1
$resource.remoteName = $env:ADB_VAULT_SHARE
$flags = [uint32]0
if ($env:ADB_VAULT_SHARE_PROMPT -eq '1') { $flags = [uint32]24 }
$result = [VaultNetwork]::WNetAddConnection3W([IntPtr]::new([long]$env:ADB_VAULT_SHARE_OWNER), [ref]$resource, $null, $null, $flags)
ConvertTo-Json -Compress -InputObject @{ code = $result; message = ([ComponentModel.Win32Exception]::new([int]$result)).Message }
`

export class NetworkFolders {
  private busy = false
  private controller?: AbortController
  private pending?: Promise<string>
  private mappingRead?: Promise<MappedNetworkFolder[]>
  private mappings?: { readAt: number; values: MappedNetworkFolder[] }
  constructor(private runner: Runner = run, private readMappings = (signal: AbortSignal) => readNetworkMappings(signal, runner)) {}
  async shutdown() { this.controller?.abort(); await Promise.allSettled([this.pending, this.mappingRead]) }
  async connect(address: string, prompt: boolean, owner = '0') {
    if (process.platform !== 'win32') throw new Error('SMB folders currently use the Windows network client.')
    let folder = networkPath(address)
    if (this.busy) throw new Error('Finish the open Windows network sign-in first.')
    this.busy = true
    const controller = this.controller = new AbortController()
    try {
      if (!prompt) {
        try {
          if (!this.mappings || Date.now() - this.mappings.readAt > 30_000) { this.mappingRead = this.readMappings(controller.signal); this.mappings = { values: await this.mappingRead, readAt: Date.now() } }
          folder = preferredNetworkPath(folder, this.mappings.values)
        } catch { controller.signal.throwIfAborted() /* Still try direct access; never force a sign-in dialog. */ }
      }
      controller.signal.throwIfAborted()
      this.pending = powershell(NETWORK_CONNECT_SCRIPT, { ADB_VAULT_FOLDER: folder, ADB_VAULT_SHARE: networkRoot(folder), ADB_VAULT_SHARE_PROMPT: prompt ? '1' : '0', ADB_VAULT_SHARE_OWNER: /^\d+$/.test(owner) ? owner : '0' }, prompt ? 120_000 : 20_000, (file, args, timeout, input, env, options) => this.runner(file, args, timeout, input, env, { ...options, signal: controller.signal }))
      const raw = await this.pending
      const result = JSON.parse(raw) as { code: number; message: string }
      if (result.code === 1223) return undefined
      if (result.code === 1219) throw new Error('Windows already uses another account for this server. Close that connection in Windows or use the same account. Existing connections were not disconnected.')
      if (result.code !== 0) throw new Error(`Cannot connect to the network folder (${result.code}): ${result.message}${!prompt && [5, 86, 1326, 2202].includes(result.code) ? ' Use the server name from Windows or enable Ask Windows for credentials.' : ''}`)
      return folder
    } catch (e) {
      if (e instanceof Error && /Command timed out/.test(e.message)) throw new Error('Network sign-in timed out. Check the server address and try again.')
      throw e
    } finally { this.busy = false; this.pending = undefined; this.mappingRead = undefined; this.controller = undefined }
  }
}
