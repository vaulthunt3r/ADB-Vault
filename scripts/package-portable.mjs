import fs from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { ZipFile } from 'yazl'
import { auditRelease } from './audit-release.mjs'

const output = path.resolve(process.argv[2] || 'release')
const app = path.join(output, 'win-unpacked')
const { version } = JSON.parse(await fs.readFile('package.json', 'utf8'))
await auditRelease(output)
await fs.access(path.join(app, 'ADB Vault.exe'))
await fs.access(path.join(app, 'resources', 'app.asar'))
const name = `ADB-Vault-${version}-Windows-x64-Portable.zip`
const destination = path.join(output, name)
const prefix = 'ADB Vault Portable/'
const zip = new ZipFile()
const completion = pipeline(zip.outputStream, createWriteStream(destination, { flags: 'wx' }))
try {
  for (const entry of await fs.readdir(app, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const file = path.join(entry.parentPath, entry.name)
    const relative = path.relative(app, file).replaceAll('\\', '/')
    if (/^(data\/|portable-mode$)/.test(relative)) throw new Error('Build folder contains a portable profile; refusing to package user data.')
    zip.addFile(file, prefix + relative)
  }
  zip.addBuffer(Buffer.from('ADB Vault portable profile marker. Keep this file beside ADB Vault.exe.\n'), prefix + 'portable-mode')
  zip.addBuffer(Buffer.from(`ADB Vault ${version} - Windows x64 Portable\r\n\r\nExtract the ENTIRE archive to a writable folder, then run ADB Vault.exe.\r\nKeep portable-mode beside the EXE. Settings, notes, game profiles, caches and\r\nmanaged component downloads are stored in the data folder beside the EXE.\r\nMove the entire folder to another location; keep data when updating.\r\nExternal component paths and exported backup locations may need reselecting\r\non another computer. Windows USB drivers and Visual C++ are system components.\r\n\r\nOn first launch, use Components to detect existing tools or download missing\r\nADB/Fastboot and optional scrcpy. Downloads need internet access.\r\nPortable mode does not register an uninstaller or create shortcuts. It does\r\nnot promise zero operating-system traces; Windows and external tools may\r\nuse their normal temporary files and device authorization.\r\n\r\nUpdate: close ADB Vault and its screen windows; extract the new portable\r\narchive separately, then move your data folder into that new folder.\r\nBack up data before updating. Do not run directly inside the ZIP.\r\n`), prefix + 'README.txt')
  zip.end()
  await completion
} catch (error) {
  zip.outputStream.destroy(error)
  await completion.catch(() => {})
  throw error
}

const setupName = `ADB-Vault-${version}-Windows-x64-Setup.exe`
const hashes = []
for (const artifact of [setupName, name]) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path.join(output, artifact))) hash.update(chunk)
  hashes.push(`${hash.digest('hex')}  ${artifact}`)
}
await fs.writeFile(path.join(output, 'SHA256SUMS.txt'), hashes.join('\n') + '\n')
console.log(`Created ${destination} and SHA256SUMS.txt. No files were published.`)
