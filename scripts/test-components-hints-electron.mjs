import { _electron as electron, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { databaseCatalog } from '../dist-electron/catalog.js'
import { geoipComponent } from '../dist-electron/network-protocol.js'

const root = await mkdtemp(path.resolve('desktop-test-results/components-hints-'))
const fixture = path.join(root, 'fixture.mjs'), harness = path.join(root, 'main.cjs')
await build({ entryPoints: ['tests/backend-fixture.ts'], bundle: true, platform: 'node', format: 'esm', outfile: fixture, logLevel: 'silent' })
const { installBackendFixture } = await import(pathToFileURL(fixture).href)
await writeFile(harness, `const { app, BrowserWindow } = require('electron'); app.whenReady().then(() => { const window = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { contextIsolation: false, nodeIntegration: false } }); window.loadURL('about:blank'); });`)
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
let desktop
try {
  desktop = await electron.launch({ args: [harness, `--user-data-dir=${path.join(root, 'profile')}`], env, timeout: 30000 })
  const page = await desktop.firstWindow(), errors = [], checked = []
  page.setDefaultTimeout(10000)
  page.on('pageerror', e => errors.push(e.message))
  await installBackendFixture(page)
  await page.addInitScript(() => localStorage.setItem('adb-vault-layout', JSON.stringify({ version: 1, state: { workspaceOrder: ['components', 'connection', 'apps'], hiddenWorkspaces: [], leftSidebar: 'icons', rightSidebar: 'expanded' } })))
  await page.goto(pathToFileURL(path.resolve('dist/index.html')).href)
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Components', exact: true }).click()
  await page.getByTestId('component-adb').waitFor()
  await page.evaluate(extra => window.backendTest.emit({ type: 'components', components: [...window.backendTest.snapshot.components, ...extra] }), [databaseCatalog[0], geoipComponent].map(c => ({ ...c, status: 'Not installed' })))
  const base = await page.evaluate(() => window.backendTest.snapshot.components)
  const sidebar = page.locator('#context-sidebar')
  const hint = async button => {
    const anchor = button.locator('..')
    await expect(anchor).toHaveClass(/hint-anchor/)
    assert.equal(await button.getAttribute('title'), null)
    await anchor.scrollIntoViewIfNeeded(); await page.mouse.move(1, 1); await anchor.hover()
    await expect(page.getByRole('tooltip')).toHaveCount(1)
    await expect(page.getByRole('tooltip')).toBeVisible()
    const text = (await page.getByRole('tooltip').innerText()).trim()
    assert.ok(text.length > 20, text)
    const box = await page.getByRole('tooltip').boundingBox(), viewport = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }))
    assert.ok(box && box.x >= 7 && box.y >= 7 && box.x + box.width <= viewport.w - 7 && box.y + box.height <= viewport.h - 7, JSON.stringify({ box, viewport }))
    return text
  }
  const cases = [
    ['adb', 'Detected', 'C:/fixture/adb'], ['adb', 'Not installed', null],
    ['adb', 'Update available', 'C:/fixture/adb'], ['adb', 'Repair needed', 'C:/fixture/adb'],
    ['adb', 'Download failed', null], ['adb', 'Manual action required', null],
    ['adb', 'Manual action required', 'C:/fixture/adb'], ['adb', 'Downloading', null],
    ['driver', 'Package ready', 'C:/fixture/driver'], ['runtime', 'Not installed', null],
    ['db-trackers', 'Installed', 'C:/fixture/databases'], ['db-trackers', 'Not installed', null],
    ['geoip', 'Installed', 'C:/fixture/mmdb'], ['geoip', 'Not installed', null],
  ]
  for (const [id, status, location] of cases) {
    await page.keyboard.press('Escape')
    await page.evaluate(({ base, id, status, location }) => window.backendTest.emit({ type: 'components', components: base.map(c => ({ ...c, status: c.id === id ? status : 'Installed', location: c.id === id ? location : 'C:/fixture/ready' })) }), { base, id, status, location })
    await page.getByTestId(`component-${id}`).getByRole('button', { name: /^Select / }).click()
    await page.getByRole('tab', { name: 'Actions', exact: true }).click()
    const buttons = sidebar.locator('.component-action-list button'), texts = []
    assert.ok(await buttons.count() >= 3)
    const widths = []
    for (const button of await buttons.all()) {
      texts.push(await hint(button))
      widths.push((await button.boundingBox()).width)
    }
    assert.ok(Math.max(...widths) - Math.min(...widths) < 2, JSON.stringify(widths))
    if (status === 'Downloading') {
      for (const button of await buttons.all()) await expect(button).toBeDisabled()
      assert.ok(texts.every(t => t.includes('Wait for the current component operation')))
      await page.keyboard.press('Escape'); await buttons.first().locator('..').focus()
      await expect(page.getByRole('tooltip')).toHaveCount(1)
      await page.screenshot({ path: path.join(root, 'busy-action-hint.png') })
    }
    checked.push({ id, status, hints: texts })
    console.log(`Checked ${id}: ${status}`)
  }
  // Hover takes over from a keyboard-focused hint; moving away and Escape both dismiss it.
  await page.keyboard.press('Escape')
  const actions = sidebar.locator('.component-action-list button')
  await actions.first().focus(); await expect(page.getByRole('tooltip')).toHaveCount(1)
  await hint(actions.last()); await expect(page.getByRole('tooltip')).toContainText('Choose a database folder first')
  await page.mouse.move(1, 1); await expect(page.getByRole('tooltip')).toHaveCount(0)
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 750))
  await hint(actions.first())
  await page.screenshot({ path: path.join(root, 'narrow-action-hint.png') })
  await page.keyboard.press('Escape'); await expect(page.getByRole('tooltip')).toHaveCount(0)
  await page.getByTestId('component-adb').getByRole('button', { name: /^Select / }).click()
  await page.getByRole('tab', { name: 'Details', exact: true }).click()
  await hint(sidebar.getByRole('button', { name: 'Locate manually', exact: true }))
  await page.getByRole('tab', { name: 'Actions', exact: true }).click()
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  assert.deepEqual(errors, [])
  const requests = await page.evaluate(() => window.backendTest.requests.map(r => r.type))
  assert.ok(!requests.some(t => ['components.action', 'components.locate', 'components.open', 'components.installAll'].includes(t)))
  await writeFile(path.join(root, 'result.json'), JSON.stringify({ passed: true, checked, keyboardAndEscape: true, singleHint: true, narrowViewport: true }, null, 2))
  console.log(`Component hints passed (${checked.length} component states): ${root}`)
} catch (error) {
  if (desktop) await (await desktop.firstWindow()).screenshot({ path: path.join(root, 'failure.png') })
  console.error(`Evidence: ${root}`); throw error
} finally { if (desktop) await desktop.close() }
