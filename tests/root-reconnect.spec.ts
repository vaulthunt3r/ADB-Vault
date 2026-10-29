import { test, expect } from '@playwright/test'
import { installBackendFixture, connectionEvent } from './backend-fixture'

test.beforeEach(async ({ page }) => { await installBackendFixture(page); await page.goto('/') })
test('Known devices keeps active first, connected next, and reveals it after selection without moving on polls', async ({ page }) => {
  await connectionEvent(page, { devices: Array.from({ length: 14 }, (_, i) => ({ id: `phone${i}`, name: `Phone ${i}`, method: 'Wi-Fi' as const, status: i === 11 || i === 12 ? 'connected' as const : 'disconnected' as const, serial: `192.168.1.${i + 1}:44444`, endpoint: `192.168.1.${i + 1}:44444`, android: '13', lastSeen: new Date().toISOString(), known: true, canDetach: true })), activeDeviceId: 'phone12' })
  await page.getByRole('navigation').getByRole('button', { name: 'Connection', exact: true }).click()
  const list = page.getByRole('region', { name: 'Known devices list' }), rows = list.locator('.known-device')
  await expect(rows.nth(0)).toContainText('Phone 12'); await expect(rows.nth(1)).toContainText('Phone 11')
  await list.evaluate(el => { el.scrollTop = 500 })
  await page.evaluate(() => window.backendTest.emit({ type: 'connection', connection: { ...window.backendTest.snapshot.connection, scanning: true } }))
  expect(await list.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
  await page.evaluate(() => window.backendTest.emit({ type: 'connection', connection: { ...window.backendTest.snapshot.connection, scanning: false, activeDeviceId: 'phone11' } }))
  await expect(rows.nth(0)).toContainText('Phone 11')
  await expect.poll(() => list.evaluate(el => el.scrollTop)).toBe(0)
  await list.evaluate(el => { el.scrollTop = 500 })
  await page.evaluate(() => {
    const original = window.desktop!.request
    window.desktop!.request = async request => {
      if (request.type === 'connection.find') window.backendTest.snapshot.connection.discovery = { expiresAt: Date.now() + 60000, message: 'Choose a device.', candidates: [{ token: 'same-active', id: 'phone11', name: 'Phone 11', address: '192.168.1.12:44444', method: 'Wi-Fi', connected: true }] }
      return original(request)
    }
  })
  await page.getByRole('button', { name: 'Find devices', exact: true }).click()
  await page.getByRole('dialog', { name: 'Find devices' }).getByRole('button', { name: 'Use device' }).click()
  await expect.poll(() => list.evaluate(el => el.scrollTop)).toBe(0)
  await expect(rows.nth(0)).toHaveClass(/selected/)
})
test('Find devices asks before using a found device; cancel never connects', async ({ page }) => {
  await page.evaluate(() => {
    const original = window.desktop!.request
    window.desktop!.request = async request => {
      if (request.type === 'connection.find') window.backendTest.snapshot.connection.discovery = { expiresAt: Date.now() + 60000, message: 'Choose a device and confirm. Existing connections will stay open.', candidates: [{ token: 'test-token', id: 'phone', name: 'Redmi Note 4', address: '192.168.1.113:40957', method: 'Wi-Fi', connected: false }] }
      return original(request)
    }
  })
  await page.getByRole('navigation').getByRole('button', { name: 'Connection', exact: true }).click()
  const find = page.getByRole('button', { name: 'Find devices', exact: true })
  await find.click()
  const dialog = page.getByRole('dialog', { name: 'Find devices' })
  await expect(dialog.getByRole('radio')).toBeChecked()
  await expect(dialog).toContainText('192.168.1.113:40957')
  await expect.poll(() => page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'connection.confirmReconnect').length)).toBe(0)
  await page.screenshot({ path: 'test-results/find-reconnect-dialog.png' })
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(find).toBeFocused()
  await find.click(); await dialog.getByRole('button', { name: 'Connect device', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'connection.confirmReconnect'))).toEqual([{ type: 'connection.confirmReconnect', token: 'test-token' }])
})
test('Root setting is off by default and saves without starting app collection', async ({ page }) => {
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('group', { name: 'Settings categories' }).getByRole('button', { name: 'Apps', exact: true }).click()
  const option = page.getByRole('checkbox', { name: /Use root for additional app details/ })
  await expect(option).not.toBeChecked(); await option.check(); await expect(option).toBeChecked()
  await expect.poll(() => page.evaluate(() => window.backendTest.snapshot.apps.options.root)).toBe(true)
  await option.uncheck()
  await expect.poll(() => page.evaluate(() => window.backendTest.snapshot.apps.options.root)).toBe(false)
  expect(await page.evaluate(() => window.backendTest.requests.some(r => ['apps.refresh', 'apps.details'].includes(r.type)))).toBe(false)
})
