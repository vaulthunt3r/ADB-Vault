import { test, expect, type Page } from '@playwright/test'
import { installBackendFixture } from './backend-fixture'
import type { HistorySnapshot, SavedSession } from '../electron/history-protocol'

const oldId = '11111111-1111-4111-8111-111111111111', currentId = '22222222-2222-4222-8222-222222222222'
const old: SavedSession = {
  version: 1, session: { id: oldId, startedAt: '2026-10-14T10:00:00Z', updatedAt: '2026-10-14T10:05:00Z', status: 'interrupted', pid: 1, activityCount: 1, taskCount: 1, unfinished: 1 }, pending: [],
  activity: [{ id: 1, sessionId: oldId, time: '2026-10-14T10:01:00Z', text: 'Previous copy operation', source: 'files', tone: 'warning', interrupted: true }],
  tasks: [{ id: 'archived-copy', action: 'copy', source: { kind: 'local', path: 'C:\\Old source' }, destination: { kind: 'local', path: 'D:\\Archive' }, status: 'interrupted', previousStatus: 'running', createdAt: '2026-10-14T10:01:00Z', current: 'second.mp3', completed: 1, bytes: 42, pauseRequested: false, stopRequested: false, undoable: false, items: [{ path: 'first.mp3', status: 'success' }, { path: 'second.mp3', status: 'interrupted', uncertain: true }, { path: 'third.mp3', status: 'pending' }] }],
}
const current: HistorySnapshot = { current: { id: currentId, startedAt: '2026-10-15T10:00:00Z', updatedAt: '2026-10-15T10:01:00Z', status: 'open', pid: 2, activityCount: 1, taskCount: 0, unfinished: 0 }, sessions: [old.session], activity: [{ id: 20, sessionId: currentId, time: '2026-10-15T10:01:00Z', text: 'Current connection event', tone: 'success', source: 'connection' }] }

async function setup(page: Page) {
  await installBackendFixture(page); await page.goto('/')
  await page.evaluate(({ current, old }) => {
    window.backendTest.snapshot.history = current
    window.backendTest.snapshot.files = { tasks: [], revision: 0 }
    const original = window.desktop!.request
    window.desktop!.request = async request => {
      if (request.type.startsWith('history.') || request.type === 'files.list') {
        window.backendTest.requests.push(request)
        if (request.type === 'history.read') return { ok: true, snapshot: window.backendTest.snapshot, historySession: old }
        if (request.type === 'history.clear') { window.backendTest.snapshot.history!.activity = []; window.backendTest.emit({ type: 'history', overview: window.backendTest.snapshot.history! }) }
        if (request.type === 'files.list') return { ok: true, snapshot: window.backendTest.snapshot, fileListing: { location: { kind: 'local', path: request.location.path || 'C:\\' }, parent: '', entries: [] } }
        return { ok: true, snapshot: window.backendTest.snapshot }
      }
      return original(request)
    }
    window.backendTest.emit({ type: 'history', overview: current })
  }, { current, old })
}

