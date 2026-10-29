import { _electron as electron, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = await mkdtemp(path.resolve('desktop-test-results/navigation-hints-'))
const fixture = path.join(root, 'fixture.mjs'), harness = path.join(root, 'main.cjs')
await build({ entryPoints: ['tests/backend-fixture.ts'], bundle: true, platform: 'node', format: 'esm', outfile: fixture, logLevel: 'silent' })
const { installBackendFixture, connectionEvent } = await import(pathToFileURL(fixture).href)
await writeFile(harness, `const { app, BrowserWindow } = require('electron'); app.whenReady().then(() => { const window = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { contextIsolation: false, nodeIntegration: false } }); window.loadURL('about:blank'); });`)
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
let desktop
try {
  desktop = await electron.launch({ args: [harness, `--user-data-dir=${path.join(root, 'profile')}`], env })
  const page = await desktop.firstWindow(), errors = []
  page.on('pageerror', e => errors.push(e.message))
  await installBackendFixture(page)
  await page.addInitScript(() => {
    localStorage.setItem('adb-vault-toolbar', JSON.stringify({ version: 1, state: { pinned: ['virtualDisplay', 'camera', 'screenshot'], operationPosition: 'end', showDevice: false } }))
    localStorage.setItem('adb-vault-layout', JSON.stringify({ version: 1, state: { workspaceOrder: ['components', 'inspector', 'connection', 'apps'], hiddenWorkspaces: [], leftSidebar: 'icons', rightSidebar: 'expanded' } }))
  })
  await page.goto(pathToFileURL(path.resolve('dist/index.html')).href)
  const nav = page.getByRole('navigation', { name: 'Main navigation' }), toolbar = page.getByLabel('Workspace toolbar')
  await expect(nav.getByRole('button', { name: 'APK Inspector', exact: true })).toHaveCount(0)
  const virtual = toolbar.getByRole('button', { name: 'Virtual display', exact: true })
  const checkBounds = async () => {
    const bounds = await page.getByRole('tooltip').boundingBox(), viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    assert.ok(bounds && bounds.x >= 7 && bounds.y >= 7 && bounds.x + bounds.width <= viewport.width - 7 && bounds.y + bounds.height <= viewport.height - 7, JSON.stringify({ bounds, viewport }))
  }
  const hint = async button => {
    const anchor = button.locator('..')
    await anchor.scrollIntoViewIfNeeded(); await page.mouse.move(1, 1); await anchor.hover()
    await expect(page.getByRole('tooltip')).toBeVisible()
    assert.ok((await page.getByRole('tooltip').innerText()).trim().length > 15)
    await checkBounds()
  }
  await expect(virtual).toBeDisabled()
  await hint(virtual)
  await expect(page.getByRole('tooltip')).toContainText('separate Android window')
  await page.screenshot({ path: path.join(root, 'disabled-virtual-hint.png') })
  await page.keyboard.press('Escape'); await expect(page.getByRole('tooltip')).toHaveCount(0)
  await virtual.locator('..').focus(); await expect(page.getByRole('tooltip')).toBeVisible(); await checkBounds()
  await page.keyboard.press('Escape')
  const phone = { id: 'phone', serial: 'fixture-serial', name: 'Fixture phone', status: 'connected', android: '16', method: 'USB', endpoint: 'fixture-serial', lastSeen: new Date().toISOString(), known: true, canDetach: false, transportId: '7', root: { status: 'not-detected', message: 'Fixture', checkedAt: new Date().toISOString() } }
  await connectionEvent(page, { devices: [phone], activeDeviceId: phone.id, selectedDeviceId: phone.id, adbAvailable: true })
  await page.evaluate(() => window.backendTest.emit({ type: 'components', components: window.backendTest.snapshot.components.map(c => c.id === 'scrcpy' ? { ...c, status: 'Installed', location: 'C:/fixture/scrcpy' } : c) }))
  await expect(virtual).toBeEnabled(); await hint(virtual)
  await page.screenshot({ path: path.join(root, 'enabled-virtual-hint.png') })
  await page.keyboard.press('Escape'); await virtual.focus(); await expect(page.getByRole('tooltip')).toBeVisible(); await page.keyboard.press('Escape')
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 750))
  await hint(virtual); await page.keyboard.press('Escape')
  await nav.getByRole('button', { name: 'Connection', exact: true }).click()
  const fastboot = page.getByRole('button', { name: 'Find Fastboot devices', exact: true })
  await fastboot.scrollIntoViewIfNeeded()
  const fastbootBox = await fastboot.boundingBox(), connectBox = await page.getByRole('button', { name: 'Connect address', exact: true }).boundingBox()
  assert.ok(Math.abs(fastbootBox.x + fastbootBox.width - connectBox.x - connectBox.width) < 2)
  await page.screenshot({ path: path.join(root, 'fastboot-alignment.png') })
  await page.getByRole('tab', { name: 'Actions', exact: true }).click()
  const actions = page.locator('#context-sidebar .recovery-actions > .hint-anchor > button')
  const actionCount = await actions.count(); assert.ok(actionCount >= 16)
  for (const button of await actions.all()) await hint(button)
  await page.screenshot({ path: path.join(root, 'connection-action-hint.png') })
  await page.keyboard.press('Escape')
  const disconnect = page.getByRole('button', { name: 'Disconnect device', exact: true })
  await expect(disconnect).toBeDisabled(); await hint(disconnect)
  await expect(page.getByRole('tooltip')).toContainText('Unplug the cable')
  await page.keyboard.press('Escape')
  await nav.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = page.getByRole('group', { name: 'Status bar', exact: true })
  await expect(settings.getByRole('combobox', { name: 'Configure status bar for' }).locator('option', { hasText: 'APK Inspector' })).toHaveCount(0)
  const card = settings.getByRole('button', { name: 'Pin Mirror screen', exact: true })
  await hint(card); await page.keyboard.press('Escape')
  await page.screenshot({ path: path.join(root, 'toolbar-settings.png') })
  await nav.getByRole('button', { name: 'Apps', exact: true }).click()
  await page.getByRole('button', { name: 'Local APKs', exact: true }).click()
  await expect(nav.getByRole('button', { name: 'Apps', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('#context-sidebar')).toHaveCount(0)
  await page.getByRole('button', { name: 'Back to installed applications', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Local APKs', exact: true })).toBeVisible()
  const requests = await page.evaluate(() => window.backendTest.requests.map(r => r.type))
  assert.ok(!requests.some(r => ['connection.screen', 'connection.power', 'connection.disconnect', 'connection.fastboot.scan'].includes(r)))
  assert.deepEqual(errors, [])
  await writeFile(path.join(root, 'result.json'), JSON.stringify({ passed: true, disabledAndEnabledHints: true, keyboardAndEscape: true, narrowViewport: true, connectionActionHints: actionCount, fastbootRightAligned: true, localApksInsideApps: true }, null, 2))
  console.log(`Navigation and tooltip checks passed: ${root}`)
} finally { if (desktop) await desktop.close() }
