import { test, expect } from '@playwright/test'
import { installBackendFixture } from './backend-fixture'
import { batchActionConfirmation } from '../electron/app-confirmations'
import type { AppActionState } from '../electron/app-actions-protocol'
import { themes, terminalEasterEggTheme } from '../src/lib/themes'

const content = batchActionConfirmation({ action: 'clear-storage', userId: 0, batch: { deviceName: 'Example phone', profileName: 'Owner', items: [{ label: 'Mi Browser', packageName: 'com.mi.globalbrowser', system: true, status: 'pending', steps: [{ part: 'data' }, { part: 'obb' }, { part: 'media' }] }] } } as AppActionState, [])
test.beforeEach(async ({ page }) => { await installBackendFixture(page); await page.goto('/') })
test('Cancel is the default, Escape cancels, the background is inert and old snapshots cannot reopen the dialog', async ({ page }) => {
  const before = page.getByRole('navigation').getByRole('button', { name: 'Components', exact: true })
  await before.focus()
  await page.evaluate(prompt => window.backendTest.emit({ type: 'confirmation', state: { revision: 1, prompt } }), { ...content, id: 'test-confirmation' })
  const dialog = page.getByRole('dialog', { name: 'Clear storage', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
  await expect(dialog).toContainText('Mi Browser')
  await expect(dialog).toContainText('Owner · ID 0')
  await expect(dialog).toContainText('cannot be recovered')
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab')
  expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(before).toBeFocused()
  expect(await page.evaluate(() => window.backendTest.requests.at(-1))).toEqual({ type: 'confirmation.answer', id: 'test-confirmation', accepted: false })
  await page.evaluate(prompt => window.backendTest.emit({ type: 'confirmation', state: { revision: 1, prompt } }), { ...content, id: 'test-confirmation' })
  await expect(dialog).not.toBeVisible()
})
test('large selections and long names fit the minimum window; footer and consequences remain reachable', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 680 })
  await page.evaluate(prompt => window.backendTest.emit({ type: 'confirmation', state: { revision: 1, prompt: { ...prompt, id: 'many', applications: Array.from({ length: 500 }, (_, i) => ({ ...prompt.applications![0], label: 'Long application name '.repeat(4), packageName: `org.example.${'long.'.repeat(20)}app${i}`, skipped: i > 497, note: i > 497 ? 'Skipped: unavailable in this profile' : 'App data, OBB, Media' })), selection: { total: 500, affected: 498, skipped: 2 } } } }), content)
  const dialog = page.getByRole('dialog', { name: 'Clear storage', exact: true })
  await expect(dialog).toContainText('498 will run · 2 skipped')
  const button = dialog.getByRole('button', { name: 'Clear storage', exact: true })
  await expect(button).toBeInViewport()
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  const list = dialog.getByRole('list', { name: 'Applications' })
  await list.evaluate(el => { el.scrollTop = el.scrollHeight })
  await expect(list.getByText('Skipped: unavailable in this profile').last()).toBeInViewport()
  await dialog.locator('.confirmation-details summary').click()
  await expect(dialog.getByText(/Completed changes are not rolled back/)).toBeVisible()
  await expect(button).toBeInViewport()
  await button.click()
  expect(await page.evaluate(() => window.backendTest.requests.at(-1))).toEqual({ type: 'confirmation.answer', id: 'many', accepted: true })
})
test('confirmation follows light, dark, Zen and Zero Cool themes', async ({ page }) => {
  await page.evaluate(prompt => window.backendTest.emit({ type: 'confirmation', state: { revision: 1, prompt } }), { ...content, id: 'theme' })
  const dialog = page.getByRole('dialog', { name: 'Clear storage', exact: true })
  for (const theme of [themes.find(t => t.id === 'git-light')!, themes.find(t => t.id === 'git-dark')!, terminalEasterEggTheme]) {
    await page.evaluate(theme => {
      for (const [name, value] of Object.entries(theme.colors)) document.documentElement.style.setProperty(`--${name}`, value)
      document.documentElement.dataset.zenMode = 'true'
      document.documentElement.dataset.terminalMode = String(theme.id === 'terminal-easter-egg')
    }, theme)
    const colors = await dialog.evaluate(el => ({ background: getComputedStyle(el).backgroundColor, text: getComputedStyle(el).color }))
    expect(colors.background).not.toBe(colors.text)
    await expect(dialog.getByRole('button', { name: 'Clear storage', exact: true })).toBeInViewport()
    await page.screenshot({ path: `test-results/confirmation-${theme.id}.png` })
    await dialog.screenshot({ path: `test-results/confirmation-dialog-${theme.id}.png` })
  }
})
