import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { auditRelease } from './audit-release.mjs'
const output = path.resolve(process.argv[2] || 'release')
const { version } = JSON.parse(await fs.readFile('package.json', 'utf8'))
const source = path.resolve(process.argv[3] || `github-ready/ADB-Vault-${version}-Source.zip`)
const javaRoot = path.resolve(process.argv[4] || '.tools/publication')
const java = JSON.parse(await fs.readFile(path.join(javaRoot, 'java-source.json'), 'utf8'))
if (java.name !== 'OpenJDK17U-jdk-sources_17.0.20.1_1.tar.gz' || java.version !== '17.0.20.1+1' || java.sha256 !== '21e2a065d244ab048e737f21af5d1fc74daaeb6707de36477ead8db1dca71214') throw new Error('Unexpected Java source metadata')
async function sha256(file) { const h = createHash('sha256'); for await (const chunk of createReadStream(file)) h.update(chunk); return h.digest('hex') }
if (await sha256(path.join(javaRoot, java.name)) !== java.sha256) throw new Error('Java source checksum mismatch')
await auditRelease(output)
const sourceName = `ADB-Vault-${version}-Source.zip`
await fs.copyFile(source, path.join(output, sourceName))
await fs.copyFile(path.join(javaRoot, java.name), path.join(output, java.name))
await fs.writeFile(path.join(output, 'third-party-sources.json'), JSON.stringify({ java, runtimeRecipe: 'scripts/build-inspector-tools.mjs', detectionSources: 'resources/detection-databases/sources', licenceIndex: 'NOTICE.md' }, null, 2) + '\n')
const names = [`ADB-Vault-${version}-Windows-x64-Setup.exe`, `ADB-Vault-${version}-Windows-x64-Portable.zip`, sourceName, java.name, 'third-party-sources.json']
const hashes = []
for (const name of names) hashes.push(`${await sha256(path.join(output, name))}  ${name}`)
await fs.writeFile(path.join(output, 'SHA256SUMS.txt'), hashes.join('\n') + '\n')
console.log(`Prepared ${names.length + 1} release assets. Nothing was uploaded.`)
