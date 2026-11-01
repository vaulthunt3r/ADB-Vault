import { test, expect } from '@playwright/test'
import { installBackendFixture } from './backend-fixture'
import { badgeDescriptions } from '../src/lib/badgeAppearance'

test.use({ locale: 'uk-UA' })

for (const language of ['ru', 'uk']) {
  test(`legacy ${language} preferences cannot switch the English interface`, async ({ page }) => {
    await installBackendFixture(page)
    await page.addInitScript(value => localStorage.setItem('adb-vault-language', value), language)
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.getByRole('navigation').getByRole('button', { name: 'Components', exact: true })).toBeVisible()
    await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(page.locator('.settings-categories').getByRole('button', { name: 'Language', exact: true })).toHaveCount(0)
    await expect(page.locator('#interface-language')).toHaveCount(0)
    await page.locator('.settings-categories').getByRole('button', { name: 'Badges', exact: true }).click()
    await expect(page.locator('.badge-color-list')).toContainText('System')
    await page.getByRole('button', { name: 'Badge legend', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText(badgeDescriptions.bloatware)
    await page.evaluate(value => window.dispatchEvent(new StorageEvent('storage', { key: 'adb-vault-language', newValue: value })), language)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    expect(await page.evaluate(() => localStorage.getItem('adb-vault-language'))).toBeNull()
    await page.reload()
    await expect(page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  })
}
