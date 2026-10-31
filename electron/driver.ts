import path from 'node:path'
import { readdir, readFile, stat } from 'node:fs/promises'
import { powershell, run, type Runner } from './process.js'

export interface StoredDriver { publishedName: string; version: string }
// PnPUtil's labels are localized. Match invariant INF names/provider/version values.
export function parseGoogleDrivers(output: string): StoredDriver[] {
  return output.split(/\r?\n\s*\r?\n/).flatMap(block => {
    if (!/\bandroid_winusb\.inf\b/i.test(block) || !/\bGoogle\b/i.test(block)) return []
    const publishedName = block.match(/\boem\d+\.inf\b/i)?.[0]
    const version = block.match(/\b\d+(?:\.\d+){3}\b/)?.[0]
    return publishedName && version ? [{ publishedName, version }] : []
  })
}
function infField(text: string, name: string) {
  for (const line of text.split(/\r?\n/)) {
    const separator = line.indexOf('=')
    if (separator < 0 || line.slice(0, separator).trim().toLowerCase() !== name.toLowerCase()) continue
    return line.slice(separator + 1).split(';')[0].trim().replace(/^"|"$/g, '')
  }
}
// Windows publishes a second copy of each staged INF as %SystemRoot%\INF\oemNN.inf.
// Matching the two copies also works when PnPUtil cannot enumerate the store.
export async function publishedGoogleDrivers(windows: string): Promise<StoredDriver[]> {
  const store = path.join(windows, 'System32', 'DriverStore', 'FileRepository')
  const candidates = (await readdir(store, { withFileTypes: true })).filter(dir => dir.isDirectory() && /^android_winusb\.inf_/i.test(dir.name))
  if (!candidates.length) return []
  const infDirectory = path.join(windows, 'INF')
  const published = (await readdir(infDirectory)).filter(name => /^oem\d+\.inf$/i.test(name))
  const packages = new Map<number, { bytes: Buffer; version: string }[]>()
  for (const dir of candidates) {
    const bytes = await readFile(path.join(store, dir.name, 'android_winusb.inf'))
    const inf = bytes.toString(bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '')
    const provider = infField(inf, 'Provider')
    const name = provider?.startsWith('%') && provider.endsWith('%')
      ? infField(inf, provider.slice(1, -1))
      : provider
    const version = inf.match(/^\s*DriverVer\s*=\s*[^,\r\n]+,\s*(\d+(?:\.\d+){3})/im)?.[1]
    if (!/^Google(?:[ ,.]|$)/i.test(name ?? '') || !version) continue
    const sameSize = packages.get(bytes.length) ?? []
    sameSize.push({ bytes, version })
    packages.set(bytes.length, sameSize)
  }
  if (!packages.size) return []
  const result: StoredDriver[] = []
  for (const publishedName of published) {
    const file = path.join(infDirectory, publishedName)
    const sameSize = packages.get((await stat(file)).size)
    if (!sameSize) continue
    const contents = await readFile(file)
    const match = sameSize.find(pkg => contents.equals(pkg.bytes))
    if (match) result.push({ publishedName, version: match.version })
  }
  return result
}
export async function googleDriverInventory(runner: Runner = run, windows = process.env.SystemRoot || 'C:\\Windows') {
  try {
    const output = await powershell(`$output=& "$env:SystemRoot\\System32\\pnputil.exe" /enum-drivers
if($LASTEXITCODE -ne 0) { throw "Windows driver inventory failed (code $LASTEXITCODE)." }
$output`, undefined, 30000, runner)
    return parseGoogleDrivers(output)
  } catch (error) {
    try { return await publishedGoogleDrivers(windows) }
    catch { throw error }
  }
}
export async function installGoogleDriver(folder: string, runner: Runner = run): Promise<{ rebootRequired: boolean; noDeviceChange: boolean }> {
  const inf = path.join(folder, 'android_winusb.inf')
  // Invoke the Windows executable directly, with one quoted INF argument. No shell,
  // forced device binding, driver removal, or automatic reboot.
  const output = await powershell(`try {
  $p=Start-Process -FilePath "$env:SystemRoot\\System32\\pnputil.exe" -ArgumentList @('/add-driver', ('"'+$env:ADB_VAULT_DRIVER_INF+'"'), '/install') -Verb RunAs -Wait -PassThru -WindowStyle Hidden
  $p.ExitCode
} catch {
  if($_.Exception.NativeErrorCode -eq 1223 -or $_.Exception.InnerException.NativeErrorCode -eq 1223) { '1223' } else { throw }
}`, { ADB_VAULT_DRIVER_INF: inf }, 600000, runner)
  const code = Number(output.trim())
  if (code === 1223) throw new Error('Driver installation cancelled at the Windows administrator prompt. The downloaded package is kept; choose Install driver to retry.')
  // 259 means no matching device, or Windows already prefers another driver.
  // The caller must still verify the package in the Driver Store before success.
  if (![0, 259, 3010].includes(code) || !output.trim()) throw new Error(`Windows driver installation failed (code ${output.trim() || 'unknown'}). The package is kept. Check the driver signature and compatibility in Windows Device Manager, then retry.`)
  return { rebootRequired: code === 3010, noDeviceChange: code === 259 }
}
