import { _electron as electron, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
const releaseName = process.argv[2] || 'apk-inspector-20261021'
assert.match(releaseName, /^[a-z0-9-]+$/)
const executablePath = path.resolve('release', releaseName, 'win-unpacked/ADB Vault.exe')
const fixtures = JSON.parse(await readFile('desktop-test-results/apk-inspector-fixtures/latest.json', 'utf8'))
await mkdir('desktop-test-results', { recursive: true })
const root = await mkdtemp(path.resolve('desktop-test-results/apk-inspector-packaged-'))
const env = { ...process.env, ADB_VAULT_SMOKE_TEST: '1' }; delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL
let desktop
try {
  desktop = await electron.launch({ executablePath, args: [`--user-data-dir=${path.join(root, 'profile')}`], env })
  const page = await desktop.firstWindow(), errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.waitForFunction(() => !!window.desktop)
  const request = r => page.evaluate(value => window.desktop.request(value), r)
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Apps', exact: true }).click()
  await page.getByRole('button', { name: 'Local APKs', exact: true }).click()
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'APK Inspector', exact: true })).toHaveCount(0)
  for (const [slot, file] of [['before', fixtures.before], ['after', fixtures.after]]) assert.equal((await request({ type: 'inspector.open', slot, path: file })).ok, true)
  await expect.poll(async () => { const r = await request({ type: 'snapshot' }); return [r.snapshot.apkInspector.before.status, r.snapshot.apkInspector.after.status] }, { timeout: 90000 }).toEqual(['ready', 'ready'])
  const result = (await request({ type: 'snapshot' })).snapshot.apkInspector
  assert.equal(result.before.result.signature.status, 'verified', result.before.result.signature.diagnostics)
  assert.equal(result.after.result.label, 'Inspector Fixture 2'); assert.equal(result.after.result.analysis.status, 'complete')
  await expect(page.getByRole('button', { name: /Compare A → B/ })).toHaveAttribute('aria-pressed', 'true')
  await page.getByLabel('Change category').selectOption('Permissions')
  await expect(page.getByRole('table')).toContainText('android.permission.CAMERA')
  await page.getByRole('button', { name: 'A · Inspect', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'About application', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByLabel('Application badges')).toContainText('Debuggable')
  await expect(page.getByRole('region', { name: 'APK size composition', exact: true })).toContainText('Total APK size')
  assert.equal(await page.locator('.apk-local-details .app-details-groups').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 2)
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 750))
  await expect.poll(() => page.locator('.apk-local-details').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await expect.poll(() => page.locator('.apk-local-details .app-details-groups').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(1)
  await page.getByRole('tab', { name: 'Used permissions', exact: true }).click()
  await expect(page.getByRole('list', { name: 'Used permissions' })).toContainText('android.permission.READ_CONTACTS')
  await expect(page.getByRole('switch')).toHaveCount(0)
  assert.deepEqual(errors, [])
  await writeFile(path.join(root, 'result.json'), JSON.stringify({ passed: true, executablePath, packagedWorker: true, packagedSignatureTools: true, before: result.before.result.sha256, after: result.after.result.sha256 }, null, 2))
  console.log(`Packaged APK inspector passed: ${root}`)
} finally { if (desktop) await desktop.close() }
