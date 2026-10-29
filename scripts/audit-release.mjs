import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { listPackage, extractFile } from '@electron/asar'

// Inspect the actual packaged payload, not the developer's working directory.
// Optional profile access reads connection identifiers in memory for comparison;
// neither their values nor the profile contents are written to the report.
export async function auditRelease(output, profile) {
  const root = path.resolve(output, 'win-unpacked')
  const archive = path.join(root, 'resources/app.asar')
  const entries = listPackage(archive).map(name => name.replaceAll('\\', '/').replace(/^\//, ''))
  const allowed = new Set(['dist', 'dist-electron', 'node_modules', 'package.json', 'third-party-notices', 'LICENSE', 'NOTICE.md'])
  const privateFile = /(^|\/)(backend\.json(?:\.tmp)?|app-notes\.json|touch-profiles|camera-panel\.json|Local Storage|Session Storage|Cookies|Login Data|adbkey(?:\.pub)?|\.env(?:\.[^/]*)?|\.git|desktop-test-results|backups)(\/|$)/i
  const forbidden = entries.filter(name => !allowed.has(name.split('/')[0]) || privateFile.test(name))
  if (forbidden.length) throw new Error(`ASAR contains ${forbidden.length} unexpected or profile paths; publication is blocked.`)
  const needles = new Set()
  const add = value => {
    if (typeof value !== 'string' || value.length < 6) return
    needles.add(value.toLowerCase())
    if (value.includes('\\')) { needles.add(value.replaceAll('\\', '/').toLowerCase()); needles.add(value.replaceAll('\\', '\\\\').toLowerCase()) }
  }
  add(process.cwd()); add(process.env.USERPROFILE); add(process.env.USERNAME)
  let connectionIdentifiers = 0
  if (profile) {
    const data = JSON.parse(await fs.readFile(profile, 'utf8'))
    add(path.dirname(profile))
    add(profile.match(/[\\/]Users[\\/]([^\\/]+)/i)?.[1])
    for (const device of data.known || []) {
      for (const value of [device.serial, device.hardwareId, device.endpoint, ...(device.aliases || [])]) {
        if (typeof value === 'string' && value.length >= 6) { add(value); connectionIdentifiers++ }
      }
    }
  }
  let fileCount = 0
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
    const file = path.join(entry.parentPath, entry.name)
    const relative = path.relative(root, file).replaceAll('\\', '/')
    if (entry.isSymbolicLink() || privateFile.test(relative) || /^(data|portable-mode)(\/|$)/i.test(relative)) {
      throw new Error('Unpacked build contains a profile, link or unexpected portable marker; publication is blocked.')
    }
    if (!entry.isFile()) continue
    fileCount++
    const content = await fs.readFile(file)
    const utf8 = content.toString('utf8').toLowerCase()
    const utf16 = content.toString('utf16le').toLowerCase()
    if ([...needles].some(value => utf8.includes(value) || utf16.includes(value))) {
      throw new Error(`Local identity/path match in packaged file ${relative}; publication is blocked. Matched values are not logged.`)
    }
  }
  // Ensure the current application code is what was packaged, not a stale build.
  let checked = 0
  for (const folder of ['dist', 'dist-electron']) {
    for (const entry of await fs.readdir(folder, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue
      const file = path.join(entry.parentPath, entry.name)
      const relative = path.relative(process.cwd(), file).replaceAll('\\', '/')
      if (relative.startsWith('dist-electron/data/app-manager/')) continue
      if (!extractFile(archive, path.normalize(relative)).equals(await fs.readFile(file))) throw new Error(`Stale packaged application file: ${relative}`)
      checked++
    }
  }
  const report = { result: 'PASS', asarPaths: entries.length, payloadFiles: fileCount, currentApplicationFiles: checked, localIdentityPatterns: needles.size, connectionIdentifiersCompared: connectionIdentifiers, profilePathsFound: 0, identityMatchesFound: 0 }
  console.log(JSON.stringify(report, null, 2))
  return report
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await auditRelease(process.argv[2] || 'release', process.argv[3])
}
