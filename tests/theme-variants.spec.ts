import { test, expect, type Page } from '@playwright/test'
import { installBackendFixture } from './backend-fixture'

const variants = [
  { id: 'air', name: 'Air', mode: 'light' },
  { id: 'soft-layers', name: 'Soft Layers', mode: 'light' },
  { id: 'technical', name: 'Technical', mode: 'dark' },
  { id: 'accent-rail', name: 'Accent Rail', mode: 'light' },
]
test.beforeEach(async ({ page }) => { await installBackendFixture(page); await page.goto('/') })

async function navigate(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name, exact: true }).click()
}
async function appearance(page: Page) {
  await navigate(page, 'Settings')
  await page.getByRole('group', { name: 'Settings categories' }).getByRole('button', { name: 'Appearance', exact: true }).click()
}
async function selectTheme(page: Page, name: string) {
  await appearance(page)
  await page.getByRole('button', { name: `Theme ${name}`, exact: true }).click()
}
async function look(page: Page) {
  return page.evaluate(() => {
    const selectors = ['.titlebar', '.left-sidebar', '.nav-item.active', '.topbar', '.workspace', '.component-table', '.table-heading', '.component-row', '.right-sidebar', '.inspector-tabs']
    return {
      tokens: document.documentElement.style.cssText,
      elements: selectors.map(selector => {
        const el = document.querySelector(selector)!, style = getComputedStyle(el), rect = el.getBoundingClientRect()
        return { selector, width: rect.width, height: rect.height, color: style.color, background: style.backgroundColor, image: style.backgroundImage, shadow: style.boxShadow, border: style.borderColor, radius: style.borderRadius, font: style.fontFamily }
      }),
    }
  })
}
for (const variant of variants) {
  test(`${variant.name} persists and restores the previous theme without changing layout`, async ({ page }, testInfo) => {
    await selectTheme(page, 'Vault Blue')
    const originalPreview = await page.locator('[data-preview-theme="sage"]').evaluate(el => {
      const sidebar = getComputedStyle(el.querySelector('.preview-sidebar')!)
      return [sidebar.backgroundColor, sidebar.borderColor]
    })
    await navigate(page, 'Components')
    const original = await look(page)
    await selectTheme(page, variant.name)
    await expect(page.locator('html')).toHaveAttribute('data-theme', variant.id)
    await expect(page.locator('html')).toHaveAttribute('data-color-mode', variant.mode)
    expect(await page.locator('[data-preview-theme="sage"]').evaluate(el => {
      const sidebar = getComputedStyle(el.querySelector('.preview-sidebar')!)
      return [sidebar.backgroundColor, sidebar.borderColor]
    })).toEqual(originalPreview)
    await navigate(page, 'Components')
    const active = await look(page)
    expect(active.tokens).not.toEqual(original.tokens)
    expect(active.elements.map(({ width, height }) => [width, height])).toEqual(original.elements.map(({ width, height }) => [width, height]))
    await page.screenshot({ path: testInfo.outputPath(`${variant.id}.png`) })
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', variant.id)
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('adb-vault-appearance')!).state)
    expect(saved).toMatchObject({ themeId: variant.id, cornerStyle: 'rounded', density: 'comfortable' })
    await selectTheme(page, 'Vault Blue')
    await navigate(page, 'Components')
    expect(await look(page)).toEqual(original)
  })
}

test('surface themes respect Square corners and Zen mode independently', async ({ page }) => {
  await selectTheme(page, 'Soft Layers')
  await navigate(page, 'Components')
  await expect(page.locator('.component-table')).not.toHaveCSS('box-shadow', 'none')
  await appearance(page)
  await page.getByRole('radio', { name: 'Square', exact: true }).check()
  await page.getByRole('checkbox', { name: 'Zen mode', exact: true }).check()
  await navigate(page, 'Components')
  await expect(page.locator('.component-table')).toHaveCSS('border-radius', '0px')
  await expect(page.locator('.component-table')).toHaveCSS('box-shadow', 'none')
  await selectTheme(page, 'Accent Rail')
  await expect(page.locator('html')).toHaveAttribute('data-corner-style', 'square')
  await expect(page.locator('html')).toHaveAttribute('data-zen-mode', 'true')
  await expect(page.locator('.nav-item.active')).toHaveCSS('border-radius', '0px')
  await expect(page.getByLabel('Workspace toolbar', { exact: true })).toHaveCSS('box-shadow', 'none')
  await selectTheme(page, 'Paper')
  await expect(page.locator('html')).toHaveAttribute('data-corner-style', 'square')
  await expect(page.locator('html')).toHaveAttribute('data-zen-mode', 'true')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper')
  await expect(page.locator('html')).toHaveAttribute('data-corner-style', 'square')
  await expect(page.locator('html')).toHaveAttribute('data-zen-mode', 'true')
})

test('an unavailable saved theme falls back while keeping independent preferences', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('adb-vault-appearance', JSON.stringify({ version: 1, state: { themeId: 'removed-theme', density: 'compact', cornerStyle: 'square' } })))
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sage')
  await expect(page.locator('html')).toHaveAttribute('data-corner-style', 'square')
  await expect(page.locator('main')).toHaveClass(/density-compact/)
})

test('Accent Rail navigation is readable and the inspector reports its actual background', async ({ page }) => {
  await selectTheme(page, 'Accent Rail')
  await expect(page.locator('.appearance-inspector-swatches > div').filter({ hasText: 'Sidebars' }).locator('code')).toHaveText('#273b73')
  const normal = page.locator('.left-sidebar .nav-item:not(.active)').first()
  for (const hovered of [false, true]) {
    if (hovered) await normal.hover()
    const ratios = await page.locator('.left-sidebar').evaluate(el => {
      const luminance = (css: string) => {
        const values = css.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => {
          const channel = value / 255
          return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4
        })
        return values[0] * .2126 + values[1] * .7152 + values[2] * .0722
      }
      return [...el.querySelectorAll('.nav-item')].map(button => {
        const style = getComputedStyle(button)
        const background = style.backgroundColor === 'rgba(0, 0, 0, 0)' ? getComputedStyle(el).backgroundColor : style.backgroundColor
        const [light, dark] = [luminance(style.color), luminance(background)].sort((a, b) => b - a)
        return (light + .05) / (dark + .05)
      })
    })
    for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5)
  }
})
