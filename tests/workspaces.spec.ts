import { test, expect, type Page } from '@playwright/test'
import { installBackendFixture, connectionEvent } from './backend-fixture'

const defaults = ['Components', 'Connection', 'Apps', 'Files', 'Monitor', 'Activity', 'Console', 'Settings']
const navigation = (page: Page) => page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button')
async function settings(page: Page) {
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('group', { name: 'Settings categories' }).getByRole('button', { name: 'Workspaces', exact: true }).click()
}
test.beforeEach(async ({ page }) => { await installBackendFixture(page); await page.goto('/') })

test('order, visibility and keyboard moves persist, with reset and accessible Settings', async ({ page }) => {
  await expect(navigation(page)).toHaveText(defaults)
  await settings(page)
  await page.getByRole('button', { name: 'Move Apps up', exact: true }).click()
  await page.getByRole('button', { name: 'Drag Apps', exact: true }).focus()
  await page.keyboard.press('ArrowUp')
  await expect(navigation(page)).toHaveText(['Apps', 'Components', 'Connection', 'Files', 'Monitor', 'Activity', 'Console', 'Settings'])
  await page.getByRole('checkbox', { name: 'Show Monitor', exact: true }).uncheck()
  await page.getByRole('checkbox', { name: 'Show Components', exact: true }).uncheck()
  await expect(navigation(page)).toHaveText(['Apps', 'Connection', 'Files', 'Activity', 'Console', 'Settings'])
  await page.reload()
  await expect(navigation(page)).toHaveText(['Apps', 'Connection', 'Files', 'Activity', 'Console', 'Settings'])
  await expect(page.getByRole('navigation').getByRole('button', { name: 'Apps', exact: true })).toHaveAttribute('aria-current', 'page')
  await settings(page)
  await expect(page.getByRole('checkbox', { name: 'Show Monitor', exact: true })).not.toBeChecked()
  await page.getByRole('checkbox', { name: 'Show Monitor', exact: true }).check()
  await page.screenshot({ path: 'desktop-test-results/workspace-settings.png' })
  await page.getByRole('button', { name: 'Reset workspaces', exact: true }).click()
  await expect(navigation(page)).toHaveText(defaults)
  await page.reload()
  await expect(navigation(page)).toHaveText(defaults)
})

test('dragging changes order, every workspace can be hidden, and Settings can restore them', async ({ page }) => {
  await settings(page)
  await page.getByRole('button', { name: 'Drag Console', exact: true }).dragTo(page.locator('[data-workspace="components"]'))
  await expect(navigation(page)).toHaveText(['Console', 'Components', 'Connection', 'Apps', 'Files', 'Monitor', 'Activity', 'Settings'])
  for (const name of defaults.filter(name => name !== 'Settings')) await page.getByRole('checkbox', { name: `Show ${name}`, exact: true }).uncheck()
  await expect(navigation(page)).toHaveText(['Settings'])
  await page.reload()
  await expect(navigation(page)).toHaveText(['Settings'])
  await expect(navigation(page)).toHaveAttribute('aria-current', 'page')
  await settings(page)
  await page.getByRole('button', { name: 'Reset workspaces', exact: true }).click()
  await expect(navigation(page)).toHaveText(defaults)
  await page.setViewportSize({ width: 900, height: 820 })
  expect(await page.locator('.workspace-settings').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.screenshot({ path: 'desktop-test-results/workspace-settings-narrow.png' })
})

test('stored preferences remove invalid IDs, deduplicate and append missing workspaces', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('adb-vault-layout', JSON.stringify({ state: {
    workspaceOrder: ['inspector', 'console', 'files', 'console', 'missing', 'settings'],
    hiddenWorkspaces: ['files', 'files', 'unknown', 'settings'], leftSidebar: 'icons', leftWidth: 230,
  }, version: 1 })))
  await page.reload()
  await expect(navigation(page)).toHaveText(['Console', 'Components', 'Connection', 'Apps', 'Monitor', 'Activity', 'Settings'])
  await expect(page.getByRole('complementary', { name: 'Main sidebar' })).toHaveClass(/icons/)
  await settings(page)
  await expect(page.getByRole('list', { name: 'Workspace order' }).locator('li')).toHaveCount(7)
  await page.getByRole('checkbox', { name: 'Show Files', exact: true }).check()
  await expect(navigation(page)).toHaveText(['Console', 'Files', 'Components', 'Connection', 'Apps', 'Monitor', 'Activity', 'Settings'])
})

test('hiding a running workspace preserves its operation and the progress shortcut can reopen it', async ({ page }) => {
  await connectionEvent(page, { activeDeviceId: 'phone', devices: [{ id: 'phone', serial: 'TEST', transportId: '7', name: 'Test phone', status: 'connected', android: '16', method: 'USB', endpoint: 'TEST', lastSeen: '', known: true, canDetach: true }] })
  await page.getByRole('navigation').getByRole('button', { name: 'Console', exact: true }).click()
  await page.getByLabel('Console command', { exact: true }).fill('shell getprop ro.product.model')
  await page.getByRole('button', { name: 'Run command', exact: true }).click()
  await settings(page)
  await page.getByRole('checkbox', { name: 'Show Console', exact: true }).uncheck()
  await expect(page.getByRole('navigation').getByRole('button', { name: 'Console', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'console.stop'))).toHaveLength(0)
  await page.getByRole('button', { name: 'Running ADB command', exact: true }).click()
  await expect(page.getByLabel('Console command', { exact: true })).toBeVisible()
  await expect(page.locator('.console-result')).toHaveText('Running')
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(page.locator('.console-result')).toHaveText('Stopped')
})
