import { _electron as electron, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const fixtures = JSON.parse(await readFile('desktop-test-results/apk-inspector-fixtures/latest.json', 'utf8'))
await mkdir('desktop-test-results', { recursive: true })
const root = await mkdtemp(path.resolve('desktop-test-results/apk-inspector-ipc-'))
const harness = path.join(root, 'main.mjs'), report = path.join(root, 'inspection.json')
await writeFile(harness, `
import { Backend } from ${JSON.stringify(pathToFileURL(path.resolve('dist-electron/backend.js')).href)};
import { dialog } from 'electron';
globalThis.inspectorTest = { phoneCommands: [], picks: ${JSON.stringify([fixtures.before, fixtures.after])} };
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [globalThis.inspectorTest.picks.shift()] });
dialog.showSaveDialog = async () => ({ canceled: false, filePath: ${JSON.stringify(report)} });
Backend.prototype.initialize = async function () {
  globalThis.inspectorTest.backend = this;
  this.storage.data.stopAdbOnExit = false;
  this.lifecycle.execute = async (...args) => { globalThis.inspectorTest.phoneCommands.push(args); throw new Error('Phone access is not allowed in offline inspection test.'); };
};
await import(${JSON.stringify(pathToFileURL(path.resolve('dist-electron/main.js')).href)});
`)
const env = { ...process.env, ADB_VAULT_SMOKE_TEST: '1' }; delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL
let desktop
try {
  desktop = await electron.launch({ args: [harness, `--user-data-dir=${path.join(root, 'profile')}`], env })
  const page = await desktop.firstWindow(), errors = []
  page.on('pageerror', e => errors.push(e.message)); await page.waitForFunction(() => !!window.desktop)
  const request = r => page.evaluate(value => window.desktop.request(value), r)
  assert.equal((await request({ type: 'inspector.open', slot: 'other', path: fixtures.before })).ok, false)
  assert.equal((await request({ type: 'inspector.open', slot: 'before', path: 'relative.apk' })).ok, false)
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Apps', exact: true }).click()
  await page.getByRole('button', { name: 'Local APKs', exact: true }).click()
  const a = page.getByRole('region', { name: 'Before APK', exact: true }), b = page.getByRole('region', { name: 'After APK', exact: true })
  await a.getByRole('button', { name: 'Open APK', exact: true }).click()
  await expect(a.getByRole('heading', { name: 'Inspector Fixture 1' })).toBeVisible({ timeout: 60000 })
  await expect(a.locator('.apk-signature')).toHaveText('Valid signature')
  await b.getByRole('button', { name: 'Open APK', exact: true }).click()
  await expect(b.getByRole('heading', { name: 'Inspector Fixture 2' })).toBeVisible({ timeout: 60000 })
  await expect(page.getByRole('button', { name: /Compare A → B/ })).toHaveAttribute('aria-pressed', 'true')
  await page.getByLabel('Change category').selectOption('Permissions')
  await expect(page.getByRole('table')).toContainText('android.permission.CAMERA')
  await expect(page.getByRole('table')).toContainText('android.permission.READ_CONTACTS')
  await page.screenshot({ path: path.join(root, 'compare.png') })
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('APK inspection report saved.')
  const saved = JSON.parse(await readFile(report, 'utf8'))
  assert.equal(saved.before.signature.status, 'verified'); assert.ok(saved.changes.some(c => c.group === 'Components' && c.name.includes('NewService')))
  await page.getByRole('button', { name: 'A · Inspect', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'About application', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.app-full-heading')).toContainText('dev.adbvault.inspectorfixture')
  await expect(page.getByLabel('Application badges')).toContainText('Debuggable')
  await expect(page.getByLabel('Application badges')).toContainText('APK file')
  await page.screenshot({ path: path.join(root, 'overview.png') })
  await page.getByLabel('Application badges').getByRole('button', { name: /tracker/ }).click()
  await expect(page.getByRole('dialog')).toContainText('Tracker signatures · DEX')
  await expect(page.getByRole('dialog')).toContainText('Firebase')
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Badge legend', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('unavailable in a local APK')
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('tab', { name: 'Used permissions', exact: true }).click()
  await expect(page.getByRole('list', { name: 'Used permissions' })).toContainText('android.permission.READ_CONTACTS')
  await expect(page.getByRole('list', { name: 'Used permissions' })).toContainText('maxSdkVersion')
  await expect(page.getByRole('switch')).toHaveCount(0)
  await page.getByRole('searchbox', { name: 'Search used permissions' }).fill('READ_CONTACTS')
  await expect(page.getByRole('list', { name: 'Used permissions' }).getByRole('listitem')).toHaveCount(1)
  await page.getByRole('tab', { name: 'Activities', exact: true }).click()
  await expect(page.getByRole('list', { name: 'Activities' })).toContainText('MainActivity')
  await page.getByText('Intent filters & metadata', { exact: true }).click()
  await expect(page.getByRole('list', { name: 'Activities' })).toContainText('android.intent.action.MAIN')
  await page.getByRole('tab', { name: 'Services', exact: true }).click()
  await expect(page.getByRole('tabpanel', { name: 'Services' })).toContainText('No services declared.')
  await page.getByRole('tab', { name: 'About application', exact: true }).click()
  const analysis = page.getByRole('region', { name: 'APK analysis', exact: true })
  await expect(analysis).toContainText('Scan complete')
  await expect(analysis.getByRole('group', { name: 'Size by category' })).toBeVisible()
  const widths = await analysis.locator('.apk-size-bar > span').evaluateAll(nodes => nodes.map(n => parseFloat(n.style.width)))
  assert.ok(Math.abs(widths.reduce((sum, n) => sum + n, 0) - 100) < 0.001)
  await analysis.getByRole('button', { name: 'About APK sizes', exact: true }).click()
  await expect(analysis).toContainText('selected local APK')
  await analysis.getByRole('button', { name: 'About address scanning', exact: true }).click()
  await expect(analysis).toContainText('Compiled resources, native binary strings')
  await analysis.getByRole('searchbox', { name: 'Search addresses' }).fill('fixture.example.com')
  await expect(analysis.getByRole('list', { name: 'Found addresses' })).toContainText('fixture.example.com')
  await analysis.locator('.apk-analysis-match').first().click()
  await expect(page.getByRole('dialog')).toContainText('com.google.firebase.analytics')
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await analysis.scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(root, 'analysis.png') })
  await page.getByRole('tab', { name: 'APK contents', exact: true }).click()
  await expect(page.locator('.apk-pages')).toContainText('Page 1 of 3')
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.locator('.apk-pages')).toContainText('Page 2 of 3')
  await page.getByRole('searchbox', { name: 'Search APK contents' }).fill('item-124')
  await expect(page.getByRole('table')).toContainText('assets/pagination/item-124.txt')
  await expect(page.locator('.apk-filter')).toContainText('1 results')
  await page.getByRole('searchbox', { name: 'Search APK contents' }).fill('')
  await page.getByRole('button', { name: 'Swap A / B', exact: true }).click()
  await expect(a.getByRole('heading', { name: 'Inspector Fixture 2' })).toBeVisible()
  await page.getByRole('button', { name: 'Clear before APK' }).click()
  await page.getByRole('button', { name: 'Clear after APK' }).click()
  // CDP file input creates File objects backed by actual local paths, as a native drop does.
  await page.evaluate(() => { const input = document.createElement('input'); input.type = 'file'; input.multiple = true; input.id = 'test-apk-input'; input.hidden = true; document.body.append(input) })
  await page.locator('#test-apk-input').setInputFiles([fixtures.before, fixtures.after])
  assert.equal(await page.evaluate(() => window.desktop.apkPath(document.querySelector('#test-apk-input').files[0])), fixtures.before)
  await page.evaluate(() => { const transfer = new DataTransfer(); for (const file of document.querySelector('#test-apk-input').files) transfer.items.add(file); document.querySelector('.apk-inspector').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })) })
  await expect(a.getByRole('heading', { name: 'Inspector Fixture 1' })).toBeVisible({ timeout: 60000 })
  await expect(b.getByRole('heading', { name: 'Inspector Fixture 2' })).toBeVisible({ timeout: 60000 })
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 750))
  await expect.poll(() => page.evaluate(() => document.querySelector('.apk-inspector').scrollWidth <= document.querySelector('.apk-inspector').clientWidth)).toBe(true)
  await page.screenshot({ path: path.join(root, 'narrow.png') })
  await page.getByRole('button', { name: 'A · Inspect', exact: true }).click()
  await expect.poll(() => page.locator('.apk-local-details').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.screenshot({ path: path.join(root, 'narrow-details.png') })
  await page.getByRole('button', { name: 'Clear before APK' }).click()
  assert.equal((await request({ type: 'inspector.open', slot: 'before', path: fixtures.tampered })).ok, true)
  await expect(a.locator('.apk-signature')).toHaveText('Invalid / unsigned', { timeout: 60000 })
  await page.getByRole('button', { name: 'Clear before APK' }).click()
  await request({ type: 'inspector.open', slot: 'before', path: fixtures.malformed })
  await expect.poll(async () => (await request({ type: 'snapshot' })).snapshot.apkInspector.before.status).toBe('error')
  // Local inspection lives inside Apps; navigating back preserves loaded APKs.
  const nav = page.getByRole('navigation', { name: 'Main navigation' })
  await expect(nav.getByRole('button', { name: 'APK Inspector', exact: true })).toHaveCount(0)
  await expect(nav.getByRole('button', { name: 'Apps', exact: true })).toHaveAttribute('aria-current', 'page')
  await page.getByRole('button', { name: 'Back to installed applications', exact: true }).click()
  await page.getByRole('button', { name: 'Local APKs', exact: true }).click()
  await expect(b.getByRole('heading', { name: 'Inspector Fixture 2' })).toBeVisible()
  // Old workspace IDs are removed without changing the remaining preferences.
  await page.evaluate(() => localStorage.setItem('adb-vault-layout', JSON.stringify({ version: 1, state: { workspaceOrder: ['inspector', 'console', 'files', 'console', 'missing', 'settings'], hiddenWorkspaces: ['inspector', 'files', 'unknown'], leftSidebar: 'expanded' } })))
  await page.reload()
  await expect(nav.getByRole('button')).toHaveText(['Console', 'Components', 'Connection', 'Apps', 'Monitor', 'Activity', 'Settings'])
  // The same shared components must retain the installed application's grant controls.
  await desktop.evaluate(() => {
    const backend = globalThis.inspectorTest.backend
    const app = { packageName: 'dev.adbvault.detailfixture', label: 'Installed details fixture', versionName: '1', versionCode: 1, uid: 10001, userId: 0, enabled: true, system: false, updatedSystemApp: false, sourceDir: '/data/app/fixture/base.apk', firstInstallTime: 0, lastUpdateTime: 0, targetSdk: 35, minSdk: 23, installer: null, enabledState: 0, suspended: false, stopped: false, debuggable: false, iconPng: null }
    backend.connection.state = { ...backend.connection.state, adbAvailable: true, devices: [{ id: 'fixture', serial: 'fixture', name: 'Fixture phone', status: 'connected', android: '16', method: 'USB', endpoint: 'fixture', lastSeen: '', known: true, canDetach: false }], activeDeviceId: 'fixture' }
    backend.apps.state = { ...backend.apps.state, status: 'ready', deviceId: 'fixture', userId: 0, currentUserId: 0, apps: [app], profiles: [{ id: 0, name: 'Owner' }], details: { deviceId: 'fixture', userId: 0, packageName: app.packageName, status: 'ready', error: null, collectedAt: new Date().toISOString(), data: {
      packageName: app.packageName, userId: 0, uid: app.uid, fields: {}, flags: [], badges: {}, paths: [], splits: [], installers: [], links: [], issues: [],
      storage: { requested: false, appBytes: null, dataBytes: null, cacheBytes: null }, network: { start: 0, end: 0, wifi: null, mobile: null },
      components: [{ name: app.packageName + '.MainActivity', type: 'Activity', enabled: true, exported: true }],
      requestedPermissions: [{ name: 'android.permission.CAMERA', granted: true, protectionLevel: 1, declaringPackage: 'android', label: 'Camera', description: null }],
    } } }
    backend.emit({ type: 'connection', connection: backend.connection.state }); backend.emit({ type: 'apps', apps: backend.apps.state })
  })
  await nav.getByRole('button', { name: 'Apps', exact: true }).click()
  await page.getByRole('button', { name: 'Details for Installed details fixture', exact: true }).dblclick()
  const installed = page.getByRole('region', { name: 'Application details', exact: true })
  await expect(installed.getByLabel('Application badges')).toContainText('User')
  await installed.getByRole('tab', { name: 'Activities', exact: true }).click()
  await expect(installed.getByRole('list', { name: 'Activities' })).toContainText('Enabled')
  await installed.getByRole('tab', { name: 'Used permissions', exact: true }).click()
  await expect(installed.getByRole('switch', { name: 'Permission android.permission.CAMERA', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect(installed.getByRole('tab', { name: 'APK contents', exact: true })).toHaveCount(0)
  assert.equal(await desktop.evaluate(() => globalThis.inspectorTest.phoneCommands.length), 0)
  assert.deepEqual(errors, [])
  await writeFile(path.join(root, 'result.json'), JSON.stringify({ passed: true, phoneCommands: 0, sharedDetails: true, badgesAndDialogs: true, readonlyManifestTabs: true, scanCompositionAndAddresses: true, nativeFilePicker: true, nativeFileDrop: true, report, sourceFixtures: fixtures.root, screenshots: ['compare.png', 'overview.png', 'analysis.png', 'narrow.png', 'narrow-details.png'] }, null, 2))
  console.log(`APK inspector Electron tests passed: ${root}`)
} finally { if (desktop) await desktop.close() }
