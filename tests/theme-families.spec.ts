import { test, expect, type Page } from '@playwright/test'
import { themes } from '../src/lib/themes'
import { installBackendFixture } from './backend-fixture'

const additions = themes.filter(theme => theme.family)
async function navigate(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name, exact: true }).click()
}
async function appearance(page: Page) {
  await navigate(page, 'Settings')
  await page.getByRole('group', { name: 'Settings categories' }).getByRole('button', { name: 'Appearance', exact: true }).click()
}
async function select(page: Page, name: string) {
  await appearance(page)
  await page.getByRole('button', { name: `Theme ${name}`, exact: true }).click()
}
async function shell(page: Page) {
  return page.evaluate(() => ({
    tokens: document.documentElement.style.cssText,
    styles: ['.desktop-app', '.app-body', '.left-sidebar', '.nav-item.active', '.topbar', '.workspace', '.right-sidebar', '.component-table'].map(selector => {
      const el = document.querySelector(selector)!, s = getComputedStyle(el), r = el.getBoundingClientRect()
      return [selector, s.backgroundColor, s.backgroundImage, s.borderRadius, s.backdropFilter, s.boxShadow, s.padding, s.gap, s.fontFamily, r.x, r.y, r.width, r.height]
    }),
  }))
}

test.beforeEach(async ({ page }) => { await installBackendFixture(page); await page.goto('/') })

for (const theme of additions) {
  test(`${theme.name}: selection persists and switching back restores Air completely`, async ({ page }, testInfo) => {
    await select(page, 'Air')
    await navigate(page, 'Components')
    const air = await shell(page)
    await select(page, theme.name)
    await expect(page.locator('html')).toHaveAttribute('data-theme-family', theme.family!)
    await navigate(page, 'Components')
    await expect(page.locator('.component-table')).toBeVisible()
    expect(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`${theme.id}.png`) })
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.id)
    await select(page, 'Air')
    await navigate(page, 'Components')
    await expect(page.locator('html')).toHaveAttribute('data-theme-family', 'classic')
    expect(await shell(page)).toEqual(air)
  })
}

test('gallery searches names, combines mode filters, and keeps all old themes', async ({ page }) => {
  await appearance(page)
  const search = page.getByRole('searchbox', { name: 'Find a theme' })
  await expect(page.locator('.theme-option')).toHaveCount(themes.length)
  await expect(page.locator('.theme-option').first()).toHaveAccessibleName('Theme Gruvbox Dark')
  await search.fill('CATPPUCCIN')
  await expect(page.locator('.theme-option')).toHaveCount(2)
  await page.getByRole('group', { name: 'Filter themes' }).getByRole('button', { name: /^Light/ }).click()
  await expect(page.locator('.theme-option')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Theme Catppuccin Latte', exact: true })).toBeVisible()
  await search.fill('not a theme')
  await expect(page.getByRole('status').filter({ hasText: 'No matching themes' })).toBeVisible()
  await search.fill('')
  await page.getByRole('group', { name: 'Filter themes' }).getByRole('button', { name: /^All/ }).click()
  await expect(page.locator('.theme-option')).toHaveCount(themes.length)
})
