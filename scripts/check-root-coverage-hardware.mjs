import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { AppDetailsReader } from '../dist-electron/app-details.js'
import { emptyApps } from '../dist-electron/apps-protocol.js'
import { parseDevices } from '../dist-electron/connections.js'
import { checked, run } from '../dist-electron/process.js'
import { shellQuote } from '../dist-electron/root-badges.js'

const config = JSON.parse(await readFile(path.join(process.env.APPDATA, 'adb-vault/backend.json'), 'utf8'))
const adb = path.join(config.paths.adb, 'adb.exe')
const device = parseDevices(checked(await run(adb, ['devices', '-l']))).find(d => d.status === 'connected')
if (!device) throw new Error('Connect an authorized test phone.')
const root = async command => checked(await run(adb, ['-s', device.serial, 'shell', 'su', '-c', shellQuote(command)], 60000))
const profiles = checked(await run(adb, ['-s', device.serial, 'shell', 'pm', 'list', 'users']))
const userIds = [...profiles.matchAll(/UserInfo\{(\d+):/g)].map(m => Number(m[1]))
if (!userIds.length) throw new Error('No Android profiles reported.')
const modules = (await root(`find /data/adb/modules -type f -name '*.apk'`)).split(/\r?\n/).filter(Boolean)
const mounts = []
for (const apk of modules) {
  const module = apk.match(/^\/data\/adb\/modules\/([^/]+)\/system\//)?.[1]
  if (!module) continue
  const dir = '/data/adb/modules/' + module
  const node = await root(`if [ ! -e ${shellQuote(dir + '/disable')} ] && [ ! -e ${shellQuote(dir + '/remove')} ] && [ ! -e ${shellQuote(dir + '/skip_mount')} ]; then stat -c '%d:%i' ${shellQuote(apk)}; fi`)
  if (node) mounts.push({ module, apk, node })
}
const denyList = (await root('magisk --denylist ls')).split(/\r?\n/).filter(Boolean)
if (denyList.some(l => !/^[\w.]+\|[^\s|]+$/.test(l))) throw new Error('Unsupported DenyList output.')
const profilesReport = []
for (const userId of userIds) {
  const output = await root(`pm list packages -f --user ${userId} | while IFS= read -r line; do file="\${line#package:}"; pkg="\${file##*=}"; file="\${file%=*}"; node=$(stat -c '%d:%i' "$file" 2>/dev/null) || node=unavailable; printf '%s\t%s\t%s\n' "$pkg" "$file" "$node"; done`)
  const apps = output.split(/\r?\n/).filter(Boolean).map(line => { const [packageName, source, node] = line.split('\t'); if (!/^[\w.]+$/.test(packageName) || !source?.startsWith('/') || !node) throw new Error('Invalid installed APK record'); return { packageName, source, node } })
  const systemless = apps.flatMap(app => mounts.filter(m => m.node === app.node).map(m => ({ packageName: app.packageName, module: m.module, source: app.source })))
  const deny = denyList.filter(line => apps.some(app => app.packageName === line.split('|')[0]))
  const verify = [...new Set([...systemless.map(a => a.packageName), ...deny.map(line => line.split('|')[0])])]
  const snapshot = { ...emptyApps(), deviceId: device.id, userId, status: 'ready', apps, options: { icons: false, early: false, storage: false, root: true } }
  let state
  const reader = new AppDetailsReader(path.resolve('android-helper/dist'), () => adb, () => ({ devices: [device], activeDeviceId: device.id }), () => snapshot, value => { state = value })
  const verified = []
  for (const pkg of verify) {
    await reader.read(device.id, userId, pkg)
    if (state.status !== 'ready') throw new Error(state.error)
    verified.push({ packageName: pkg, checks: Object.fromEntries(['systemless', 'magiskDenyList'].map(key => [key, state.data.badgeChecks?.[key]])) })
  }
  profilesReport.push({ userId, packages: apps.length, unavailableApkStats: apps.filter(a => a.node === 'unavailable').length, systemless, denyList: deny, verified })
}
const report = { device: device.name, profiles: profilesReport, moduleApks: modules.length, activeModuleApks: mounts.length, denyListRules: denyList.length }
await mkdir('desktop-test-results/root-device', { recursive: true })
await writeFile('desktop-test-results/root-device/coverage.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
