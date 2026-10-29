import { test, expect } from '@playwright/test'
import { installBackendFixture } from './backend-fixture'
import type { FailureDiagnostic, FailureDiagnosticReport } from '../electron/failure-diagnostics-protocol'

const diagnostic: FailureDiagnostic = { id: '11111111-1111-4111-8111-111111111111', operationId: 'backup-failed', createdAt: '2026-10-10T16:00:00Z', updatedAt: '2026-10-10T16:01:00Z', title: 'Backup · 2 applications', deviceId: 'phone', deviceName: 'Test phone', userId: 0, profileName: 'Owner', status: 'error', message: 'Backup interrupted: Device disconnected.', cause: 'ADB connection was lost or changed. The reason is not yet known.', packageName: 'org.classic', appLabel: 'Classic', stage: 'Classic: Copying base.apk', failed: 1, total: 2, saved: true }
const report: FailureDiagnosticReport = { format: 'adb-vault-failure-diagnostic', version: 1, summary: diagnostic, environment: { platform: 'win32', arch: 'x64', appVersion: '0.1.0', zstd: true }, commands: [{ startedAt: diagnostic.createdAt, executable: 'adb.exe', args: ['-t', '2', 'pull', '/data/app/base.apk'], stage: diagnostic.stage, code: 1, stderr: 'adb.exe: no device with transport id 2' }], observations: [{ at: diagnostic.updatedAt, connection: { activeDeviceId: 'phone', status: 'offline', transportId: '2' }, processes: [{ pid: 123, parentPid: 1, startedAt: diagnostic.createdAt, server: true }] }], failures: [{ packageName: 'org.classic', label: 'Classic', message: 'Lost connection' }], adbLog: { path: '%TEMP%/adb.log', tail: 'server startup' }, notes: [] }
test.beforeEach(async ({ page }) => { await installBackendFixture(page); await page.goto('/') })

test('report attaches to its backup without duplicates; details are collapsed and Actions exports the correct report', async ({ page }) => {
  await page.evaluate(({ diagnostic, report }) => {
    window.backendTest.diagnosticReport = report
    window.backendTest.emit({ type: 'backup', state: { operationId: diagnostic.operationId, startedAt: diagnostic.createdAt, id: 'phone', userId: 0, name: 'User', format: 'auto', operation: 'backup', status: 'error', message: diagnostic.message, completed: 1, total: 2, items: [{ packageName: 'org.classic', label: 'Classic', status: 'error', message: 'Lost connection' }, { packageName: 'org.other', label: 'Other', status: 'cancelled' }] } })
    window.backendTest.emit({ type: 'failureDiagnostic', diagnostic })
    window.backendTest.emit({ type: 'failureDiagnostic', diagnostic: { ...diagnostic, updatedAt: '2026-10-10T16:01:03Z' } })
  }, { diagnostic, report })
  await page.getByRole('button', { name: 'Last operation — open Activity' }).click()
  await expect(page.getByRole('region', { name: 'Session events' }).getByRole('row')).toHaveCount(2)
  const details = page.getByRole('region', { name: 'Failure diagnostics' })
  await expect(details).toContainText(diagnostic.cause)
  await expect(details).toContainText('Classic: Copying base.apk')
  await expect(details.locator('details')).not.toHaveAttribute('open', '')
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'diagnostics.read'))).toHaveLength(0)
  await details.getByText('Technical details', { exact: true }).click()
  await expect(details).toContainText('Exit code: 1')
  await expect(details).toContainText('no device with transport id 2')
  await page.screenshot({ path: 'test-results/failure-diagnostics-details.png' })
  await page.getByRole('tab', { name: 'Actions', exact: true }).click()
  await page.getByRole('button', { name: 'Save diagnostics' }).click()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'diagnostics.export'))).toEqual([{ type: 'diagnostics.export', id: diagnostic.id }])
  await expect(page.getByRole('region', { name: 'Session events' }).getByRole('row')).toHaveCount(2)
  await page.screenshot({ path: 'test-results/failure-diagnostics-actions.png' })
})

test('saved reports appear from a fresh backend snapshot and clearing the session does not resurrect them', async ({ page }) => {
  await page.evaluate(diagnostic => { window.backendTest.snapshot.failureDiagnostics = [diagnostic] }, diagnostic)
  await page.getByRole('button', { name: 'Check components', exact: true }).click()
  await page.getByRole('navigation').getByRole('button', { name: 'Activity', exact: true }).click()
  await page.getByRole('button', { name: 'Event: Backup · 2 applications' }).click()
  await expect(page.getByRole('region', { name: 'Failure diagnostics' })).toContainText('Diagnostics saved automatically')
  await page.getByLabel('Search activity').fill('org.classic')
  await expect(page.getByRole('region', { name: 'Session events' }).getByRole('row')).toHaveCount(2)
  await page.getByRole('button', { name: 'Clear session history' }).click()
  await page.getByRole('navigation').getByRole('button', { name: 'Components', exact: true }).click()
  await page.getByRole('button', { name: 'Check components', exact: true }).click()
  await page.getByRole('navigation').getByRole('button', { name: 'Activity', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Event: Backup · 2 applications' })).toHaveCount(0)
})

test('unavailable report is explained and cannot be exported', async ({ page }) => {
  await page.evaluate(diagnostic => window.backendTest.emit({ type: 'failureDiagnostic', diagnostic: { ...diagnostic, saved: false, saveError: 'Disk full' } }), diagnostic)
  await page.getByRole('navigation').getByRole('button', { name: 'Activity', exact: true }).click()
  await page.getByRole('button', { name: 'Event: Backup · 2 applications' }).click()
  await expect(page.getByRole('region', { name: 'Failure diagnostics' })).toContainText('could not be saved: Disk full')
  await page.getByRole('tab', { name: 'Actions', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save diagnostics' })).toBeDisabled()
})
