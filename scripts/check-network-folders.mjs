import { NetworkFolders } from '../dist-electron/file-network.js'
import { readNetworkMappings } from '../dist-electron/file-network-mappings.js'
import { run } from '../dist-electron/process.js'
import { mkdir, writeFile } from 'node:fs/promises'

// Read-only opening of drives already mapped by this Windows user. No filename/content output.
const mappings = await readNetworkMappings(), results = [], messages = []
const network = new NetworkFolders(async (...args) => {
  const result = await run(...args)
  if (args[4]?.ADB_VAULT_FOLDER) { try { messages.push(JSON.parse(result.stdout).message) } catch {} }
  return result
}, async () => mappings)
try {
  for (const mapped of mappings) {
    const paths = [mapped.path, ...mapped.addresses.slice(0, 1).map(ip => '\\\\' + ip + '\\' + mapped.path.split('\\').slice(3).join('\\'))]
    for (const address of paths) {
      const start = Date.now()
      try { const folder = await network.connect(address, false); results.push({ drive: mapped.drive, address, folder, method: messages.at(-1), ms: Date.now() - start, ok: !!folder }) }
      catch (error) { results.push({ drive: mapped.drive, address, ok: false, error: error.message, ms: Date.now() - start }) }
    }
  }
} finally { await network.shutdown() }
await mkdir('desktop-test-results/files-network-existing', { recursive: true })
await writeFile('desktop-test-results/files-network-existing/report.json', JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2))
console.log(JSON.stringify(results, null, 2))
if (!results.length || results.some(r => !r.ok)) process.exitCode = 1
