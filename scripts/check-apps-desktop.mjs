// Real Electron + device inventory, with a disposable profile copied from verified component paths.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createServer } from 'vite'
import { _electron as electron, expect } from '@playwright/test'
const compiler = spawn(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.electron.json'], { stdio: 'inherit', windowsHide: true })
assert.equal(await new Promise(resolve => compiler.on('exit', resolve)), 0)
const { parseDevices } = await import('../dist-electron/connections.js')
const { run, checked } = await import('../dist-electron/process.js')
await import('./preload.mjs'); await import('./check-helper.mjs')
const profile = path.resolve('desktop-test-results', `apps-profile-${Date.now()}`)
await mkdir(profile, { recursive: true })
const saved = JSON.parse(await readFile(path.join(process.env.APPDATA, 'adb-vault/backend.json'), 'utf8'))
const connected = parseDevices(checked(await run(path.join(saved.paths.adb, 'adb.exe'), ['devices', '-l'])))
assert.ok(connected.some(device => device.status === 'connected'), 'No authorized Android device connected; desktop hardware check not started.')
await writeFile(path.join(profile, 'backend.json'), JSON.stringify({ paths: saved.paths, known: [] }))
const server = await createServer({ server: { port: 5176, strictPort: true } }); await server.listen()
const env = { ...process.env, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5176', ADB_VAULT_SMOKE_TEST: '1' }; delete env.ELECTRON_RUN_AS_NODE
let app
const preload = process.argv.includes('--preload')
try {
  app = await electron.launch({ args: ['.', `--user-data-dir=${profile}`], env })
  const page = await app.firstWindow(), errors = []; page.on('pageerror', error => errors.push(error.message))
  await expect.poll(async () => (await page.evaluate(() => window.desktop.request({ type: 'snapshot' }))).snapshot.connection.activeDeviceId, { timeout: 60000 }).toBeTruthy()
  if (preload) {
    await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('group', { name: 'Settings categories' }).getByRole('button', { name: 'Apps', exact: true }).click()
    await page.getByRole('radio', { name: /Preload other profiles/ }).check()
    await expect(page.getByRole('radio', { name: /Preload other profiles/ })).toBeChecked()
    assert.equal(JSON.parse(await readFile(path.join(profile, 'backend.json'), 'utf8')).appsLoadingMode, 'preload')
    const before = (await page.evaluate(() => window.desktop.request({ type: 'snapshot' }))).snapshot.apps
    assert.equal(before.status, 'idle'); assert.deepEqual(before.cachedUserIds, [])
    await page.screenshot({ path: 'desktop-test-results/apps/electron-loading-settings.png' })
  }
  await page.getByRole('navigation').getByRole('button', { name: 'Apps', exact: true }).click()
  await expect(page.getByRole('table', { name: 'Installed applications' })).toBeVisible({ timeout: 135000 })
  const state = (await page.evaluate(() => window.desktop.request({ type: 'snapshot' }))).snapshot.apps
  assert.equal(state.status, 'ready'); assert.ok(state.apps.length > 0)
  const failures = await page.locator('.apps-live-table img').evaluateAll(images => images.filter(img => !img.complete || img.naturalWidth !== 96).length)
  assert.equal(failures, 0, 'An application icon did not decode in Chromium')
  await page.getByRole('searchbox', { name: 'Search applications' }).fill('com.android.settings')
  const selected = state.apps.find(a => a.packageName === 'com.android.settings') || state.apps[0]
  await page.getByRole('searchbox', { name: 'Search applications' }).fill(selected.packageName)
  await page.getByRole('button', { name: `Details for ${selected.label}`, exact: true }).click()
  await expect(page.getByRole('tabpanel')).toContainText(selected.packageName)
  await page.screenshot({ path: 'desktop-test-results/apps/electron-details.png' })
  await page.evaluate(() => window.desktop.request({ type: 'apps.options', options: { icons: true, early: false, storage: true } }))
  await page.getByRole('button', { name: `Details for ${selected.label}`, exact: true }).dblclick()
  await expect.poll(async () => (await page.evaluate(() => window.desktop.request({ type: 'snapshot' }))).snapshot.apps.details?.status, { timeout: 65000 }).toBe('ready')
  const details = (await page.evaluate(() => window.desktop.request({ type: 'snapshot' }))).snapshot.apps.details
  assert.equal(details.data.packageName, selected.packageName)
  assert.equal(details.data.userId, state.userId)
  const about = page.getByRole('region', { name: 'Application details', exact: true })
  await expect(about).toContainText('About application')
  await expect(about.locator('.app-badges')).toContainText(selected.updatedSystemApp ? 'Updated system' : selected.system ? 'System' : 'User')
  await expect(about.locator('details, summary, [aria-expanded]')).toHaveCount(0)
  await page.screenshot({ path: 'desktop-test-results/apps/electron-about.png' })
  await page.getByRole('button', { name: 'Back to Apps' }).click()
  await expect(page.getByRole('searchbox', { name: 'Search applications' })).toHaveValue(selected.packageName)
  await page.evaluate(options => window.desktop.request({ type: 'apps.options', options }), state.options)
  await page.getByRole('searchbox', { name: 'Search applications' }).fill('')
  await page.screenshot({ path: 'desktop-test-results/apps/electron-list.png' })
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('group', { name: 'Settings categories' }).getByRole('button', { name: 'Appearance', exact: true }).click()
  await page.getByRole('button', { name: 'Theme Git Dark', exact: true }).click()
  await page.getByRole('navigation').getByRole('button', { name: 'Apps', exact: true }).click()
  await page.screenshot({ path: 'desktop-test-results/apps/electron-dark.png' })
  const otherProfile = state.profiles.find(profile => profile.id !== state.userId)
  let profileCheck = null
  if (otherProfile) {
    if (preload) {
      await expect.poll(async () => (await page.evaluate(() => window.desktop.request({ type: 'snapshot' }))).snapshot.apps.cachedUserIds.includes(otherProfile.id), { timeout: 135000, intervals: [1000, 2000] }).toBe(true)
      const ready = (await page.evaluate(() => window.desktop.request({ type: 'snapshot' }))).snapshot.apps
      assert.equal(ready.userId, state.userId); assert.equal(ready.status, 'ready')
    }
    const selectedAt = Date.now()
    await page.getByLabel('Android profile', { exact: true }).selectOption(String(otherProfile.id))
    await expect.poll(async () => {
      const current = (await page.evaluate(() => window.desktop.request({ type: 'snapshot' }))).snapshot.apps
      return current.status === 'ready' && current.userId === otherProfile.id
    }, { timeout: 135000, intervals: [500, 1000] }).toBe(true)
    await expect(page.getByRole('table', { name: 'Installed applications' })).toBeVisible({ timeout: 135000 })
    const other = (await page.evaluate(() => window.desktop.request({ type: 'snapshot' }))).snapshot.apps
    assert.equal(other.status, 'ready'); assert.equal(other.userId, otherProfile.id)
    assert.ok(other.apps.every(a => a.userId === otherProfile.id && Math.floor(a.uid / 100000) === otherProfile.id))
    assert.equal(other.currentUserId, state.currentUserId)
    if (preload) assert.ok(Date.parse(other.collectedAt) < selectedAt, 'Selecting a preloaded profile should reuse its earlier snapshot')
    profileCheck = { userId: other.userId, packages: other.apps.length, currentAndroidUserUnchanged: true, preloadCacheReused: preload, selectionMs: Date.now() - selectedAt }
    await page.screenshot({ path: 'desktop-test-results/apps/electron-profile.png' })
  }
  assert.deepEqual(errors, [])
  await writeFile('desktop-test-results/apps/electron-report.json', JSON.stringify({ packages: state.apps.length, decodedIcons: state.apps.filter(a => a.iconPng).length, pageErrors: errors, realIpc: true, profileCheck }, null, 2))
  console.log(`PASS: real Electron IPC, ${state.apps.length} packages, decoded icons, localized search, Details, light/dark appearance.`)
} finally {
  await server.close()
  if (app) {
    const child = app.process()
    const timer = setTimeout(() => { if (child.exitCode !== null) for (const stream of child.stdio) stream?.destroy() }, 3000)
    try { await app.close() } finally { clearTimeout(timer) }
  }
}
