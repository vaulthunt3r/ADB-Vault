import { expect } from '@playwright/test'
import { test } from './screen-test'
import { installBackendFixture } from './backend-fixture'

test.beforeEach(async ({ page, baseURL }) => { await installBackendFixture(page); await page.goto(baseURL!) })

test('sidebar icons share an axis with the toggle and stay still when collapsed', async ({ page }) => {
  for (const width of [1440, 1000]) {
    await page.setViewportSize({ width, height: 800 })
    const positions = () => page.locator('.left-sidebar .nav-item > svg').evaluateAll(icons => icons.map(icon => { const r = icon.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y } }))
    const before = await positions()
    const toggle = await page.locator('[aria-controls="main-sidebar"] svg').boundingBox()
    for (const icon of before) expect(Math.abs(icon.x - (toggle!.x + toggle!.width / 2))).toBeLessThan(0.6)
    await page.getByRole('button', { name: 'Left sidebar: expanded; show icons' }).click()
    expect(await positions()).toEqual(before)
    await page.getByRole('button', { name: 'Left sidebar: icons; expand' }).click()
    expect(await positions()).toEqual(before)
  }
})

test('settings stop at their content and excess wheel scrolling cannot move the app into a blank page', async ({ page }) => {
  test.setTimeout(180_000)
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click()
  for (const width of [1440, 1000]) {
    await page.setViewportSize({ width, height: 700 })
    for (const name of ['Appearance', 'Workspaces', 'Apps', 'Files', 'Badges', 'Connection', 'Screen & audio', 'Web services', 'Notifications']) {
      const categories = page.getByRole('group', { name: 'Settings categories' })
      await categories.getByRole('button', { name, exact: true }).click()
      const pane = page.locator('.settings-pane')
      expect(await pane.evaluate(e => e.scrollTop)).toBe(0)
      const tabsTop = (await categories.boundingBox())!.y
      await pane.evaluate(e => { e.scrollTop = e.scrollHeight })
      expect((await categories.boundingBox())!.y).toBe(tabsTop)
      const bounds = await pane.evaluate(e => {
        const r = e.getBoundingClientRect(), content = e.firstElementChild!.getBoundingClientRect()
        return { top: r.top, bottom: r.bottom, contentBottom: content.bottom, scrollable: e.scrollHeight > e.clientHeight + 1 }
      })
      expect(bounds.contentBottom).toBeGreaterThan(bounds.top + 20)
      if (bounds.scrollable) expect(Math.abs(bounds.bottom - bounds.contentBottom)).toBeLessThan(2)
    }
    // The reported blank page occurred over the inspector, outside the pane.
    for (const selector of ['.settings-pane', '.right-sidebar', '.left-sidebar']) {
      await page.locator(selector).hover()
      await page.mouse.wheel(0, 1600)
      await expect.poll(() => page.locator('.titlebar').evaluate(e => e.getBoundingClientRect().top)).toBe(0)
      expect(await page.evaluate(() => window.scrollY)).toBe(0)
    }
  }
  await page.screenshot({ path: 'test-results/settings-scroll-bottom.png' })
})

test('screenshot settings support file, clipboard and both, plus folder selection and Save as', async ({ page }) => {
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('group', { name: 'Settings categories' }).getByRole('button', { name: 'Screen & audio', exact: true }).click()
  const section = page.getByRole('group', { name: 'Screenshots', exact: true })
  const save = section.getByRole('checkbox', { name: /Save screenshots to a folder/ })
  const copy = section.getByRole('checkbox', { name: /Copy screenshots to clipboard/ })
  const ask = section.getByRole('checkbox', { name: /Ask where to save/ })
  await expect(save).toBeChecked(); await expect(copy).toBeChecked()
  await save.uncheck(); await expect(copy).toBeDisabled(); await expect(ask).toBeDisabled()
  await save.check(); await copy.uncheck(); await expect(save).toBeDisabled()
  await ask.check()
  await section.getByRole('button', { name: 'Change folder…' }).click()
  await expect(section.locator('code')).toHaveText('C:\\Screenshots')
  await section.getByRole('button', { name: 'Open folder', exact: true }).click()
  expect(await page.evaluate(() => window.backendTest.snapshot.screenshots)).toMatchObject({ folder: 'C:\\Screenshots', saveToFile: true, copyToClipboard: false, askWhereToSave: true })
  expect(await page.evaluate(() => window.backendTest.requests.some(r => r.type === 'settings.openScreenshotFolder'))).toBe(true)
  await page.screenshot({ path: 'test-results/screenshot-settings.png' })
})