test('current and previous Activity remain separate while new events arrive; export includes session identity', async ({ page }) => {
  await setup(page)
  await page.getByRole('button', { name: 'Dismiss recovered session notice' }).click()
  await page.getByRole('navigation').getByRole('button', { name: 'Activity', exact: true }).click()
  const events = page.getByRole('region', { name: 'Session events' })
  await expect(page.getByLabel('Activity session')).toHaveValue('')
  await expect(events).toContainText('Current connection event'); await expect(events).not.toContainText('Previous copy')
  await page.getByLabel('Activity session').selectOption(oldId)
  await expect(events).toContainText('Previous copy'); await expect(events).not.toContainText('Current connection')
  await events.getByRole('button', { name: 'Event: Previous copy operation' }).click()
  await page.evaluate(() => {
    const h = window.backendTest.snapshot.history!
    h.activity.unshift({ id: 21, sessionId: h.current.id, time: new Date().toISOString(), source: 'system', tone: 'info', text: 'New live event' })
    window.backendTest.emit({ type: 'history', overview: h })
  })
  await expect(page.getByRole('region', { name: 'Operation details' })).toContainText('Previous copy operation')
  await expect(events).not.toContainText('New live event')
  await expect(page.getByRole('button', { name: 'Clear session history' })).toHaveCount(0)
  const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export shown' }).click()
  const download = await downloaded, { readFile } = await import('node:fs/promises')
  const text = await readFile((await download.path())!, 'utf8')
  expect(text).toContain(oldId); expect(text).not.toContain('New live event')
  await page.screenshot({ path: 'test-results/history-previous-session.png' })
  await page.getByLabel('Activity session').selectOption('')
  await expect(events).toContainText('New live event'); await expect(events).not.toContainText('Previous copy')
  await expect(page.getByRole('region', { name: 'Operation details' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Event summary' })).toHaveCount(0)
  await expect(page.getByRole('complementary', { name: 'Context sidebar' })).toContainText('Select an event to read its details.')
  await page.getByRole('button', { name: 'Clear session history' }).click()
  await expect(events.getByRole('row')).toHaveCount(1)
  await page.getByLabel('Activity session').selectOption(oldId)
  await expect(events).toContainText('Previous copy operation')
  await page.setViewportSize({ width: 1000, height: 680 })
  expect(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight)).toBe(true)
})

test('saved file tasks have no live controls and never enter the current queue', async ({ page }) => {
  await setup(page); await page.getByRole('button', { name: 'Dismiss recovered session notice' }).click()
  await page.getByRole('navigation').getByRole('button', { name: 'Files', exact: true }).click()
  await page.getByRole('button', { name: 'Tasks', exact: true }).click()
  const panel = page.getByRole('complementary', { name: 'File tasks' })
  await expect(panel).toContainText('No file tasks yet.')
  await page.getByLabel('File tasks session').selectOption(oldId)
  await expect(panel).toContainText('Interrupted — verify the result')
  await expect(panel.getByRole('button', { name: /^(Resume|Pause|Stop|Undo|Retry unfinished)$/ })).toHaveCount(0)
  await panel.getByText('Object results', { exact: true }).click()
  await expect(panel).toContainText('second.mp3'); await expect(panel).toContainText('Outcome uncertain')
  expect(await page.evaluate(() => window.backendTest.requests.some(r => r.type === 'files.control' || r.type === 'files.enqueue'))).toBe(false)
  await page.screenshot({ path: 'test-results/history-file-tasks.png' })
  await panel.getByRole('button', { name: 'Open Activity' }).click()
  await expect(page.getByLabel('Activity session')).toHaveValue(oldId)
  await page.getByRole('navigation').getByRole('button', { name: 'Files', exact: true }).click()
  await page.getByRole('button', { name: 'Tasks', exact: true }).click()
  await expect(page.getByLabel('File tasks session')).toHaveValue('')
  await page.getByLabel('File tasks session').selectOption('')
  await expect(panel).toContainText('No file tasks yet.'); await expect(panel).not.toContainText('second.mp3')
  await page.getByLabel('File tasks session').selectOption(oldId)
  await panel.getByRole('button', { name: 'Close file tasks' }).click()
  await page.evaluate(old => {
    const task = { ...old.tasks[0], id: 'live-conflict', status: 'conflict' as const, conflict: { source: 'now.txt', destination: 'D:\\now.txt', directory: false } }
    window.backendTest.emit({ type: 'files', state: { tasks: [task], revision: 10 } })
  }, old)
  await expect(page.getByLabel('File tasks session')).toHaveValue('')
  await expect(panel.getByRole('group', { name: 'Existing destination' })).toBeVisible()
})

test('recovery notice opens its own session; a failed read never falls back to live events', async ({ page }) => {
  await setup(page)
  await page.getByRole('button', { name: 'View session', exact: true }).click()
  await expect(page.getByLabel('Activity session')).toHaveValue(oldId)
  await expect(page.getByRole('region', { name: 'Session events' })).toContainText('Previous copy')
  await page.getByLabel('Activity session').selectOption('')
  await page.evaluate(() => {
    const original = window.desktop!.request
    window.desktop!.request = async r => r.type === 'history.read' ? { ok: false, snapshot: window.backendTest.snapshot, error: 'History file unavailable' } : original(r)
  })
  await page.getByLabel('Activity session').selectOption(oldId)
  await expect(page.getByRole('alert')).toContainText('History file unavailable')
  await expect(page.getByRole('region', { name: 'Session events' })).not.toContainText('Current connection')
})
