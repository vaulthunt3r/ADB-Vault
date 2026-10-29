import { test, expect } from '@playwright/test'
import { installBackendFixture } from './backend-fixture'

test('ADB exit preference is enabled by default and uses the saved backend value', async ({ page }) => {
  await installBackendFixture(page)
  await page.goto('/')
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('group', { name: 'Settings categories' }).getByRole('button', { name: 'Connection', exact: true }).click()
  const setting = page.getByRole('checkbox', { name: /Stop ADB server on exit/ })
  await expect(setting).toBeChecked()
  await setting.uncheck()
  await expect(setting).not.toBeChecked()
  expect(await page.evaluate(() => window.backendTest.requests.at(-1))).toEqual({ type: 'settings.stopAdbOnExit', enabled: false })
  await page.getByRole('group', { name: 'Settings categories' }).getByRole('button', { name: 'Apps', exact: true }).click()
  await page.getByRole('group', { name: 'Settings categories' }).getByRole('button', { name: 'Connection', exact: true }).click()
  await expect(setting).not.toBeChecked()
  await setting.check()
  await expect(setting).toBeChecked()
  expect(await page.evaluate(() => window.backendTest.requests.at(-1))).toEqual({ type: 'settings.stopAdbOnExit', enabled: true })
})
