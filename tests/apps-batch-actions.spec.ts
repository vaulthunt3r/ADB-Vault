import { test, expect } from '@playwright/test'
import { connectionEvent, installBackendFixture } from './backend-fixture'

test.beforeEach(async ({ page }) => {
  await installBackendFixture(page); await page.goto('/')
  await connectionEvent(page, { devices: [{ id: 'phone', serial: 'phone', name: 'Phone', status: 'connected', android: '16', method: 'USB', endpoint: 'phone', lastSeen: '', known: true, canDetach: false }], activeDeviceId: 'phone' })
  await page.evaluate(() => { Object.assign(window.backendTest.snapshot.apps, { deviceId: 'phone', userId: 0, status: 'ready', profiles: [{ id: 0, name: 'Owner', managed: false, running: true }], apps: ['Alpha', 'Beta', 'Gamma'].map((label, i) => ({ packageName: `org.example.${label.toLowerCase()}`, label, versionName: '1', versionCode: 1, uid: 10001 + i, userId: 0, enabled: i !== 1, system: false, updatedSystemApp: false, sourceDir: '/data/app/base.apk', firstInstallTime: 0, lastUpdateTime: 0, targetSdk: 35, minSdk: 26, installer: null, enabledState: 0, suspended: false, stopped: false, debuggable: false, iconPng: null })) }) })
  await page.getByRole('navigation').getByRole('button', { name: 'Apps', exact: true }).click()
  await page.evaluate(() => { const s = window.backendTest.snapshot.apps; window.backendTest.emit({ type: 'apps', apps: { ...s, apps: s.apps.map((a, i) => ({ ...a, enabled: i !== 1 })) } }) })
  await page.getByRole('checkbox', { name: 'Select all filtered applications', exact: true }).check()
  await page.getByRole('tab', { name: 'Actions', exact: true }).click()
})
test('marked apps own Actions and Backup even when another row is highlighted or filtered out', async ({ page }) => {
  const panel = page.getByRole('tabpanel')
  const count = await page.getByRole('table').getByRole('checkbox').count() - 1
  await expect(panel.getByRole('heading', { name: `Selected ${count} applications` })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Launch application', exact: true })).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Scan APKs', exact: true })).toHaveCount(0)
  await page.getByRole('table').getByRole('button', { name: /Details for/ }).first().click()
  await expect(page.getByRole('tab', { name: 'Actions', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByPlaceholder('Name or package…').fill('Alpha')
  await expect(panel.getByRole('heading', { name: `Selected ${count} applications` })).toBeVisible()
  await page.screenshot({ path: 'test-results/batch-actions.png' })
  await panel.getByRole('button', { name: `Backup (${count})`, exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await panel.getByRole('button', { name: new RegExp(`^Force stop \\(${count}\\)$`) }).click()
  const req = await page.evaluate(() => window.backendTest.requests.at(-1))
  expect(req?.type).toBe('apps.batchAction')
  if (req?.type === 'apps.batchAction') expect(req.plan.packages).toHaveLength(count)
})
test('batch Freeze and Unfreeze skip disabled or matching states without package method options', async ({ page }) => {
  await page.evaluate(() => {
    const apps = window.backendTest.snapshot.apps
    window.backendTest.emit({ type: 'apps', apps: { ...apps, apps: apps.apps.map(app => ({ ...app, suspended: app.packageName.endsWith('.gamma') })) } })
  })
  const panel = page.getByRole('tabpanel')
  for (const [name, action] of [['Freeze', 'suspend'], ['Unfreeze', 'unsuspend']]) {
    await panel.getByRole('button', { name: new RegExp(`^${name} \\(1\\)`) }).click()
    const request = await page.evaluate(() => window.backendTest.requests.at(-1))
    expect(request?.type).toBe('apps.batchAction')
    if (request?.type === 'apps.batchAction') {
      expect(request.plan.action).toBe(action)
      expect(request.plan.userId).toBe(0)
      expect(request.plan.packages).toHaveLength(3)
      expect(request.plan.options).toBeUndefined()
    }
    await page.evaluate(() => window.backendTest.emit({ type: 'appAction', state: { ...window.backendTest.snapshot.appAction!, status: 'success' } }))
  }
})
test('clearing marks returns to single-app actions; changing inspected row does not clear marks', async ({ page }) => {
  const panel = page.getByRole('tabpanel')
  await page.getByRole('table').getByRole('button', { name: /Details for/ }).first().click()
  await panel.getByRole('button', { name: 'Clear selection', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Launch application', exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Back up this app', exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Scan APKs', exact: true })).toBeEnabled()
})
test('batch progress survives cleared marks and offers stop after current; uncertain results exclude retry', async ({ page }) => {
  const panel = page.getByRole('tabpanel')
  await panel.getByRole('button', { name: /^Force stop \(/ }).click()
  await page.getByRole('checkbox', { name: 'Select all filtered applications', exact: true }).uncheck()
  await expect(panel.getByRole('list', { name: 'Batch action results' })).toHaveCount(0)
  await page.getByLabel('Workspace operations').getByRole('button', { name: 'Force stop', exact: true }).click()
  const details = page.getByRole('region', { name: 'Operation details', exact: true })
  await expect(details.getByRole('button', { name: 'Stop after current application', exact: true })).toBeVisible()
  await details.getByRole('button', { name: 'Stop after current application', exact: true }).click()
  await expect(details.getByRole('button', { name: 'Stopping after current application…' })).toBeDisabled()
  await page.evaluate(() => { const state = window.backendTest.snapshot.appAction!; window.backendTest.emit({ type: 'appAction', state: { ...state, status: 'error', batch: { ...state.batch!, items: state.batch!.items.map(i => ({ ...i, status: 'error', uncertain: true })) } } }) })
  await expect(details.getByRole('button', { name: 'Retry unfinished…' })).toHaveCount(0)
  await expect(details.getByRole('table')).toContainText('Outcome uncertain.')
})

for (const part of ['OBB', 'media']) test(`batch Clear ${part} targets all marks, including filtered-out apps`, async ({ page }) => {
  await page.getByPlaceholder('Name or package…').fill('Alpha')
  const panel = page.getByRole('tabpanel')
  await panel.getByRole('button', { name: 'Clear', exact: true }).click()
  await panel.getByRole('checkbox', { name: part === 'media' ? 'Media' : part, exact: true }).check()
  const button = panel.getByRole('button', { name: 'Clear selected', exact: true })
  await expect(button).toBeEnabled()
  await button.click()
  expect(await page.evaluate(() => window.backendTest.requests.at(-1))).toEqual({ type: 'apps.batchAction', plan: { id: 'phone', userId: 0, action: 'clear-storage', options: {}, cleanup: [part.toLowerCase()], packages: ['org.example.alpha', 'org.example.beta', 'org.example.gamma'] } })
  await page.getByLabel('Workspace operations').getByRole('button', { name: 'Clear storage', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Operation details' }).getByRole('table').getByRole('row')).toHaveCount(4)
})
