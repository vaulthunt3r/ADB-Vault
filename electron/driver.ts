import path from 'node:path'
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
export async function googleDriverInventory(runner: Runner = run) {
  const output = await powershell(`$output=& "$env:SystemRoot\\System32\\pnputil.exe" /enum-drivers
if($LASTEXITCODE -ne 0) { throw "Windows driver inventory failed (code $LASTEXITCODE)." }
$output`, undefined, 30000, runner)
  return parseGoogleDrivers(output)
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
