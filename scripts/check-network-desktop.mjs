import { _electron as electron } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'

await mkdir('desktop-test-results', { recursive: true })
const profile = await mkdtemp(path.resolve('desktop-test-results/network-desktop-'))
await writeFile(path.join(profile, 'backend.json'), JSON.stringify({ paths: {}, known: [], stopAdbOnExit: false }))
const env = { ...process.env, ADB_VAULT_SMOKE_TEST: '1' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: path.resolve(process.argv[2] || 'release/win-unpacked/ADB Vault.exe'), args: [`--user-data-dir=${profile}`], env, timeout: 30000 })
try {
  const page = await app.firstWindow(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForFunction(() => !!window.desktop)
  const reply = await page.evaluate(() => window.desktop.request({ type: 'snapshot' }))
  assert.equal(reply.ok, true)
  assert.equal(reply.snapshot.components.find(c => c.id === 'geoip')?.status, 'Not installed')
  const malformed = await page.evaluate(() => window.desktop.request({ type: 17 }))
  assert.equal(malformed.ok, false); assert.match(malformed.error, /Unsupported request/)
  const invalid = await page.evaluate(() => window.desktop.request({ type: 'network.trace', requestId: 'invalid-probe', target: { id: 'none', serial: 'none' }, address: '8.8.8.8; reboot' }))
  assert.equal(invalid.ok, false); assert.match(invalid.error, /numeric IPv4 or IPv6/)
  const disconnected = await page.evaluate(() => window.desktop.request({ type: 'network.connections', requestId: 'no-phone', target: { id: 'none', serial: 'none' } }))
  assert.equal(disconnected.ok, false); assert.match(disconnected.error, /connection changed|Wait for the current phone operation/)
  assert.deepEqual(errors, [])
  console.log('PASS: packaged backend starts with MaxMind, optional GeoIP is registered, and network IPC rejects invalid addresses and absent phones. Isolated settings; ADB shutdown disabled.')
} finally { await app.close() }
