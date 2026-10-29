import fs from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { ZipFile } from 'yazl'
import { checkSource } from './check-source.mjs'

const root = process.cwd()
const target = path.resolve(process.argv[2] || 'github-ready/ADB-Vault')
const boundary = path.resolve('github-ready') + path.sep
if (!target.startsWith(boundary)) throw new Error('Export must stay inside github-ready/')
try { await fs.access(target); throw new Error('Export target already exists; choose a new empty destination.') } catch (error) { if (error.code !== 'ENOENT') throw error }
const files = await checkSource(root, process.argv[3])
await fs.mkdir(target, { recursive: true })
for (const { file } of files) {
  await fs.mkdir(path.dirname(path.join(target, file)), { recursive: true })
  await fs.copyFile(path.join(root, file), path.join(target, file))
}
const { version } = JSON.parse(await fs.readFile('package.json', 'utf8'))
const zip = new ZipFile()
const archive = path.join(path.dirname(target), `ADB-Vault-${version}-Source.zip`)
const finished = pipeline(zip.outputStream, createWriteStream(archive, { flags: 'wx' }))
for (const { file } of files) zip.addFile(path.join(target, file), `ADB-Vault-${version}/${file}`)
zip.end()
await finished
await fs.writeFile(path.join(path.dirname(target), 'source-inventory.json'), JSON.stringify(files, null, 2) + '\n')
console.log(`Exported ${files.length} files. No repository was published.`)
