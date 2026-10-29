import { test, expect, type Page } from '@playwright/test'
import { installBackendFixture, connectionEvent } from './backend-fixture'
import type { FastbootSnapshot } from '../electron/fastboot-protocol'

const detected: FastbootSnapshot = { busy: false, error: null, checkedAt: '2026-10-08T12:00:00Z', message: '2 Fastboot devices detected over USB.', devices: [
  { serial: 'PHONE1', usbPath: '1-2', token: 'token-1', fields: { product: 'Test phone', unlocked: 'yes', 'is-userspace': 'no' }, inspectedAt: '2026-10-08T12:00:00Z', issues: ['Current slot: Not reported by this device.'] },
  { serial: 'PHONE2', usbPath: '1-3', token: 'token-2', fields: { product: 'Other phone' }, inspectedAt: '2026-10-08T12:00:00Z', issues: [] },
] }
async function emitFastboot(page: Page, state = detected) {
  await page.evaluate(state => {
    window.backendTest.snapshot.fastboot = state
    window.backendTest.emit({ type: 'fastboot', state })
  }, state)
}
test.beforeEach(async ({ page }) => {
  await installBackendFixture(page); await page.goto('/')
  await page.getByRole('navigation').getByRole('button', { name: 'Connection', exact: true }).click()
})

test('Fastboot is on demand and works without an ADB connection or executable', async ({ page }) => {
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type.startsWith('connection.fastboot')))).toHaveLength(0)
  await connectionEvent(page, { adbAvailable: false })
  await page.getByRole('button', { name: 'Find Fastboot devices', exact: true }).click()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type.startsWith('connection.fastboot')))).toEqual([{ type: 'connection.fastboot.scan' }])
  await emitFastboot(page)
  await page.getByRole('button', { name: 'Select Fastboot PHONE1', exact: true }).click()
  await expect(page.getByText('FASTBOOT DETAILS', { exact: true })).toBeVisible()
  await expect(page.getByText('Bootloader unlocked', { exact: true })).toBeVisible()
  await expect(page.getByText('Unavailable', { exact: true }).first()).toBeVisible()
  await page.screenshot({ path: 'test-results/fastboot-details.png' })
  await page.getByRole('tab', { name: 'Actions', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Restart', exact: true })).toBeEnabled()
})

test('Fastboot restart requires confirmation, names the target and cancels harmlessly', async ({ page }) => {
  await emitFastboot(page)
  await page.getByRole('button', { name: 'Select Fastboot PHONE2', exact: true }).click()
  await page.getByRole('tab', { name: 'Actions', exact: true }).click()
  await page.getByRole('button', { name: 'Restart', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Restart from Fastboot' })
  await expect(dialog).toContainText('PHONE2')
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'connection.fastboot.reboot'))).toHaveLength(0)
  await expect(page.getByRole('button', { name: 'Restart', exact: true })).toBeFocused()
  await page.getByRole('button', { name: 'Restart', exact: true }).click()
  await dialog.getByRole('radio', { name: 'Fastbootd', exact: true }).check()
  await expect(dialog).toContainText('Support depends on the phone')
  await dialog.getByRole('button', { name: 'Restart phone', exact: true }).click()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'connection.fastboot.reboot'))).toEqual([{ type: 'connection.fastboot.reboot', serial: 'PHONE2', token: 'token-2', mode: 'fastboot', confirmed: true }])
  await expect(dialog).not.toBeVisible()
})

test('changed discovery disables a pending confirmation and ADB selection restores its inspector', async ({ page }) => {
  await connectionEvent(page, { devices: [{ id: 'USB3', serial: 'USB3', name: 'Android phone', status: 'connected', method: 'USB', android: '15', endpoint: 'USB3', lastSeen: '', known: true, canDetach: false }], activeDeviceId: 'USB3' })
  await emitFastboot(page)
  await page.getByRole('button', { name: 'Select Fastboot PHONE1', exact: true }).click()
  await page.getByRole('tab', { name: 'Actions', exact: true }).click()
  await page.getByRole('button', { name: 'Restart', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Restart from Fastboot' })
  await emitFastboot(page, { ...detected, devices: detected.devices.map(d => ({ ...d, token: 'new-token' })) })
  await expect(dialog.getByRole('button', { name: 'Restart phone', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await page.getByRole('button', { name: 'Select Android phone', exact: true }).click()
  await expect(page.getByText('CONNECTION ACTIONS', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mirror screen', exact: true })).toBeVisible()
})

test('errors stay visible and busy disables repeated commands', async ({ page }) => {
  await emitFastboot(page)
  await page.getByRole('button', { name: 'Select Fastboot PHONE1', exact: true }).click()
  await page.getByRole('tab', { name: 'Actions', exact: true }).click()
  await emitFastboot(page, { ...detected, busy: true })
  await expect(page.getByRole('button', { name: 'Find Fastboot devices', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Restart', exact: true })).toBeDisabled()
  await emitFastboot(page, { ...detected, error: 'Fastboot command failed. Check the phone.' })
  await expect(page.getByRole('alert').filter({ hasText: 'Fastboot command failed' }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Restart', exact: true })).toBeEnabled()
})
