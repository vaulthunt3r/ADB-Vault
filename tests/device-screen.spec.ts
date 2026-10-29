import { expect } from '@playwright/test'
import { test } from './screen-test'
import { connectionEvent, installBackendFixture } from './backend-fixture'

test.setTimeout(90_000)

test.beforeEach(async ({ page, baseURL }) => {
  await installBackendFixture(page); await page.goto(baseURL!, { timeout: 60000, waitUntil: 'domcontentloaded' })
  await connectionEvent(page, { devices: [{ id: 'USB1', serial: 'USB1', transportId: '7', name: 'Test phone', status: 'connected', android: '16', method: 'USB', endpoint: 'USB1', lastSeen: '', known: true, canDetach: false }], activeDeviceId: 'USB1' })
  await page.getByRole('navigation').getByRole('button', { name: 'Connection', exact: true }).click()
  await page.getByRole('tab', { name: 'Actions', exact: true }).click()
})

test('screen controls require scrcpy only for Mirror screen and send actions for the selected phone', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Mirror screen', exact: true })).toBeDisabled()
  await expect(page.getByText('Mirror screen requires scrcpy.', { exact: false })).toBeVisible()
  for (const label of ['Screenshot', 'Wake screen', 'Sleep screen']) await page.getByRole('tabpanel').getByRole('button', { name: label, exact: true }).click()
  await page.evaluate(() => window.backendTest.emit({ type: 'components', components: window.backendTest.snapshot.components.map(c => c.id === 'scrcpy' ? { ...c, status: 'Installed', location: 'C:\\tools\\scrcpy' } : c) }))
  await page.getByRole('button', { name: 'Mirror screen', exact: true }).click()
  const requests = await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'connection.screen'))
  expect(requests.map(r => r.action)).toEqual(['screenshot', 'wake', 'sleep', 'open'])
  for (const request of requests) expect(request).toMatchObject({ id: 'USB1', serial: 'USB1', transportId: '7' })
  await expect(page.getByRole('button', { name: /Record screen/ })).toHaveCount(0)
  await page.screenshot({ path: 'test-results/device-screen-actions.png' })
})

test('failed screen command releases buttons and reports the error', async ({ page }) => {
  await page.evaluate(() => {
    const original = window.desktop!.request
    window.desktop!.request = async request => request.type === 'connection.screen' ? { ok: false, error: 'Screen capture denied by Android.', snapshot: window.backendTest.snapshot } : original(request)
  })
  await page.getByRole('tabpanel').getByRole('button', { name: 'Screenshot', exact: true }).click()
  await expect(page.getByText('Screen capture denied by Android.', { exact: true })).toBeVisible()
  await expect(page.getByRole('tabpanel').getByRole('button', { name: 'Screenshot', exact: true })).toBeEnabled()
})
