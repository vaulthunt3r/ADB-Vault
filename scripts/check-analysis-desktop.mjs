import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'vite'
import { _electron as electron, expect } from '@playwright/test'
const output = path.resolve('desktop-test-results/analysis'); await mkdir(output, { recursive: true })
const profile = path.join(output, `profile-${Date.now()}`); await mkdir(profile)
const saved = JSON.parse(await readFile(path.join(process.env.APPDATA, 'adb-vault/backend.json'), 'utf8'))
await writeFile(path.join(profile, 'backend.json'), JSON.stringify({ paths: saved.paths, known: [], appsOptions: { icons: false, early: false, storage: false } }))
const server = await createServer({ server: { port: 5181, strictPort: true } }); await server.listen()
const env = { ...process.env, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5181', ADB_VAULT_SMOKE_TEST: '1' }; delete env.ELECTRON_RUN_AS_NODE
const packaged = process.argv.includes('--packaged')
let desktop
try {
  desktop = await electron.launch({ ...(packaged ? { executablePath: path.resolve('desktop-test-results/analysis-build/win-unpacked/ADB Vault.exe') } : {}), args: [...(packaged ? [] : ['.']), `--user-data-dir=${profile}`], env })
  const page = await desktop.firstWindow(), errors = []; page.on('pageerror', e => errors.push(e.message))
  await expect.poll(async () => (await page.evaluate(() => window.desktop.request({ type: 'snapshot' }))).snapshot.components.filter(c => c.group === 'Detection databases' && c.status === 'Installed').length, { timeout: 30000 }).toBe(4)
  if (packaged) { const snapshot = (await page.evaluate(() => window.desktop.request({ type: 'snapshot' }))).snapshot; assert.ok(snapshot.components.find(c => c.id === 'db-trackers').location.endsWith('detection-databases')) }
  await page.getByRole('button', { name: 'Select Tracker signatures', exact: true }).click()
  await page.getByRole('tab', { name: 'Actions', exact: true }).click()
  const inspector = page.getByRole('tabpanel')
  await expect(inspector.getByRole('button', { name: 'Update databases', exact: true })).toBeVisible()
  await expect(inspector.getByRole('button', { name: 'Locate manually' })).toHaveCount(0)
  if (!packaged) await page.screenshot({ path: path.join(output, 'components.png') })
  await expect.poll(async () => (await page.evaluate(() => window.desktop.request({ type: 'snapshot' }))).snapshot.connection.activeDeviceId, { timeout: 30000 }).toBeTruthy()
  await page.getByRole('navigation').getByRole('button', { name: 'Apps', exact: true }).click()
  await expect(page.getByRole('table', { name: 'Installed applications' })).toBeVisible({ timeout: 120000 })
  await page.getByRole('searchbox', { name: 'Search applications' }).fill('ru.fourpda.client')
  await page.getByRole('table').getByRole('row').filter({ hasText: 'ru.fourpda.client' }).dblclick()
  await expect(page.getByRole('button', { name: '3 trackers', exact: true })).toBeVisible({ timeout: 60000 })
  await page.getByRole('button', { name: '3 trackers', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('²ACRA')
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Scan APKs', exact: true }).click()
  const analysis = page.getByRole('region', { name: 'APK analysis', exact: true })
  await expect(analysis).toContainText('Scan complete', { timeout: 120000 })
  await analysis.locator('.apk-analysis-results').first().getByRole('button').first().click()
  await expect(page.getByRole('dialog')).toContainText('org.acra.')
  if (!packaged) await page.screenshot({ path: path.join(output, 'tracker-classes.png') })
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click()
  await analysis.scrollIntoViewIfNeeded()
  if (!packaged) await page.screenshot({ path: path.join(output, 'analysis.png') })
  assert.deepEqual(errors, [])
  console.log('PASS: Electron database actions, real manifest badge, DEX scan, matched-class dialog; no renderer errors.')
} finally { await desktop?.close(); await server.close() }
