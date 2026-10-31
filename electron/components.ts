import path from 'node:path'
import { access, readFile, readdir, stat, mkdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { XMLParser } from 'fast-xml-parser'
import type { BackendEvent, ComponentId, ComponentRecord } from './contracts.js'
import { Storage } from './storage.js'
import { checked, powershell, run, type Runner } from './process.js'
import { download, extractZip, officialText, packageVersion, validateMicrosoftInstaller } from './downloads.js'
import { googleDriverInventory, installGoogleDriver } from './driver.js'
import { registeredToolEnvironments, toolFolders } from './tool-locations.js'

const ids: ComponentId[] = ['adb', 'fastboot', 'driver', 'runtime', 'scrcpy']
interface Package { url: string; version: string; size?: number; digest?: string; algorithm?: string }
import { componentCatalog } from './catalog.js'
const array = <T>(value: T | T[] | undefined): T[] => value === undefined ? [] : Array.isArray(value) ? value : [value]
export function platformPackage(xml: string): Package {
  const doc = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false }).parse(xml)
  const remote = array<any>((doc['sdk-repository'] || doc.sdkRepository)?.remotePackage).find(p => p['@_path'] === 'platform-tools')
  const archive = array<any>(remote?.archives?.archive).find(a => a['host-os'] === 'windows')?.complete
  if (!archive || !/^[\w.\-]+\.zip$/.test(archive.url)) throw new Error('Official Platform Tools metadata has no Windows archive.')
  const version = ['major', 'minor', 'micro'].map(key => remote.revision[key] || '0').join('.')
  const digest = typeof archive.checksum === 'object' ? archive.checksum['#text'] : archive.checksum
  const algorithm = archive.checksum?.['@_type'] || 'sha1'
  if (!['sha1', 'sha256'].includes(algorithm) || !/^[\da-f]{40,64}$/i.test(digest)) throw new Error('Official package checksum is missing.')
  return { url: `https://dl.google.com/android/repository/${archive.url}`, version, size: Number(archive.size), digest, algorithm }
}
export const formatBytes = (n: number) => n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`
export function compareVersions(a: string, b: string) {
  const x = a.split(/[.\-]/).map(Number), y = b.split(/[.\-]/).map(Number)
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const diff = (x[i] || 0) - (y[i] || 0); if (diff) return Math.sign(diff) }
  return 0
}
export class ComponentsService {
  records = componentCatalog.map(item => ({ ...item }))
  busy = false
  packages = new Map<ComponentId, Package>()
  constructor(readonly storage: Storage, private emit: (event: BackendEvent) => void, private runner: Runner = run) {}
  private publish() { this.emit({ type: 'components', components: this.records.map(r => ({ ...r })) }) }
  private update(id: ComponentId, patch: Partial<ComponentRecord>) { this.records = this.records.map(r => r.id === id ? { ...r, ...patch } : r); this.publish() }
  private log(text: string, tone: 'info' | 'success' | 'warning' = 'info') { this.emit({ type: 'activity', source: 'components', text, tone }) }
  private availableVersion(id: ComponentId, pkg: Package) {
    this.packages.set(id, pkg)
    const record = this.records.find(item => item.id === id)!
    const ready = ['Installed', 'Detected', 'Update available'].includes(record.status)
    const status = !ready ? record.status : compareVersions(record.version, pkg.version) < 0
      ? 'Update available' : record.managed ? 'Installed' : 'Detected'
    this.update(id, { status, targetVersion: pkg.version, size: formatBytes(pkg.size!) })
  }
  async refreshPackages() {
    const metadata = async (name: string, url: string, apply: (text: string) => void) => {
      try { apply(await officialText(url)) }
      catch (error) { this.log(`${name}: release metadata unavailable — ${error instanceof Error ? error.message : String(error)}\nSource: ${url}`, 'warning') }
    }
    const tasks = [
      metadata('Platform Tools (ADB / Fastboot)', 'https://dl.google.com/android/repository/repository2-3.xml', text => {
        const pkg = platformPackage(text)
        this.availableVersion('adb', pkg)
        this.availableVersion('fastboot', pkg)
      }),
      metadata('scrcpy', 'https://api.github.com/repos/Genymobile/scrcpy/releases/latest', text => {
        const release = JSON.parse(text)
        const asset = release.assets?.find((a: { name: string }) => /^scrcpy-win64-v[\d.]+\.zip$/.test(a.name))
        if (!asset || !/^sha256:[a-f\d]{64}$/i.test(asset.digest ?? '')) throw new Error('scrcpy release has no verified Windows x64 archive.')
        this.availableVersion('scrcpy', { url: asset.browser_download_url, version: String(release.tag_name).replace(/^v/, ''), size: asset.size, digest: asset.digest.slice(7), algorithm: 'sha256' })
      }),
    ]
    this.packages.set('driver', { url: 'https://dl.google.com/android/repository/latest_usb_driver_windows.zip', version: 'Latest official package' })
    this.packages.set('runtime', { url: 'https://aka.ms/vc14/vc_redist.x64.exe', version: 'Latest supported x64' })
    await Promise.all(tasks)
  }
  private async registeredPaths() {
    try { return await registeredToolEnvironments(this.runner) }
    catch {
      this.log('Windows environment settings could not be read. Checking the current PATH and saved folders.', 'warning')
      return []
    }
  }
  async validate(id: ComponentId, folder: string) {
    if (!path.isAbsolute(folder) || !(await stat(folder)).isDirectory()) throw new Error('Choose an existing absolute folder path.')
    if (id === 'driver') {
      const inf = await readFile(path.join(folder, 'android_winusb.inf'), 'utf8')
      if (!/Google/i.test(inf) || !/WinUSB/i.test(inf)) throw new Error('The folder does not contain the Google android_winusb.inf driver.')
      return inf.match(/DriverVer\s*=\s*[^,]+,\s*([\d.]+)/i)?.[1] || 'Driver package'
    }
    if (id === 'runtime') throw new Error('Visual C++ is detected in Windows Registry. Use its installer to install or repair the runtime.')
    const executable = path.join(folder, `${id}.exe`)
    await access(executable)
    const output = checked(await this.runner(executable, [id === 'adb' ? 'version' : '--version']))
    if (id === 'adb' && !/Android Debug Bridge version/i.test(output)) throw new Error('Selected adb.exe did not identify itself as Android Debug Bridge.')
    if (id === 'fastboot' && !/fastboot version/i.test(output)) throw new Error('Selected fastboot.exe did not return its version.')
    if (id === 'scrcpy' && !/^scrcpy\s+[\d.]+/im.test(output)) throw new Error('Selected scrcpy.exe did not return its version.')
    return (id !== 'scrcpy' && await packageVersion(folder)) || output.match(/(?:^Version|fastboot version|^scrcpy)\s+([\d.]+)/im)?.[1] || output.match(/version\s+([\d.]+)/i)?.[1] || 'Unknown'
  }
  async detectOne(id: ComponentId, registered?: ReturnType<ComponentsService['registeredPaths']>) {
    this.update(id, { status: 'Checking', message: undefined, progress: 0 })
    if (id === 'runtime') {
      try {
        const version = await powershell(`$key=Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64' -ErrorAction SilentlyContinue; if($key -and $key.Installed -eq 1) { $key.Version }`, undefined, 15000, this.runner)
        this.update(id, { status: version ? 'Detected' : 'Not installed', version: version.replace(/^v/, '') || '—', location: version ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32') : null, message: version ? 'Installed x64 runtime found in Windows Registry.' : 'No installed Visual C++ v14 x64 runtime was found.' })
      } catch (error) { this.update(id, { status: 'Not detected', message: `Registry check failed: ${String(error)}` }) }
      return
    }
    if (id === 'driver') {
      let inventoryError = ''
      try {
        const driver = (await googleDriverInventory(this.runner)).sort((a, b) => compareVersions(b.version, a.version))[0]
        if (driver) { this.update(id, { status: 'Installed', version: driver.version, location: path.join(process.env.SystemRoot || 'C:\\Windows', 'INF'), message: `Verified in the Windows Driver Store as ${driver.publishedName}. Available for compatible Google devices, including when no phone is connected. Windows selects the appropriate driver for each device; this does not mean the current phone uses this package.` }); return }
      } catch (error) { inventoryError = `Driver Store could not be checked: ${String(error)}`; this.log(inventoryError, 'warning') }
      const folder = this.storage.data.paths.driver
      if (folder) try { const version = await this.validate(id, folder); this.update(id, { version, location: folder, status: 'Package ready', message: `${inventoryError ? inventoryError + ' ' : ''}Files are ready. Choose Install driver to add this package to Windows and apply it to compatible devices. Approve the Windows administrator prompt. The existing download will be reused. This optional Google driver is not needed if your USB connection already works.` }); return } catch { /* Continue with the undetected state. */ }
      this.update(id, { status: inventoryError ? 'Not detected' : 'Not installed', version: '—', location: null, message: inventoryError || 'No Google ADB driver was detected. This optional package is for Google devices. Other devices use their manufacturer’s driver; if USB already works, no driver change is needed.' }); return
    }
    if (id !== 'adb' && id !== 'fastboot' && id !== 'scrcpy') return
    let failure = ''
    for (const folder of toolFolders(id, this.storage.data.paths, await (registered ?? this.registeredPaths()), this.storage.hasAutomaticAdbCopy)) {
      try { await access(path.join(folder, `${id}.exe`)) } catch { continue }
      try {
        const version = await this.validate(id, folder)
        const target = this.packages.get(id)?.version
        const managed = folder.startsWith(path.join(this.storage.root, 'components') + path.sep)
        this.update(id, { version, location: folder, managed, status: target && compareVersions(version, target) < 0 ? 'Update available' : managed ? 'Installed' : 'Detected', message: `${managed ? 'Managed installation' : 'Existing installation'} verified by ${id}.exe.`, targetVersion: target || '—' }); return
      } catch (error) { failure = `${folder}: ${error instanceof Error ? error.message : String(error)}` }
    }
    this.update(id, { status: failure ? 'Repair needed' : 'Not installed', version: '—', location: null, message: failure || 'Not found in saved locations, Android SDK or PATH. Download a managed copy or locate an existing installation.' })
  }
  async detect() {
    if (this.busy) throw new Error('A component operation is already running.')
    this.busy = true
    try {
      const registered = this.registeredPaths()
      await Promise.all(ids.map(id => this.detectOne(id, registered)))
    } finally { this.busy = false }
  }
  async locate(id: ComponentId, folder: string) {
    if (this.busy) throw new Error('Wait for the current component operation.')
    if (id === 'adb') {
      folder = folder.trim().replace(/^"([^"]+)"$/, '$1')
      if (!path.isAbsolute(folder)) throw new Error('Choose the full path to adb.exe or the folder containing it.')
      if (/\.exe$/i.test(folder)) {
        if (path.basename(folder).toLowerCase() !== 'adb.exe') throw new Error('Choose adb.exe, or the folder containing it.')
        folder = path.dirname(folder)
      }
    }
    let version: string
    try {
      version = await this.validate(id, folder)
    } catch (error) {
      if (id === 'adb' && ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        throw new Error('Could not find adb.exe at this location. Choose adb.exe or its platform-tools folder.')
      }
      throw error
    }
    this.storage.data.paths[id] = path.resolve(folder)
    if (id === 'adb') this.storage.data.manualAdb = true
    if (id === 'adb' || (id === 'fastboot' && !this.adbPath())) { const other = id === 'adb' ? 'fastboot' : 'adb'; try { await this.validate(other, folder); this.storage.data.paths[other] = path.resolve(folder) } catch {} }
    await this.storage.save(); await this.detect(); this.log(`${id}: verified version ${version} in ${folder}.`, 'success')
  }
  adbPath() { const record = this.records.find(r => r.id === 'adb')!; return record.location && record.version !== '—' ? path.join(record.location, 'adb.exe') : null }
  private async installDriverPackage(folder: string) {
    const version = await this.validate('driver', folder)
    this.update('driver', { status: 'Installing', location: folder, version, progress: 100, message: 'Waiting for Windows driver installation. Approve the administrator prompt to continue.' })
    const result = await installGoogleDriver(folder, this.runner)
    const installed = (await googleDriverInventory(this.runner)).find(driver => compareVersions(driver.version, version) >= 0)
    if (!installed) throw new Error('Windows finished the command, but the Google driver package could not be verified in the Driver Store. Check components again or retry installation.')
    this.update('driver', { status: 'Installed', version: installed.version, location: path.join(process.env.SystemRoot || 'C:\\Windows', 'INF'), message: `Verified in the Windows Driver Store as ${installed.publishedName}. Windows applies this package only to matching devices when it is the preferred driver.${result.noDeviceChange ? ' No device driver was changed: no matching device was found, or Windows already prefers its current driver.' : ''}${result.rebootRequired ? ' Windows requests a restart; restart manually when ready.' : ''}` })
    this.log('Google USB Driver: installation verified in the Windows Driver Store.', 'success')
  }
  async install(id: ComponentId) {
    if (this.busy) throw new Error('A component operation is already running.')
    this.busy = true
    const affected: ComponentId[] = [id]
    if (id === 'adb' || id === 'fastboot') {
      const sibling = this.records.find(record => record.id === (id === 'adb' ? 'fastboot' : 'adb'))!
      if (!['Installed', 'Detected'].includes(sibling.status)) affected.push(sibling.id)
    }
    let phase = 'download'
    try {
      // Continue a prepared installation (or retry after UAC cancellation) without
      // downloading another copy. Invalid/missing local packages are downloaded again.
      if (id === 'driver' && this.storage.data.paths.driver) {
        const folder = this.storage.data.paths.driver
        let valid = false
        try { await this.validate('driver', folder); valid = true } catch {}
        if (valid) { phase = 'install'; await this.installDriverPackage(folder); return }
      }
      if (!this.packages.has(id)) await this.refreshPackages()
      const pkg = this.packages.get(id)
      if (!pkg) throw new Error('Cannot fetch the official package metadata. Check your connection and retry.')
      for (const item of affected) this.update(item, { status: 'Downloading', progress: 0, message: undefined })
      const root = path.join(this.storage.root, 'components', `${id}-${randomUUID()}`)
      await mkdir(root, { recursive: true })
      const archive = path.join(root, id === 'runtime' ? 'vc_redist.x64.exe' : 'package.zip')
      await download(pkg.url, archive, pkg, progress => { for (const item of affected) this.update(item, { progress }) })
      phase = 'install'; for (const item of affected) this.update(item, { status: 'Installing', progress: 100 })
      if (id === 'runtime') {
        await validateMicrosoftInstaller(archive)
        // RunAs is intentionally visible to Windows so the user can approve elevation.
        const exitCode = await powershell(`$p=Start-Process -FilePath $env:ADB_VAULT_INSTALLER -ArgumentList '/install','/passive','/norestart' -Verb RunAs -Wait -PassThru -WindowStyle Hidden; $p.ExitCode`, { ADB_VAULT_INSTALLER: archive }, 600000, this.runner)
        if (!['0', '1638', '3010'].includes(exitCode.trim())) throw new Error(`Microsoft installer returned ${exitCode}.`)
        await this.detectOne(id)
        if (this.records.find(r => r.id === id)!.status !== 'Detected') throw new Error('The installer finished, but the runtime is still not registered in Windows.')
        if (exitCode.trim() === '3010') this.update(id, { message: 'Installed. Windows requests a restart; restart manually when ready.' })
      } else {
        const extracted = path.join(root, 'files'); await extractZip(archive, extracted)
        const queue = [extracted]; let location: string | undefined
        while (queue.length) {
          const folder = queue.shift()!
          try { await access(path.join(folder, id === 'driver' ? 'android_winusb.inf' : `${id}.exe`)); location = folder; break } catch {}
          if (path.relative(extracted, folder).split(path.sep).length < 4) for (const entry of await readdir(folder, { withFileTypes: true })) if (entry.isDirectory()) queue.push(path.join(folder, entry.name))
        }
        if (!location) throw new Error('Downloaded package does not contain the expected component.')
        for (const item of affected) await this.validate(item, location)
        for (const item of affected) this.storage.data.paths[item] = location
        if (affected.includes('adb')) this.storage.data.manualAdb = false
        await this.storage.save()
        if (id === 'driver') await this.installDriverPackage(location)
        else for (const item of affected) await this.detectOne(item)
      }
      this.log(`${id}: package downloaded and verified.`, 'success')
    } catch (error) {
      for (const item of affected) this.update(item, { status: phase === 'download' ? 'Download failed' : 'Install failed', message: error instanceof Error ? error.message : String(error), progress: 0 })
      throw error
    } finally { this.busy = false }
  }
}
