import { test, expect } from '@playwright/test'
import { installBackendFixture } from './backend-fixture'
test.setTimeout(90_000)

test('Details and Actions pin independently in every workspace and respect selection', async ({ page }) => {
  await installBackendFixture(page); await page.goto('/')
  const actions = page.getByRole('tab', { name: 'Actions', exact: true }), details = page.getByRole('tab', { name: 'Details', exact: true })
  for (const name of ['Components', 'Connection', 'Apps', 'Monitor', 'Activity', 'Settings']) {
    await page.getByRole('button', { name, exact: true }).first().click()
    await actions.dblclick()
    await expect(actions).toHaveAttribute('aria-description', 'Pinned in this workspace')
    if (name === 'Components') {
      await page.getByRole('button', { name: 'Select Android Debug Bridge', exact: true }).click()
      await expect(actions).toHaveAttribute('aria-selected', 'true')
    }
  }
  await page.getByRole('button', { name: 'Components', exact: true }).first().click()
  await expect(actions).toHaveAttribute('aria-description', 'Pinned in this workspace')
  await details.click()
  await expect(actions).not.toHaveAttribute('aria-description', /Pinned/)
  await details.press('Alt+p')
  await expect(details).toHaveAttribute('aria-description', 'Pinned in this workspace')
  await page.getByRole('button', { name: 'Connection', exact: true }).first().click()
  await expect(actions).toHaveAttribute('aria-description', 'Pinned in this workspace')
  await actions.dblclick()
  await expect(actions).not.toHaveAttribute('aria-description', /Pinned/)
  await page.getByRole('button', { name: 'Components', exact: true }).first().click()
  await expect(details).toHaveAttribute('aria-description', 'Pinned in this workspace')
})
