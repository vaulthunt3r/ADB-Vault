import path from 'node:path'
import { powershell, type Runner } from './process.js'

type Executable = 'adb' | 'fastboot' | 'scrcpy'
type ToolEnvironment = Record<string, string | undefined>

// Read only tool locations. A desktop shortcut may inherit an older environment
// than the one currently saved in Windows. Never modify the process or registry.
export async function registeredToolEnvironments(runner: Runner): Promise<ToolEnvironment[]> {
  if (process.platform !== 'win32') return []
  const json = await powershell(String.raw`
$user = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')
$machine = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey('SYSTEM\CurrentControlSet\Control\Session Manager\Environment')
function RawValue($key, $name) {
  if ($key) { $key.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) }
}
function ExpandPath([string]$value) {
  for ($i=0; $i -lt 8 -and $value.Contains('%'); $i++) {
    $expanded = [regex]::Replace($value, '%([^%]+)%', {
      param($match)
      $name = $match.Groups[1].Value
      $item = RawValue $user $name
      if ($null -eq $item) { $item = RawValue $machine $name }
      if ($null -eq $item) { $item = [Environment]::GetEnvironmentVariable($name) }
      if ($null -eq $item) { return $match.Value }
      return [string]$item
    })
    if ($expanded -eq $value) { break }
    $value = $expanded
  }
  return $value
}
try {
  $scopes = foreach ($key in @($machine, $user)) {
    $paths = @{}
    foreach ($name in @('Path','ADB','ADB_PATH','ANDROID_HOME','ANDROID_SDK_ROOT')) {
      $value = RawValue $key $name
      if ($value) { $paths[$name] = ExpandPath $value }
    }
    $paths
  }
  ConvertTo-Json -InputObject @($scopes) -Compress
} finally {
  if ($user) { $user.Dispose() }
  if ($machine) { $machine.Dispose() }
}`, undefined, 10000, runner)
  const scopes: unknown = JSON.parse(json)
  if (!Array.isArray(scopes) || !scopes.every(scope => scope && typeof scope === 'object' && Object.values(scope).every(value => typeof value === 'string'))) {
    throw new Error('Windows returned an invalid tool environment.')
  }
  return scopes
}

export function toolFolders(id: Executable, saved: ToolEnvironment, scopes: ToolEnvironment[], automaticAdbCopy = false) {
  const env = process.env
  const directories: string[] = []
  const seen = new Set<string>()
  const add = (value: string | undefined, sdkRoot = false) => {
    if (!value) return
    let entry = value.trim().replace(/^"(.*)"$/, '$1').trim()
    entry = entry.replace(/%([^%]+)%/g, (reference, name: string) => env[name] ?? reference)
    if (!path.isAbsolute(entry) || (process.platform === 'win32' && !/^(?:[a-z]:[\\/]|[\\/]{2}[^\\/])/i.test(entry)) || /%[^%]+%/.test(entry)) return
    if (sdkRoot) entry = path.join(entry, 'platform-tools')
    else if (path.basename(entry).toLowerCase() === id + '.exe') entry = path.dirname(entry)
    const folder = path.normalize(entry)
    const key = process.platform === 'win32' ? folder.toLowerCase() : folder
    if (!seen.has(key)) { seen.add(key); directories.push(folder) }
  }
  if (id !== 'adb' || !automaticAdbCopy) add(saved[id])
  const environments = [env, ...scopes]
  if (id === 'adb') for (const source of environments) {
    add(source.ADB)
    add(source.ADB_PATH)
  }
  for (const source of environments) {
    for (const entry of (source.Path || source.PATH || '').split(path.delimiter)) add(entry)
  }
  if (id !== 'scrcpy') {
    for (const source of environments) {
      add(source.ANDROID_SDK_ROOT, true)
      add(source.ANDROID_HOME, true)
    }
    if (env.LOCALAPPDATA) add(path.join(env.LOCALAPPDATA, 'Android', 'Sdk'), true)
    if (id === 'adb' && automaticAdbCopy) add(saved.adb)
    add(saved[id === 'adb' ? 'fastboot' : 'adb'])
  }
  return directories
}
