// Portable, project-local build tools. Does not modify PATH or install software globally.
import { mkdir, readFile, writeFile, access, readdir } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { XMLParser } from 'fast-xml-parser'
const root = path.resolve('.tools/helper')
await mkdir(root, { recursive: true })
const toolchain = JSON.parse(await readFile('build/toolchain.json', 'utf8'))
const response = await fetch('https://dl.google.com/android/repository/repository2-3.xml')
if (!response.ok) throw new Error('Cannot read Android SDK repository')
const doc = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false }).parse(await response.text())
const packages = doc['sdk-repository'].remotePackage
function sdk(pinned) {
  const id = pinned.id
  const p = packages.find(p => p['@_path'] === id)
  const archives = p.archives.archive
  const archive = (Array.isArray(archives) ? archives : [archives]).find(a => !a['host-os'] || a['host-os'] === 'windows').complete
  const result = { url: `https://dl.google.com/android/repository/${archive.url}`, checksum: archive.checksum['#text'] || archive.checksum, algorithm: archive.checksum['@_type'] || 'sha1' }
  if (result.checksum !== pinned.checksum || result.algorithm !== pinned.algorithm) throw new Error(`Publisher metadata changed for ${id}; review build/toolchain.json before updating.`)
  return result
}
async function unpack(name, pkg) {
  const archive = path.join(root, `${name}.zip`), destination = path.join(root, name)
  try {
    const previous = (await readFile(path.join(destination, '.complete'), 'utf8')).trim()
    if (previous !== pkg.checksum) throw new Error(`${name}: cached toolchain differs; move its folder aside before rebuilding.`)
    return
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  let bytes = await readFile(archive).catch(() => null)
  if (!bytes || createHash(pkg.algorithm).update(bytes).digest('hex') !== pkg.checksum.toLowerCase()) {
    console.log(`Downloading ${name} from ${new URL(pkg.url).hostname}…`)
    const r = await fetch(pkg.url); if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`)
    bytes = Buffer.from(await r.arrayBuffer())
  } else console.log(`Using checksum-verified ${name} archive cache.`)
  if (createHash(pkg.algorithm).update(bytes).digest('hex') !== pkg.checksum.toLowerCase()) throw new Error(`${name}: checksum mismatch`)
  await writeFile(archive, bytes); await mkdir(destination, { recursive: true })
  const script = "$ProgressPreference='SilentlyContinue'; Expand-Archive -LiteralPath $env:HELPER_ARCHIVE -DestinationPath $env:HELPER_DESTINATION -Force"
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(`$ErrorActionPreference='Stop'; ${script}`, 'utf16le').toString('base64')], { windowsHide: true, stdio: 'inherit', env: { ...process.env, HELPER_ARCHIVE: archive, HELPER_DESTINATION: destination } })
  if (await new Promise(resolve => child.on('exit', resolve)) !== 0) throw new Error(`${name}: extraction failed`)
  await writeFile(path.join(destination, '.complete'), pkg.checksum)
  console.log(`${name}: checksum verified and extracted.`)
}
await Promise.all([
  unpack('jdk', toolchain.jdk),
  unpack('platform', sdk(toolchain.platform)),
  unpack('build-tools', sdk(toolchain.buildTools)),
])
async function find(directory, filename) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isFile() && entry.name === filename) return file
    if (entry.isDirectory()) { const result = await find(file, filename); if (result) return result }
  }
}
await writeFile(path.join(root, 'paths.json'), JSON.stringify({ javac: await find(path.join(root, 'jdk'), 'javac.exe'), java: await find(path.join(root, 'jdk'), 'java.exe'), jar: await find(path.join(root, 'jdk'), 'jar.exe'), android: await find(path.join(root, 'platform'), 'android.jar'), d8: await find(path.join(root, 'build-tools'), 'd8.jar') }, null, 2))
console.log('Portable helper toolchain ready.')
