import { test, expect } from '@playwright/test'
import { installBackendFixture, connectionEvent } from './backend-fixture'
import type { AndroidApp } from '../electron/apps-protocol'
const app: AndroidApp = { packageName: 'org.example.one', label: 'Debug app', userId: 0, uid: 10123, enabled: true, system: false, updatedSystemApp: false, debuggable: true, stopped: false, suspended: false, enabledState: 0, versionName: '1', versionCode: 1, sourceDir: '/data/app/base.apk', firstInstallTime: 0, lastUpdateTime: 0, targetSdk: 35, minSdk: 26, installer: null, iconPng: null, splitCount: 0 }
test.beforeEach(async ({ page }) => {
  await installBackendFixture(page); await page.goto('/')
  await connectionEvent(page, { devices: [{ id: 'phone', serial: 'serial', name: 'Phone', method: 'USB', status: 'connected', android: '16', endpoint: 'serial', lastSeen: '', known: true, canDetach: false }], activeDeviceId: 'phone' })
  await page.evaluate(app => {
    window.backendTest.snapshot.apps.apps = [app, { ...app, packageName: 'org.example.two', label: 'Tracker app', debuggable: false }, { ...app, packageName: 'org.example.three', label: 'Plain app', debuggable: false }]
    window.backendTest.snapshot.apps.badgeEvidence = {
      'org.example.two': { badges: {}, splits: [], links: [], issues: [], badgeChecks: { trackers: { present: true, reason: 'Matched', items: [] } } },
      'org.example.three': { badges: {}, splits: [], links: [], issues: [], badgeChecks: { trackers: { present: false, reason: 'No matches', items: [] } } },
    }
  }, app)
  await page.getByRole('navigation').getByRole('button', { name: 'Apps', exact: true }).click()
})
test('badge filters combine evidence and inventory, distinguish unknown and preserve choices', async ({ page }) => {
  await page.getByRole('button', { name: 'Filter applications', exact: true }).click()
  await page.getByRole('tab', { name: 'Badges', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'Filter applications' })
  await panel.getByRole('checkbox', { name: 'Badge Trackers', exact: true }).check()
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(2)
  await expect(page.getByRole('table')).toContainText('Tracker app')
  await expect(page.locator('.apps-badge-status')).toContainText('1 apps have unchecked or unavailable')
  await panel.getByRole('checkbox', { name: 'Badge Debuggable', exact: true }).check()
  await expect(page.locator('.apps-result-count')).toHaveText('0 of 3')
  await panel.getByRole('radio', { name: 'Any selected badge', exact: true }).check()
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(3)
  await expect(page.locator('.apps-badge-status')).toContainText('All candidate apps have a definite filter result')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Filter applications', exact: true }).click()
  await page.getByRole('tab', { name: /^Selected/ }).click()
  await page.getByRole('button', { name: 'Remove Badge: Debuggable filter', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(2)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('adb-vault-apps-view')!).state.filters)).toMatchObject({ badges: ['trackers'], badgeMatch: 'any' })
  expect(await page.evaluate(() => window.backendTest.requests.some(r => r.type === 'apps.badges'))).toBe(false)
  await page.getByRole('button', { name: 'Filter applications', exact: true }).click()
  await page.getByRole('tab', { name: 'Badges', exact: true }).click()
  await page.setViewportSize({ width: 1000, height: 680 })
  await expect.poll(() => panel.evaluate(el => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(680)
  await page.screenshot({ path: 'test-results/badge-filters.png' })
  expect(await page.locator('main').evaluate(el => el.scrollHeight <= el.clientHeight)).toBe(true)
})
test('badge reading is explicit, reports progress and can be cancelled outside Filter', async ({ page }) => {
  await page.getByRole('button', { name: 'Filter applications', exact: true }).click()
  await page.getByRole('tab', { name: 'Badges', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Badge Trackers', exact: true }).check()
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  expect(await page.evaluate(() => window.backendTest.requests.at(-1))).toEqual({ type: 'apps.badges', id: 'phone', userId: 0 })
  await page.evaluate(() => window.backendTest.emit({ type: 'apps', apps: { ...window.backendTest.snapshot.apps, badgeRead: { status: 'running', completed: 1, total: 3, failed: 0 } } }))
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('table')).toBeVisible()
  await expect(page.getByRole('progressbar', { name: 'Badge reading progress' })).toHaveAttribute('value', '1')
  await page.getByRole('button', { name: 'Cancel badge reading', exact: true }).click()
  expect(await page.evaluate(() => window.backendTest.requests.at(-1))).toEqual({ type: 'apps.cancelBadges' })
  await page.evaluate(() => window.backendTest.emit({ type: 'apps', apps: { ...window.backendTest.snapshot.apps, badgeRead: { status: 'cancelled', completed: 1, total: 3, failed: 0 } } }))
  await expect(page.locator('.toast')).toContainText('Badge reading cancelled · 1 / 3')
  await expect(page.locator('.apps-view-controls > .apps-badge-status')).toHaveCount(0)
})

test('General-only filters and an empty badge selection never start badge reading', async ({ page }) => {
  await page.getByRole('button', { name: 'Filter applications', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'Filter applications' })
  const apply = panel.getByRole('button', { name: 'Apply', exact: true })
  await expect(apply).toBeDisabled()
  await panel.getByRole('radio', { name: 'Disabled', exact: true }).check()
  await expect(page.locator('.apps-result-count')).toHaveText('0 of 3')
  await expect(apply).toBeDisabled()
  await panel.getByRole('tab', { name: 'Badges', exact: true }).click()
  await expect(apply).toBeDisabled()
  const trackers = panel.getByRole('checkbox', { name: 'Badge Trackers', exact: true })
  await trackers.check()
  await expect(apply).toBeEnabled()
  await trackers.uncheck()
  await expect(apply).toBeDisabled()
  await trackers.check()
  await panel.getByRole('tab', { name: 'General', exact: true }).click()
  await expect(apply).toBeEnabled()
  await panel.getByRole('tab', { name: /^Selected/ }).click()
  await panel.getByRole('button', { name: 'Remove Badge: Trackers filter', exact: true }).click()
  await expect(apply).toBeDisabled()
  await panel.getByRole('button', { name: 'Clear filters', exact: true }).click()
  await expect(apply).toBeDisabled()
  await apply.evaluate((button: HTMLButtonElement) => button.click())
  expect(await page.evaluate(() => window.backendTest.requests.some(r => r.type === 'apps.badges'))).toBe(false)
  await expect(page.getByRole('progressbar', { name: 'Badge reading progress' })).toHaveCount(0)
})
test('badge search allows implemented local Backup and Play App Signing checks', async ({ page }) => {
  await page.getByRole('button', { name: 'Filter applications', exact: true }).click()
  await page.getByRole('tab', { name: 'Badges', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Search badges', exact: true }).fill('Backup')
  await expect(page.getByRole('checkbox', { name: 'Badge Backup', exact: true })).toBeEnabled()
  await expect(page.locator('.apps-badge-choices')).not.toContainText('Planned')
  await page.getByRole('searchbox', { name: 'Search badges', exact: true }).fill('play')
  await expect(page.getByRole('checkbox', { name: 'Badge Play App Signing', exact: true })).toBeEnabled()
})

test('completion is a five-second notification, with results retained inside Badges', async ({ page }) => {
  const now = new Date()
  await page.clock.install({ time: now })
  await page.clock.pauseAt(now)
  await page.evaluate(() => {
    const apps = window.backendTest.snapshot.apps
    window.backendTest.emit({ type: 'apps', apps: { ...apps, badgeRead: { status: 'running', completed: 2, total: 3, failed: 0 } } })
    window.backendTest.emit({ type: 'apps', apps: { ...apps, badgeRead: { status: 'complete', completed: 3, total: 3, failed: 1 } } })
  })
  await expect(page.locator('.toast')).toContainText('Badge reading complete · 3 / 3 · 1 failed')
  await expect(page.locator('.apps-view-controls > .apps-badge-status')).toHaveCount(0)
  await page.clock.runFor(4999)
  await expect(page.locator('.toast')).toBeVisible()
  await page.clock.runFor(2)
  await expect(page.locator('.toast')).toHaveCount(0)
  await page.evaluate(() => window.backendTest.emit({ type: 'apps', apps: { ...window.backendTest.snapshot.apps } }))
  await expect(page.locator('.toast')).toHaveCount(0)
  await page.getByRole('button', { name: 'Filter applications', exact: true }).click()
  await page.getByRole('tab', { name: 'General', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Badges', exact: true })).toBeFocused()
  await expect(page.locator('.apps-badge-read-controls')).toContainText('Badge reading complete · 3 / 3 · 1 failed')
  await page.keyboard.press('End')
  await expect(page.getByRole('tab', { name: 'Selected (0)', exact: true })).toBeFocused()
  await expect(page.getByText('No filters selected.', { exact: true })).toBeVisible()
})

test('toolbar controls share compact height and tabbed filter stays bounded in both densities', async ({ page }) => {
  for (const density of ['Compact', 'Comfortable']) {
    await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('radio', { name: new RegExp(density) }).check()
    await page.getByRole('navigation').getByRole('button', { name: 'Apps', exact: true }).click()
    for (const width of [1440, 1000]) {
      await page.setViewportSize({ width, height: 680 })
      const buttons = await page.locator('.apps-query-actions > button').evaluateAll(els => els.map(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })))
      expect(buttons).toHaveLength(3)
      for (const button of buttons) expect(button.height).toBe(24)
      expect(await page.locator('.apps-query-end .component-search').evaluate(el => el.getBoundingClientRect().height)).toBe(24)
      await page.getByRole('button', { name: 'Filter applications', exact: true }).click()
      await page.getByRole('tab', { name: 'Badges', exact: true }).click()
      const panel = page.getByRole('dialog', { name: 'Filter applications' })
      await expect.poll(() => panel.evaluate(el => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(680)
      await panel.locator('.apps-filter-body').evaluate(el => { el.scrollTop = el.scrollHeight })
      await expect(panel.getByRole('tab', { name: 'General', exact: true })).toBeInViewport()
      await expect(panel.getByRole('button', { name: 'Clear filters', exact: true })).toBeInViewport()
      await page.screenshot({ path: `test-results/filter-tabs-${density}-${width}.png` })
      await page.keyboard.press('Escape')
      expect(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight)).toBe(true)
    }
  }
})

test('Apply is global and filter colors follow badge settings without delaying General', async ({ page }) => {
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('group', { name: 'Settings categories' }).getByRole('button', { name: 'Badges', exact: true }).click()
  await page.getByLabel('Color User', { exact: true }).fill('#ffee00')
  await page.getByLabel('Text mode User', { exact: true }).selectOption('custom')
  await page.getByLabel('Text color User', { exact: true }).fill('#123456')
  await page.getByLabel('Color Trackers', { exact: true }).fill('#112233')
  await page.getByLabel('Color All types', { exact: true }).fill('#334455')
  await page.getByLabel('Text mode All types', { exact: true }).selectOption('custom')
  await page.getByLabel('Text color All types', { exact: true }).fill('#abcdef')
  await page.getByRole('navigation').getByRole('button', { name: 'Apps', exact: true }).click()
  await page.setViewportSize({ width: 1000, height: 680 })
  await page.getByRole('button', { name: 'Filter applications', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'Filter applications' })
  await expect(panel.getByRole('button', { name: 'Apply', exact: true })).toBeVisible()
  await panel.getByRole('radio', { name: 'Disabled', exact: true }).check()
  await expect(page.locator('.apps-result-count')).toHaveText('0 of 3')
  await panel.getByRole('radio', { name: 'Any', exact: true }).check()
  await panel.getByRole('radio', { name: 'User', exact: true }).check()
  await expect(panel.locator('.apps-general-filters .app-info-badge')).toHaveCount(12)
  await expect(panel.locator('.apps-general-filters label:not(:has(.app-info-badge))')).toHaveCount(0)
  await expect(panel.locator('.apps-general-filters [data-badge-appearance="type.user"]')).toHaveCSS('background-color', 'rgb(255, 238, 0)')
  await expect(panel.locator('.apps-general-filters [data-badge-appearance="type.user"]')).toHaveCSS('color', 'rgb(18, 52, 86)')
  await expect(panel.locator('[data-badge-appearance="filter.allTypes"]')).toHaveCSS('background-color', 'rgb(51, 68, 85)')
  await expect(panel.locator('[data-badge-appearance="filter.allTypes"]')).toHaveCSS('color', 'rgb(171, 205, 239)')
  expect(await panel.locator('.apps-filter-body').evaluate(el => el.scrollHeight <= el.clientHeight)).toBe(true)
  await page.screenshot({ path: 'test-results/general-colored.png' })
  await panel.getByRole('tab', { name: 'Badges', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Apply', exact: true })).toBeVisible()
  await expect(panel.locator('.apps-badge-choices [data-badge-appearance="trackers"]')).toHaveCSS('background-color', 'rgb(17, 34, 51)')
  await panel.getByRole('checkbox', { name: 'Badge Trackers', exact: true }).check()
  await page.screenshot({ path: 'test-results/badges-colored.png' })
  await panel.getByRole('tab', { name: /^Selected/ }).click()
  await expect(panel.locator('.apps-selected-filters [data-badge-appearance="trackers"]')).toHaveCSS('background-color', 'rgb(17, 34, 51)')
  await panel.getByRole('button', { name: 'Apply', exact: true }).click()
  expect(await page.evaluate(() => window.backendTest.requests.at(-1))).toEqual({ type: 'apps.badges', id: 'phone', userId: 0 })
  await page.evaluate(() => window.backendTest.emit({ type: 'apps', apps: { ...window.backendTest.snapshot.apps, badgeRead: { status: 'complete', completed: 3, total: 3, failed: 1 } } }))
  await panel.getByRole('tab', { name: 'General', exact: true }).click()
  expect(await panel.locator('.apps-filter-body').evaluate(el => el.scrollHeight <= el.clientHeight)).toBe(true)
  await expect(panel.getByRole('button', { name: 'Apply', exact: true })).toBeInViewport()
})


test('Backup filtering uses local evidence and Apply never reads Android badges', async ({ page }) => {
  await page.evaluate(() => window.backendTest.emit({ type: 'apps', apps: {
    ...window.backendTest.snapshot.apps,
    apps: window.backendTest.snapshot.apps.apps.map((app, i) => ({ ...app, backupCheck: { present: i === 0, reason: 'Local APK backup', items: [] } })),
  } }))
  await page.getByRole('button', { name: 'Filter applications', exact: true }).click()
  await page.getByRole('tab', { name: 'Badges', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Badge Backup', exact: true }).check()
  await expect(page.locator('.apps-result-count')).toHaveText('1 of 3')
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  expect(await page.evaluate(() => window.backendTest.requests.at(-1))).toEqual({ type: 'apps.refreshBackups' })
  expect(await page.evaluate(() => window.backendTest.requests.some(r => r.type === 'apps.badges'))).toBe(false)
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.backendTest.emit({ type: 'apps', apps: {
    ...window.backendTest.snapshot.apps,
    apps: window.backendTest.snapshot.apps.apps.map(app => ({ ...app, backupCheck: { present: false, reason: 'File removed', items: [] } })),
  } }))
  await expect(page.locator('.apps-result-count')).toHaveText('0 of 3')
})

test('Backup badge opens version and ZIP location and updates after deletion', async ({ page }) => {
  await page.evaluate(() => {
    window.backendTest.emit({ type: 'apps', apps: {
      ...window.backendTest.snapshot.apps,
      apps: window.backendTest.snapshot.apps.apps.map((app, i) => ({ ...app, backupCheck: {
        present: i === 0, reason: 'APK installation files only; no app data or cache.', items: i === 0 ? [
          { name: 'Copy 1', value: 'APK inside ZIP - 2026-10-04' },
          { name: 'Version', value: '0.9 (9) - Different from installed version' },
          { name: 'Location', value: 'D:/Backups/Phone/User.zip' },
          { name: 'Archive entry', value: 'Debug app.apk' },
        ] : [],
      } })),
    } })
  })
  await page.getByRole('button', { name: 'Details for Debug app', exact: true }).dblclick()
  const badge = page.locator('.app-badges').getByRole('button', { name: 'Backup', exact: true })
  await expect(badge).toBeVisible()
  await badge.click()
  const dialog = page.getByRole('dialog', { name: 'Backup', exact: true })
  await expect(dialog).toContainText('Different from installed version')
  await expect(dialog).toContainText('D:/Backups/Phone/User.zip')
  await expect(dialog).toContainText('Debug app.apk')
  expect(await page.evaluate(() => window.backendTest.requests.at(-1))).toEqual({ type: 'apps.refreshBackups' })
  await page.screenshot({ path: 'test-results/backup-badge.png' })
  await page.evaluate(() => window.backendTest.emit({ type: 'apps', apps: {
    ...window.backendTest.snapshot.apps,
    apps: window.backendTest.snapshot.apps.apps.map(app => ({ ...app, backupCheck: { present: false, reason: 'No available registered APK backup. File removed.', items: [] } })),
  } }))
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('File removed')
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(badge).toHaveCount(0)
})
