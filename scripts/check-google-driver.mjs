// Read-only by default. --install explicitly installs the existing saved package;
// Windows asks for administrator approval. No download or forced device binding.
import path from 'node:path'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { ComponentsService } from '../dist-electron/components.js'
import { Storage } from '../dist-electron/storage.js'

assert.ok(process.env.APPDATA, 'This check requires Windows APPDATA.')
const storage = new Storage(path.join(process.env.APPDATA, 'adb-vault'))
await storage.load()
const service = new ComponentsService(storage, event => {
  if (event.type === 'activity') console.log(event.text)
})
await service.detectOne('driver')
console.log('Before:', JSON.stringify(service.records.find(c => c.id === 'driver')))
if (process.argv.includes('--install')) {
  const folder = storage.data.paths.driver
  assert.ok(folder, 'Locate or download a Google driver package in the application first.')
  await service.validate('driver', folder)
  console.log('Installing existing package. Approve the Windows administrator prompt…')
  await service.install('driver')
  assert.equal(service.records.find(c => c.id === 'driver').status, 'Installed')
}
// Verify detection afresh, without relying on the install operation's in-memory status.
const restarted = new ComponentsService(storage, () => {})
await restarted.detectOne('driver')
const result = restarted.records.find(c => c.id === 'driver')
console.log('Fresh detection:', JSON.stringify(result))
await mkdir('desktop-test-results', { recursive: true })
await writeFile('desktop-test-results/google-driver.json', JSON.stringify({ checkedAt: new Date().toISOString(), installationRequested: process.argv.includes('--install'), component: result }, null, 2))
if (process.argv.includes('--install')) assert.equal(result.status, 'Installed')
