import { test, expect, type Page } from '@playwright/test'
import { installBackendFixture, connectionEvent } from './backend-fixture'
import type { BackendRequest } from '../electron/contracts'

async function setup(page: Page) {
  await installBackendFixture(page); await page.goto('/')
  await connectionEvent(page, { activeDeviceId: 'phone', devices: [{ id: 'phone', serial: 'PHONE', transportId: '2', name: 'Redmi Note 4', android: '13', status: 'connected', method: 'USB', endpoint: 'PHONE', lastSeen: '', known: true, canDetach: false }] })
  await page.evaluate(() => {
    const original = window.desktop!.request
    let clipboard: import('../electron/files-protocol').FileClipboardSelection | undefined
    window.backendTest.snapshot.files = { tasks: [], revision: 1 }
    window.desktop!.request = async request => {
      if (!request.type.startsWith('files.')) return original(request)
      window.backendTest.requests.push(request)
      if (request.type === 'files.network.connect') return { ok: true, snapshot: window.backendTest.snapshot, folder: request.address }
      if (request.type === 'files.storages') return { ok: true, snapshot: window.backendTest.snapshot, fileStorages: [
        { kind: 'internal', name: 'Internal storage', path: '/storage/emulated/0' },
        { kind: 'sd', name: 'SD card · Photos', path: '/storage/1234-5678' },
        { kind: 'usb', name: 'USB storage', path: '/storage/ABCD-1234', readOnly: true },
      ] }
      if (request.type === 'files.list') {
        const location = { ...request.location, path: request.location.path || 'C:\\Downloads' }, sep = location.kind === 'local' ? '\\' : '/'
        const names = location.kind === 'local' ? ['Photos', 'SD Maid.apk', 'Notes.txt', '.hidden'] : ['Download', 'DCIM', 'Manual.pdf']
        const entries = names.map((name, i) => ({ name, path: location.path + sep + name, kind: name === 'Photos' || name === 'Download' || name === 'DCIM' ? 'directory' as const : 'file' as const, size: i * 1048576, modified: 1791442800000, fingerprint: 'fingerprint-' + name }))
        return { ok: true, snapshot: window.backendTest.snapshot, fileListing: { location, entries, parent: location.kind === 'local' ? location.path.startsWith('\\\\') && location.path.slice(2).split('\\').length === 2 ? '' : location.path.replace(/[\\/][^\\/]+$/, '').replace(/^([A-Za-z]:)$/, '$1\\') : '/', free: location.kind === 'local' ? 100_000_000_000 : undefined } }
      }
      if (request.type === 'files.clipboard.write') {
        clipboard = { token: 'clipboard-test', mode: request.mode, groups: [{ source: request.selection.source, entries: request.selection.items.map(i => ({ name: i.path.split(/[\\/]/).at(-1)!, path: i.path, fingerprint: i.fingerprint, kind: 'file' as const, size: 10, modified: 1 })) }] }
        return { ok: true, snapshot: window.backendTest.snapshot, fileClipboard: clipboard }
      }
      if (request.type === 'files.clipboard.read') return { ok: true, snapshot: window.backendTest.snapshot, fileClipboard: clipboard }
      if (request.type === 'files.clipboard.paste') {
        if (!clipboard || request.token !== clipboard.token) return { ok: false, snapshot: window.backendTest.snapshot, error: 'Clipboard changed.' }
        if (clipboard.mode === 'move') clipboard = undefined
        return { ok: true, snapshot: window.backendTest.snapshot, fileTaskIds: ['clipboard-task'] }
      }
      if (request.type === 'files.enqueue') {
        const p = request.plan, state = window.backendTest.snapshot.files!
        state.revision++; state.tasks.push({ id: 'task-' + state.revision, action: p.action, source: p.source, destination: p.destination, status: 'running', createdAt: new Date().toISOString(), items: p.items.map(i => ({ path: i.path, status: 'pending' })), completed: 0, bytes: 0, current: p.items[0].path, pauseRequested: false, stopRequested: false })
        window.backendTest.emit({ type: 'files', state: structuredClone(state) })
      }
      return { ok: true, snapshot: window.backendTest.snapshot }
    }
  })
  await page.getByRole('navigation').getByRole('button', { name: 'Files', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Left file panel', exact: true }).getByText('SD Maid.apk', { exact: true })).toBeVisible()
}
const requests = (page: Page) => page.evaluate(() => window.backendTest.requests.filter(r => r.type.startsWith('files.')))

test('Terminal mode preserves both file panels and keyboard navigation', async ({ page }) => {
  await setup(page)
  await page.getByRole('button', { name: 'Terminal mode', exact: true }).dblclick()
  const left = page.getByRole('region', { name: 'Left file panel', exact: true })
  await left.getByRole('row', { name: 'Notes.txt', exact: true }).click()
  await left.getByRole('row', { name: 'SD Maid.apk', exact: true }).click({ modifiers: ['Shift'] })
  await expect(left.getByRole('row', { selected: true })).toHaveCount(2)
  await expect(left).toHaveCSS('background-color', 'rgb(0, 0, 0)')
  await left.getByRole('region', { name: 'left folder contents', exact: true }).press('Home')
  await expect(left.locator('.fm-parent-entry')).toHaveClass(/cursor/)
  await page.screenshot({ path: 'test-results/terminal-files.png' })
  await page.setViewportSize({ width: 1000, height: 680 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/terminal-files-narrow.png' })
  await page.getByRole('button', { name: 'Terminal mode', exact: true }).dblclick()
  await expect(left.getByRole('row', { name: 'SD Maid.apk', exact: true })).toBeVisible()
})

test('Zen mode keeps the active file panel, selection and keyboard focus visible', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('adb-vault-appearance', JSON.stringify({ state: { themeId: 'vault-blue', zenMode: true }, version: 1 })))
  await setup(page)
  const left = page.getByRole('region', { name: 'Left file panel', exact: true })
  const right = page.getByRole('region', { name: 'Right file panel', exact: true })
  await left.getByRole('row', { name: 'Notes.txt', exact: true }).click()
  await left.getByRole('row', { name: 'SD Maid.apk', exact: true }).click({ modifiers: ['Shift'] })
  await expect(left.getByRole('row', { selected: true })).toHaveCount(2)
  await expect(left).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)')
  await expect(left.locator('.fm-pane-heading')).not.toHaveCSS('box-shadow', 'none')
  await expect(left.getByRole('row', { name: 'Notes.txt', exact: true })).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await right.getByRole('row', { name: 'Manual.pdf', exact: true }).click()
  await expect(right).toHaveClass(/active/)
  await expect(left).not.toHaveClass(/active/)
  await expect(right.locator('.fm-pane-heading')).not.toHaveCSS('box-shadow', 'none')
  await right.getByRole('region', { name: 'right folder contents', exact: true }).press('Home')
  await expect(right.locator('.fm-parent-entry')).toHaveClass(/cursor/)
  await expect(right.locator('.fm-parent-entry')).not.toHaveCSS('box-shadow', 'none')
  await page.screenshot({ path: 'test-results/zen-files.png' })
})

test('Files audit: a pending folder read follows its tab when panels are swapped', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => {
    const original = window.desktop!.request
    window.desktop!.request = async r => {
      const reply = await original(r)
      if (r.type === 'files.list' && r.location.kind === 'local' && reply.ok && reply.fileListing) {
        await new Promise<void>(resolve => window.addEventListener('release-list', () => resolve(), { once: true }))
        reply.fileListing.entries = [{ name: 'Fresh.txt', path: 'C:\\Downloads\\Fresh.txt', kind: 'file', size: 10, modified: 1791442800000, fingerprint: 'fresh' }]
      }
      return reply
    }
  })
  await page.getByRole('button', { name: 'Refresh left panel', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Refresh left panel', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Swap panels', exact: true }).click()
  await page.evaluate(() => window.dispatchEvent(new Event('release-list')))
  const right = page.getByRole('region', { name: 'Right file panel', exact: true })
  await expect(right.getByRole('row', { name: 'Fresh.txt', exact: true })).toBeVisible()
  await expect(right.getByRole('button', { name: 'Refresh right panel', exact: true })).toBeEnabled()
  await expect(page.getByRole('region', { name: 'Left file panel', exact: true }).getByRole('row', { name: 'Manual.pdf', exact: true })).toBeVisible()
})

test('Files audit: hiding files removes invisible operation targets in both tabs of the same folder', async ({ page }) => {
  await setup(page)
  const left = page.getByRole('region', { name: 'Left file panel', exact: true })
  await left.getByRole('button', { name: 'Show hidden files in left panel', exact: true }).click()
  await left.getByRole('row', { name: '.hidden', exact: true }).click()
  await left.getByRole('button', { name: 'New left tab', exact: true }).click()
  await left.getByRole('row', { name: '.hidden', exact: true }).click()
  await left.getByRole('row', { name: 'Notes.txt', exact: true }).click({ modifiers: ['Control'] })
  await left.getByRole('button', { name: 'Show hidden files in left panel', exact: true }).click()
  await expect(left.getByRole('row', { name: '.hidden', exact: true })).toHaveCount(0)
  await expect(left.locator('.fm-pane-footer')).toContainText('1 selected')
  await left.getByRole('region', { name: 'left folder contents', exact: true }).press('Control+c')
  await page.getByRole('region', { name: 'right folder contents', exact: true }).press('Control+v')
  await expect(page.getByRole('dialog')).toContainText('1 object')
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
  await left.getByRole('tab').first().click()
  await expect(left.locator('.fm-pane-footer')).not.toContainText('selected')
  await expect(page.getByRole('button', { name: /^Delete(?:\s|$)/ })).toBeDisabled()
})

test('Files audit: parent keyboard navigation survives a denied folder read', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => {
    const original = window.desktop!.request
    window.desktop!.request = async r => r.type === 'files.list' && r.location.path === 'C:\\Denied'
      ? { ok: false, snapshot: window.backendTest.snapshot, error: 'Access denied.' } : original(r)
  })
  const left = page.getByRole('region', { name: 'Left file panel', exact: true })
  await left.getByRole('button', { name: 'Edit left path', exact: true }).click()
  await left.getByRole('textbox', { name: 'left path', exact: true }).fill('C:\\Denied')
  await left.getByRole('textbox', { name: 'left path', exact: true }).press('Enter')
  await expect(left.getByRole('alert')).toContainText('Access denied')
  await expect(left.getByRole('button', { name: 'Parent folder in left panel', exact: true })).toBeVisible()
  await left.getByRole('region', { name: 'left folder contents', exact: true }).press('ArrowLeft')
  await expect(left.getByRole('alert')).toHaveCount(0)
  expect((await requests(page)).filter(r => r.type === 'files.list').at(-1)).toMatchObject({ location: { path: 'C:\\' } })
})

test('Files audit: an incomplete folder reply stops loading and allows retry', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => {
    const original = window.desktop!.request
    let fail = true
    window.desktop!.request = async r => {
      if (fail && r.type === 'files.list') { fail = false; return { ok: true, snapshot: window.backendTest.snapshot } }
      return original(r)
    }
  })
  const left = page.getByRole('region', { name: 'Left file panel', exact: true }), refresh = left.getByRole('button', { name: 'Refresh left panel', exact: true })
  await refresh.click()
  await expect(left.getByRole('alert')).toContainText('Folder listing unavailable')
  await expect(refresh).toBeEnabled(); await refresh.click()
  await expect(left.getByRole('row', { name: 'Notes.txt', exact: true })).toBeVisible()
  await expect(left.getByRole('alert')).toHaveCount(0)
})

test('Files audit: explicit refresh preserves root and refuses a replacement phone', async ({ page }) => {
  const right = await setupAccessEntries(page)
  await page.evaluate(() => {
    const connection = window.backendTest.snapshot.connection
    connection.devices[0].hardwareId = 'original-phone'
    window.backendTest.emit({ type: 'connection', connection: structuredClone(connection) })
  })
  await right.getByRole('combobox', { name: 'right source', exact: true }).selectOption('phone')
  await right.getByRole('button', { name: 'Use root for this tab (requires granted Shell access)', exact: true }).click()
  await page.evaluate(() => {
    const connection = window.backendTest.snapshot.connection
    connection.devices[0].transportId = '9'
    window.backendTest.emit({ type: 'connection', connection: structuredClone(connection) })
  })
  await right.getByRole('button', { name: 'Refresh right panel', exact: true }).click()
  await expect(right.getByRole('button', { name: 'Root access enabled for this tab', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(right.getByRole('row', { name: 'Private', exact: true }).locator('.fm-access-mark')).toHaveCount(0)
  const reads = async () => (await requests(page)).filter(r => r.type === 'files.list')
  expect((await reads()).at(-1)).toMatchObject({ location: { transportId: '9', hardwareId: 'original-phone', root: true } })
  const count = (await reads()).length
  await page.evaluate(() => {
    const connection = window.backendTest.snapshot.connection
    Object.assign(connection.devices[0], { hardwareId: 'replacement', transportId: '10' })
    window.backendTest.emit({ type: 'connection', connection: structuredClone(connection) })
  })
  await right.getByRole('button', { name: 'Refresh right panel', exact: true }).click()
  await expect(right.getByRole('alert')).toContainText('identity cannot be confirmed')
  expect(await reads()).toHaveLength(count)
})

test('Files audit: refreshing a reconnected category preserves its scope and root access', async ({ page }) => {
  await searchSetup(page)
  await page.evaluate(() => {
    const connection = window.backendTest.snapshot.connection
    Object.assign(connection.devices[0], { hardwareId: 'original-phone', root: { status: 'available', method: 'su', message: 'Granted', checkedAt: null } })
    window.backendTest.emit({ type: 'connection', connection: structuredClone(connection) })
  })
  const right = page.getByRole('region', { name: 'Right file panel', exact: true })
  await right.getByRole('combobox', { name: 'right source', exact: true }).selectOption('phone')
  await right.getByRole('button', { name: 'Use root for this tab (requires granted Shell access)', exact: true }).click()
  await page.getByRole('button', { name: 'Places', exact: true }).click()
  await page.getByRole('navigation', { name: 'File locations', exact: true }).getByRole('button', { name: 'Images', exact: true }).click()
  await right.getByRole('button', { name: 'Stop', exact: true }).click()
  const searches = async () => (await requests(page)).filter(r => r.type === 'files.search')
  const first = (await searches()).at(-1) as Extract<BackendRequest, { type: 'files.search' }>
  await page.evaluate(() => {
    const connection = window.backendTest.snapshot.connection
    connection.devices[0].transportId = '9'
    window.backendTest.emit({ type: 'connection', connection: structuredClone(connection) })
  })
  await right.getByRole('button', { name: 'Refresh right panel', exact: true }).click()
  await expect(right.getByRole('tab', { name: 'Images', exact: true })).toBeVisible()
  await expect.poll(async () => (await searches()).length).toBe(2)
  expect((await searches()).at(-1)).toMatchObject({ location: { ...first.location, root: true, transportId: '9' }, query: first.query })
})

for (const fail of [false, true]) test(`Files audit: a late ${fail ? 'error' : 'reply'} cannot replace a newer folder`, async ({ page }) => {
  await setup(page)
  await page.evaluate(fail => {
    const original = window.desktop!.request
    window.desktop!.request = async r => {
      const reply = await original(r)
      if (r.type === 'files.list' && r.location.path === 'C:\\Downloads') {
        await new Promise<void>(resolve => window.addEventListener('release-old-read', () => resolve(), { once: true }))
        if (fail) return { ok: false, snapshot: window.backendTest.snapshot, error: 'Old request failed' }
        if (reply.ok && reply.fileListing) reply.fileListing.entries = []
      }
      return reply
    }
  }, fail)
  const left = page.getByRole('region', { name: 'Left file panel', exact: true })
  await left.getByRole('button', { name: 'Refresh left panel', exact: true }).click()
  await expect(left.getByRole('button', { name: 'Refresh left panel', exact: true })).toBeDisabled()
  await left.getByRole('row', { name: 'Photos', exact: true }).dblclick()
  await expect(left.getByRole('tab', { name: 'Photos', exact: true })).toBeVisible()
  await page.evaluate(async () => { window.dispatchEvent(new Event('release-old-read')); await new Promise(resolve => setTimeout(resolve, 0)) })
  await expect(left.getByRole('row', { name: 'Notes.txt', exact: true })).toBeVisible()
  await expect(left.getByRole('tab', { name: 'Photos', exact: true })).toBeVisible()
  await expect(left.getByRole('alert')).toHaveCount(0)
})

test('Files audit: a category error follows its tab after swapping panels', async ({ page }) => {
  await searchSetup(page)
  await page.evaluate(() => {
    const original = window.desktop!.request
    window.desktop!.request = async r => {
      if (r.type === 'files.search') {
        await new Promise<void>(resolve => window.addEventListener('release-search', () => resolve(), { once: true }))
        return { ok: false, snapshot: window.backendTest.snapshot, error: 'Folder search unavailable.' }
      }
      return original(r)
    }
  })
  await page.getByRole('region', { name: 'Right file panel', exact: true }).getByRole('searchbox').focus()
  await page.getByRole('button', { name: 'Places', exact: true }).click()
  await page.getByRole('navigation', { name: 'File locations', exact: true }).getByRole('button', { name: 'Images', exact: true }).click()
  await page.getByRole('button', { name: 'Swap panels', exact: true }).click()
  await page.evaluate(() => window.dispatchEvent(new Event('release-search')))
  const left = page.getByRole('region', { name: 'Left file panel', exact: true })
  await expect(left.getByRole('alert')).toContainText('Folder search unavailable')
  await expect(left.getByRole('button', { name: 'Refresh left panel', exact: true })).toBeEnabled()
  await expect(page.getByRole('region', { name: 'Right file panel', exact: true }).getByRole('row', { name: 'Notes.txt', exact: true })).toBeVisible()
})

test('Files audit: root can be switched off after its grant is lost', async ({ page }) => {
  const right = await setupAccessEntries(page)
  await right.getByRole('button', { name: 'Use root for this tab (requires granted Shell access)', exact: true }).click()
  await page.evaluate(() => {
    const connection = window.backendTest.snapshot.connection
    connection.devices[0].root = { status: 'denied', message: 'Not granted', checkedAt: null }
    window.backendTest.emit({ type: 'connection', connection: structuredClone(connection) })
    const original = window.desktop!.request
    window.desktop!.request = async r => r.type === 'files.list' && r.location.root
      ? { ok: false, snapshot: window.backendTest.snapshot, error: 'Root is no longer available.' } : original(r)
  })
  await right.getByRole('button', { name: 'Refresh right panel', exact: true }).click()
  await expect(right.getByRole('alert')).toContainText('Root is no longer available')
  await right.getByRole('button', { name: 'Root access enabled for this tab', exact: true }).click()
  await expect(right.getByRole('alert')).toHaveCount(0)
  await expect(right.getByRole('row', { name: 'Public', exact: true })).toBeVisible()
  await expect(right.getByRole('button', { name: 'Use root for this tab (requires granted Shell access)', exact: true })).toBeDisabled()
  expect((await requests(page)).filter(r => r.type === 'files.list').at(-1)).toMatchObject({ location: { root: false } })
})

async function setupAccessEntries(page: Page) {
  await setup(page)
  await page.evaluate(() => {
    const connection = window.backendTest.snapshot.connection
    connection.devices[0].root = { status: 'available', method: 'su', message: 'Granted', checkedAt: null }
    window.backendTest.emit({ type: 'connection', connection: structuredClone(connection) })
    const original = window.desktop!.request
    window.desktop!.request = async r => {
      const entries = [
        { name: 'Public', path: '/sdcard/Public', kind: 'directory' as const, size: 0, modified: 1791442800000, mode: '755', fingerprint: 'public' },
        { name: 'Private', path: '/sdcard/Private', kind: 'directory' as const, size: 0, modified: 1791442800000, mode: '700', fingerprint: 'private', ...('location' in r && r.location.root ? {} : { access: 'restricted' as const }) },
        { name: 'Opaque', path: '/sdcard/Opaque', kind: 'other' as const, size: 0, modified: 0, fingerprint: '', access: 'restricted' as const },
        { name: 'Readme.txt', path: '/sdcard/Readme.txt', kind: 'file' as const, size: 123, modified: 1791442800000, mode: '644', fingerprint: 'readme' },
      ]
      if (r.type === 'files.properties') { window.backendTest.requests.push(r); return { ok: true, snapshot: window.backendTest.snapshot, fileProperties: { entry: entries.find(e => e.path === r.location.path)! } } }
      const reply = await original(r)
      if (r.type === 'files.list' && r.location.kind === 'device' && reply.ok && reply.fileListing) reply.fileListing.entries = entries
      return reply
    }
  })
  await page.getByRole('button', { name: 'Refresh right panel', exact: true }).click()
  return page.getByRole('region', { name: 'Right file panel', exact: true })
}

test('restricted phone entries remain visible with locks and unknown metadata; root refresh uses actual access', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 740 })
  const panel = await setupAccessEntries(page)
  const opaque = panel.getByRole('row', { name: 'Opaque', exact: true })
  await expect(opaque).toContainText('Unknown'); await expect(opaque).toContainText('—')
  await expect(opaque).not.toContainText('1970')
  await expect(panel.getByRole('row', { name: 'Public', exact: true }).locator('.fm-access-mark')).toHaveCount(0)
  await expect(opaque.locator('.fm-access-mark')).toHaveAccessibleName(/type, size and contents are unknown.*Root may help/)
  await panel.getByRole('row', { name: 'Private', exact: true }).dblclick()
  await expect(page.getByRole('status')).toContainText('Root may help')
  await opaque.click(); await page.getByRole('button', { name: /^Copy(?:\s|$)/ }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect((await requests(page)).some(r => r.type === 'files.enqueue')).toBe(false)
  for (const view of ['minimal', 'grid', 'detailed']) {
    await panel.getByRole('combobox', { name: 'right file view', exact: true }).selectOption(view)
    await expect(panel.locator('.fm-access-mark')).toHaveCount(2)
  }
  await page.screenshot({ path: 'test-results/files-access-locks.png' })
  await panel.getByRole('button', { name: 'Use root for this tab (requires granted Shell access)', exact: true }).click()
  await expect(panel.getByRole('row', { name: 'Private', exact: true }).locator('.fm-access-mark')).toHaveCount(0)
  await expect(opaque.locator('.fm-access-mark')).toHaveAccessibleName(/restricted even with root enabled/)
  await expect(panel.locator('.fm-access-mark')).toHaveCount(1)
})

test('Permissions explains owner group and others live, preserves chosen digits, and properties have a tooltip', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 })
  const panel = await setupAccessEntries(page)
  await panel.getByRole('row', { name: 'Readme.txt', exact: true }).click({ button: 'right' })
  await panel.getByRole('button', { name: 'Permissions…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Change permissions', exact: true }), mode = dialog.getByRole('textbox', { name: 'Permissions', exact: true })
  await expect(mode).toHaveValue('644')
  await expect(mode).toHaveAttribute('title', /Owner \(6\): Read · Write\nGroup \(4\): Read\nOthers \(4\): Read/)
  const meaning = dialog.getByLabel('Permission meaning')
  await expect(meaning).toContainText('Owner 6Read · Write')
  await mode.fill('755'); await expect(meaning).toContainText('Group 5Read · Execute')
  await mode.fill('000'); await expect(meaning).toContainText('No permissions')
  await mode.fill('888'); await expect(dialog.getByRole('button', { name: 'Change permissions', exact: true })).toBeDisabled()
  await mode.fill('640'); await dialog.getByRole('button', { name: 'Change permissions', exact: true }).click()
  const change = (await requests(page)).find((r): r is Extract<BackendRequest, { type: 'files.enqueue' }> => r.type === 'files.enqueue')!
  expect(change.plan).toMatchObject({ action: 'chmod', mode: '640', items: [{ path: '/sdcard/Readme.txt', fingerprint: 'readme' }] })
  await panel.getByRole('row', { name: 'Public', exact: true }).click({ button: 'right' })
  await panel.getByRole('button', { name: 'Permissions…', exact: true }).click()
  await expect(mode).toHaveValue('755')
  await expect(meaning).toContainText('List names · Enter/traverse')
  await page.screenshot({ path: 'test-results/files-permissions-help.png' })
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await panel.getByRole('row', { name: 'Public', exact: true }).click({ button: 'right' })
  await panel.getByRole('button', { name: 'Properties', exact: true }).click()
  const properties = page.getByRole('dialog', { name: 'Properties', exact: true })
  await expect(properties.locator('.file-permissions-value')).toHaveAttribute('title', /Owner \(7\): List names · Create\/remove entries · Enter\/traverse/)
})

test('folder bookmarks toggle in root mode and reconnect using the same phone identity', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => {
    const connection = window.backendTest.snapshot.connection
    connection.devices[0].hardwareId = 'physical-phone'
    connection.devices[0].root = { status: 'available', message: 'Granted', checkedAt: null }
    window.backendTest.emit({ type: 'connection', connection: structuredClone(connection) })
  })
  const right = page.getByRole('region', { name: 'Right file panel', exact: true })
  await right.getByRole('button', { name: 'Use root for this tab (requires granted Shell access)', exact: true }).click()
  await right.getByRole('button', { name: 'Bookmark this folder', exact: true }).click()
  await right.getByRole('button', { name: 'Remove folder bookmark', exact: true }).click()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('adb-vault-files')!).state.bookmarks)).toHaveLength(0)
  await right.getByRole('button', { name: 'Bookmark this folder', exact: true }).click()
  const bookmark = await page.evaluate(() => JSON.parse(localStorage.getItem('adb-vault-files')!).state.bookmarks[0])
  expect(bookmark.location).toMatchObject({ root: false, hardwareId: 'physical-phone' }); expect(bookmark.location.transportId).toBeUndefined()
  await page.evaluate(() => {
    const connection = window.backendTest.snapshot.connection
    Object.assign(connection.devices[0], { id: 'new-wifi', serial: '192.168.1.7:5555', transportId: '19', aliases: ['PHONE'] })
    connection.activeDeviceId = 'new-wifi'
    window.backendTest.emit({ type: 'connection', connection: structuredClone(connection) })
  })
  await page.getByRole('button', { name: 'Places', exact: true }).click()
  const favorites = page.getByRole('navigation', { name: 'File locations' }).locator('.fm-favorite')
  await favorites.getByRole('button', { name: 'sdcard', exact: true }).click()
  const last = (await requests(page)).filter(r => r.type === 'files.list').at(-1) as Extract<BackendRequest, { type: 'files.list' }>
  expect(last.location).toMatchObject({ id: 'new-wifi', serial: '192.168.1.7:5555', transportId: '19', root: false })
  await right.getByRole('button', { name: 'Remove folder bookmark', exact: true }).click()
  await expect(favorites).toHaveCount(0)
})

test('categories open in the active panel, stop cleanly and do not rescan on workspace changes', async ({ page }) => {
  await searchSetup(page)
  await page.getByRole('button', { name: 'Places', exact: true }).click()
  const places = page.getByRole('navigation', { name: 'File locations' }), left = page.getByRole('region', { name: 'Left file panel', exact: true }), right = page.getByRole('region', { name: 'Right file panel', exact: true })
  await left.getByRole('searchbox').focus()
  for (const category of ['Images', 'Videos', 'Audio', 'Documents', 'Archives']) {
    await places.getByRole('button', { name: category, exact: true }).click()
    await expect(left.getByRole('tab', { name: category, exact: true })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(right.getByRole('row', { name: 'Manual.pdf', exact: true })).toBeVisible()
    const last = (await requests(page)).filter(r => r.type === 'files.search').at(-1) as Extract<BackendRequest, { type: 'files.search' }>
    expect(last.location.path).toBe('C:\\Downloads'); expect(last.query).toMatchObject({ recursive: true, kind: 'file', archives: false })
    await expect(page.getByRole('button', { name: /New folder.*F7/ })).toBeDisabled()
    await left.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect(left).toContainText('Results are incomplete.')
  }
  const count = (await requests(page)).filter(r => r.type === 'files.search').length
  await page.getByRole('navigation').getByRole('button', { name: 'Components', exact: true }).click()
  await page.getByRole('navigation').getByRole('button', { name: 'Files', exact: true }).click()
  expect((await requests(page)).filter(r => r.type === 'files.search')).toHaveLength(count)
})

test('category settings persist visibility and per-location rules with optional service folders off by default', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 740 }); await searchSetup(page)
  await page.getByRole('button', { name: 'Places', exact: true }).click()
  await page.getByRole('button', { name: 'Category settings', exact: true }).click()
  const settings = page.getByRole('region', { name: 'Categories', exact: true })
  await expect(page.getByText('FILES / CATEGORIES', { exact: true })).toBeVisible()
  for (const name of ['Icon files', 'Icon folders', 'Cache folders', 'Thumbnail folders']) await expect(settings.getByRole('checkbox', { name, exact: false })).not.toBeChecked()
  await settings.getByRole('checkbox', { name: 'Archives', exact: true }).uncheck()
  await settings.getByRole('checkbox', { name: /^Icon folders/ }).check()
  await settings.getByRole('textbox', { name: 'Search only these folders' }).fill('Photos\nPictures')
  await settings.getByRole('textbox', { name: 'Skip these folders' }).fill('Photos/Private')
  await settings.getByRole('button', { name: 'Save folders', exact: true }).click()
  await expect(settings.getByRole('status')).toContainText('Folders saved')
  await page.screenshot({ path: 'test-results/files-category-settings.png' })
  expect(await settings.evaluate(e => e.scrollWidth > e.clientWidth)).toBe(false)
  await page.getByRole('navigation').getByRole('button', { name: 'Files', exact: true }).click()
  const places = page.getByRole('navigation', { name: 'File locations' })
  await expect(places.getByRole('button', { name: 'Archives', exact: true })).toHaveCount(0)
  await places.getByRole('button', { name: 'Images', exact: true }).click()
  const query = (await requests(page)).filter(r => r.type === 'files.search').at(-1) as Extract<BackendRequest, { type: 'files.search' }>
  expect(query.query.folders).toEqual({ include: ['Photos', 'Pictures'], exclude: ['Photos/Private'], skipNames: ['cache', '.cache', 'thumbnails', '.thumbnails'] })
  await page.getByRole('button', { name: 'Category settings', exact: true }).click()
  await settings.getByRole('combobox', { name: 'Category search location', exact: true }).selectOption({ label: 'Redmi Note 4 · /storage/emulated/0' })
  await expect(settings.getByRole('textbox', { name: 'Search only these folders' })).toHaveValue('')
  await settings.getByRole('textbox', { name: 'Search only these folders' }).fill('../private')
  await settings.getByRole('button', { name: 'Save folders', exact: true }).click()
  await expect(settings.getByRole('alert')).toBeVisible()
  await page.reload()
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('group', { name: 'Settings categories' }).getByRole('button', { name: 'Files', exact: true }).click()
  await expect(settings.getByRole('checkbox', { name: 'Archives', exact: true })).not.toBeChecked()
  await expect(settings.getByRole('checkbox', { name: /^Icon folders/ })).toBeChecked()
  await settings.getByRole('combobox', { name: 'Category search location', exact: true }).selectOption({ label: 'This PC / SMB · C:\\Downloads' })
  await expect(settings.getByRole('textbox', { name: 'Search only these folders' })).toHaveValue('Photos\nPictures')
})

test('returning to a category reuses session results and Refresh or changed rules starts a new search', async ({ page }) => {
  await searchSetup(page); await page.getByRole('button', { name: 'Places', exact: true }).click()
  const places = page.getByRole('navigation', { name: 'File locations' }), left = page.getByRole('region', { name: 'Left file panel', exact: true })
  await places.getByRole('button', { name: 'Images', exact: true }).click()
  await page.evaluate(() => {
    const state = window.backendTest.snapshot.fileSearch!
    Object.assign(state, { status: 'complete', revision: state.revision + 1, matched: 1, message: '1 file found', results: [{ entry: { name: 'a.jpg', path: 'C:\\Downloads\\Photos\\a.jpg', kind: 'file', size: 10, modified: 1, fingerprint: 'a' } }] })
    window.backendTest.emit({ type: 'fileSearch', state: structuredClone(state) })
  })
  await left.getByRole('button', { name: 'Open folder', exact: true }).click()
  await places.getByRole('button', { name: 'Images', exact: true }).click()
  await expect(left).toContainText('Saved results · 1 file found')
  expect((await requests(page)).filter(r => r.type === 'files.search')).toHaveLength(1)
  await left.getByRole('button', { name: 'Refresh left panel', exact: true }).click()
  expect((await requests(page)).filter(r => r.type === 'files.search')).toHaveLength(2)
  await left.getByRole('button', { name: 'Stop', exact: true }).click()
  await places.getByRole('button', { name: 'Videos', exact: true }).click()
  await left.getByRole('button', { name: 'Stop', exact: true }).click()
  await places.getByRole('button', { name: 'Images', exact: true }).click()
  await expect(left).toContainText('Results are incomplete.')
  expect((await requests(page)).filter(r => r.type === 'files.search')).toHaveLength(3)
  await page.getByRole('button', { name: 'Category settings', exact: true }).click()
  await page.getByRole('checkbox', { name: /^Icon files/ }).check()
  await page.getByRole('navigation').getByRole('button', { name: 'Files', exact: true }).click()
  await places.getByRole('button', { name: 'Images', exact: true }).click()
  expect((await requests(page)).filter(r => r.type === 'files.search')).toHaveLength(4)
})

test('folder menus add rules for the selected category and support several phone folders without file operations', async ({ page }) => {
  await searchSetup(page)
  const left = page.getByRole('region', { name: 'Left file panel', exact: true }), right = page.getByRole('region', { name: 'Right file panel', exact: true })
  await left.getByRole('row', { name: 'Photos', exact: true }).click({ button: 'right' })
  await left.getByRole('button', { name: 'Add to Skip these folders', exact: true }).click()
  const saved = () => page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('adb-vault-file-categories')!).state.scopes) as { location: { path: string }; rules: Record<string, { include: string[]; exclude: string[] }> }[])
  expect((await saved()).find(s => s.location.path === 'C:\\Downloads')?.rules.images).toEqual({ include: [], exclude: ['Photos'] })
  await left.getByRole('row', { name: 'Photos', exact: true }).click({ button: 'right' })
  await left.getByRole('button', { name: 'Add to Skip these folders', exact: true }).click()
  expect((await saved()).find(s => s.location.path === 'C:\\Downloads')?.rules.images.exclude).toEqual(['Photos'])
  await right.getByRole('row', { name: 'Download', exact: true }).click()
  await right.getByRole('row', { name: 'DCIM', exact: true }).click({ modifiers: ['Control'] })
  await right.getByRole('row', { name: 'DCIM', exact: true }).click({ button: 'right' })
  await right.getByRole('combobox', { name: 'Folder rule category', exact: true }).selectOption('audio')
  await right.getByRole('button', { name: 'Add to Search only these folders', exact: true }).click()
  expect((await saved()).find(s => s.location.path === '/storage/emulated/0')?.rules.audio.include.sort()).toEqual(['DCIM', 'Download'])
  expect((await requests(page)).some(r => r.type === 'files.enqueue' || r.type === 'files.search')).toBe(false)
  await left.getByRole('row', { name: 'Notes.txt', exact: true }).click({ button: 'right' })
  await expect(left.getByRole('group', { name: 'Category folder rules', exact: true })).toHaveCount(0)
  await left.getByRole('button', { name: 'Close menu', exact: true }).click()
  await page.getByRole('button', { name: 'Places', exact: true }).click()
  await page.getByRole('navigation', { name: 'File locations' }).getByRole('button', { name: 'Images', exact: true }).click()
  const search = (await requests(page)).find(r => r.type === 'files.search') as Extract<BackendRequest, { type: 'files.search' }>
  expect(search.query.folders?.exclude).toEqual(['Photos'])
  await left.getByRole('button', { name: 'Stop', exact: true }).click()
  await page.getByRole('button', { name: 'Category settings', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Skip these folders', exact: true })).toHaveValue('Photos')
})

test('album folder menus save to the current category and the next scan uses its exclusions', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 740 }); await searchSetup(page)
  const right = page.getByRole('region', { name: 'Right file panel', exact: true })
  await right.getByRole('searchbox').focus()
  await page.getByRole('button', { name: 'Places', exact: true }).click()
  const places = page.getByRole('navigation', { name: 'File locations' })
  await places.getByRole('button', { name: 'Images', exact: true }).click()
  await page.evaluate(() => {
    const state = window.backendTest.snapshot.fileSearch!
    Object.assign(state, { status: 'complete', revision: state.revision + 1, canonicalLocation: { ...state.location, path: '/storage/emulated/0' }, matched: 2, message: '2 files found', results: ['DCIM/Camera/a.jpg', 'Pictures/b.jpg'].map(path => ({ entry: { path: '/storage/emulated/0/' + path, name: path.split('/').at(-1), kind: 'file', size: 100, modified: 1, fingerprint: path } })) })
    window.backendTest.emit({ type: 'fileSearch', state: structuredClone(state) })
  })
  await right.getByRole('option', { name: 'Camera', exact: true }).click({ button: 'right' })
  const rules = right.getByRole('group', { name: 'Category folder rules', exact: true })
  await expect(rules).toContainText('Images'); await expect(rules.getByRole('combobox')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/files-album-folder-rules.png' })
  expect(await rules.evaluate(e => e.scrollWidth > e.clientWidth)).toBe(false)
  await rules.getByRole('button', { name: 'Add to Skip these folders', exact: true }).click()
  await expect(right.getByRole('option', { name: 'Camera', exact: true })).toBeVisible()
  expect((await requests(page)).filter(r => r.type === 'files.search')).toHaveLength(1)
  await places.getByRole('button', { name: 'Images', exact: true }).click()
  const searches = (await requests(page)).filter(r => r.type === 'files.search') as Extract<BackendRequest, { type: 'files.search' }>[]
  expect(searches).toHaveLength(2); expect(searches[1].query.folders?.exclude).toEqual(['DCIM/Camera'])
})

test('search status position stays fixed for short and very long current paths without a fake progress bar', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 740 }); await searchSetup(page)
  await page.getByRole('button', { name: 'Places', exact: true }).click()
  await page.getByRole('navigation', { name: 'File locations' }).getByRole('button', { name: 'Images', exact: true }).click()
  const progress = page.getByLabel('Workspace operations').locator('.lattice-loader')
  await expect(page.getByLabel('Workspace operations').getByRole('progressbar')).toHaveCount(0)
  async function current(path: string) {
    await page.evaluate(path => { const state = window.backendTest.snapshot.fileSearch!; state.current = path; state.revision++; window.backendTest.emit({ type: 'fileSearch', state: structuredClone(state) }) }, path)
    await expect(page.getByRole('button', { name: 'Searching files', exact: true })).toContainText(path)
    return (await progress.boundingBox())!
  }
  const short = await current('a.jpg'), long = await current('C:\\Photos\\' + 'a-long-folder-name\\'.repeat(30) + 'photo.jpg')
  expect(Math.abs(short.x - long.x)).toBeLessThan(1); expect(Math.abs(short.width - long.width)).toBeLessThan(1)
  expect(Math.abs(short.y - long.y)).toBeLessThan(1)
  await page.screenshot({ path: 'test-results/files-search-stable-progress.png' })
})

test('phone category scope follows SD storage and canonical results copy and reveal their actual folder', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 740 })
  await searchSetup(page)
  const right = page.getByRole('region', { name: 'Right file panel', exact: true })
  await right.getByRole('combobox', { name: 'right storage', exact: true }).selectOption('/storage/1234-5678')
  await page.getByRole('button', { name: 'Places', exact: true }).click()
  const places = page.getByRole('navigation', { name: 'File locations' })
  await places.getByRole('button', { name: 'Images', exact: true }).click()
  const request = (await requests(page)).find(r => r.type === 'files.search') as Extract<BackendRequest, { type: 'files.search' }>
  expect(request.location.path).toBe('/storage/1234-5678')
  await right.getByRole('button', { name: 'Stop', exact: true }).click()
  await right.getByRole('button', { name: 'Open folder', exact: true }).click()
  await right.getByRole('combobox', { name: 'right storage', exact: true }).selectOption('/storage/emulated/0')
  await places.getByRole('button', { name: 'Documents', exact: true }).click()
  await page.evaluate(() => {
    const state = window.backendTest.snapshot.fileSearch!
    Object.assign(state, { status: 'complete', revision: state.revision + 1, scanned: 12, matched: 1, message: '1 file found', canonicalLocation: { ...state.location, path: '/storage/emulated/0' }, results: [{ entry: { name: 'Manual.pdf', path: '/storage/emulated/0/Documents/Manual.pdf', kind: 'file', size: 100, modified: 1791442800000, fingerprint: 'fingerprint-Manual.pdf' } }] })
    window.backendTest.emit({ type: 'fileSearch', state: structuredClone(state) })
  })
  await right.getByRole('row', { name: 'Manual.pdf', exact: true }).click()
  expect(await right.evaluate(e => e.scrollWidth > e.clientWidth)).toBe(false)
  await page.screenshot({ path: 'test-results/files-category.png' })
  await page.getByRole('region', { name: 'right folder contents', exact: true }).press('F5')
  const dialog = page.getByRole('dialog', { name: 'Copy · 1 object' })
  await expect(dialog).toContainText('/storage/emulated/0')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await right.getByRole('row', { name: 'Manual.pdf', exact: true }).click({ button: 'right' })
  await right.getByRole('button', { name: 'Show in folder', exact: true }).click()
  await expect(right.getByRole('row', { name: 'Manual.pdf', exact: true })).toHaveAttribute('aria-selected', 'true')
  const latest = (await requests(page)).filter(r => r.type === 'files.list').at(-1) as Extract<BackendRequest, { type: 'files.list' }>
  expect(latest.location.path).toBe('/storage/emulated/0/Documents')
})

async function networkScanSetup(page: Page, hold = false) {
  await setup(page)
  await page.evaluate(hold => {
    const original = window.desktop!.request
    let finish: (() => void) | undefined
    window.desktop!.request = async request => {
      if (request.type === 'files.network.scan') {
        window.backendTest.requests.push(request)
        if (hold) await new Promise<void>(resolve => { finish = resolve })
        return { ok: true, snapshot: window.backendTest.snapshot, networkScan: { ranges: ['192.168.1.0/24'], hosts: [{ address: '192.168.1.5', shares: [{ name: 'Media', path: '\\\\192.168.1.5\\Media' }, { name: 'Documents', path: '\\\\192.168.1.5\\Documents' }] }, { address: '192.168.1.6', shares: [], error: 'Windows denied access to the shared folder list.' }], checked: 254, total: 254, cancelled: hold, warnings: hold ? ['Search stopped. Results may be incomplete.'] : [] } }
      }
      if (request.type === 'files.network.scan.cancel') { window.backendTest.requests.push(request); finish?.(); return { ok: true, snapshot: window.backendTest.snapshot } }
      return original(request)
    }
  }, hold)
  await page.getByRole('button', { name: 'Places', exact: true }).click()
}

test('network search starts on click and saves only selected shared folders without requesting credentials', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 740 }); await networkScanSetup(page)
  expect((await requests(page)).filter(r => r.type === 'files.network.scan')).toHaveLength(0)
  await page.getByRole('button', { name: 'Search network…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Search network', exact: true })
  await expect(dialog).toContainText('2 SMB devices · 2 shared folders')
  await expect(dialog).toContainText('Windows denied access')
  await dialog.getByRole('checkbox', { name: /Media/ }).check()
  expect(await dialog.evaluate(e => e.scrollWidth > e.clientWidth)).toBe(false)
  await page.screenshot({ path: 'test-results/files-network-discovery.png' })
  await dialog.getByRole('button', { name: 'Save selected (1)', exact: true }).click()
  const networks = await page.evaluate(() => JSON.parse(localStorage.getItem('adb-vault-files')!).state.networks)
  expect(networks).toEqual([{ name: 'Media · 192.168.1.5', path: '\\\\192.168.1.5\\Media' }])
  expect((await requests(page)).filter(r => r.type === 'files.network.scan')).toHaveLength(1)
  expect((await requests(page)).filter(r => r.type === 'files.network.connect')).toHaveLength(0)
  await page.getByRole('button', { name: 'Search network…', exact: true }).click()
  await expect(dialog.getByRole('checkbox', { name: /Media/ })).toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: /Media/ })).toBeDisabled()
  await dialog.getByRole('region', { name: 'SMB device 192.168.1.6' }).getByRole('button', { name: 'Enter folder…' }).click()
  await expect(page.getByRole('textbox', { name: 'Network folder', exact: true })).toHaveValue('\\\\192.168.1.6\\')
})

test('closing the network search stops only its own scan', async ({ page }) => {
  await networkScanSetup(page, true)
  await page.getByRole('button', { name: 'Search network…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Search network', exact: true })
  await expect(dialog).toContainText('Scanning local network')
  await expect.poll(async () => (await requests(page)).some(r => r.type === 'files.network.scan')).toBe(true)
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const all = await requests(page), scan = all.find(r => r.type === 'files.network.scan') as Extract<BackendRequest, { type: 'files.network.scan' | 'files.network.scan.cancel' }>
  expect(all).toContainEqual({ type: 'files.network.scan.cancel', requestId: scan.requestId })
})

test('saved SMB folders open directly, retain the Windows address and show setup only on failure', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => {
    const original = window.desktop!.request
    window.desktop!.request = async r => {
      const reply = await original(r)
      if (r.type === 'files.network.connect' && reply.ok) reply.folder = '\\\\NAS\\Media'
      return reply
    }
  })
  const left = page.getByRole('region', { name: 'Left file panel', exact: true })
  await left.getByRole('combobox', { name: 'left source', exact: true }).selectOption('network-add')
  const dialog = page.getByRole('dialog', { name: 'SMB / Samba folder', exact: true })
  await dialog.getByRole('textbox', { name: 'Network folder', exact: true }).fill('\\\\192.168.1.1\\Media')
  await dialog.getByRole('button', { name: 'Open folder', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('adb-vault-files')!).state.networks)).toEqual([{ name: 'Media · NAS', path: '\\\\NAS\\Media' }])
  await page.getByRole('button', { name: 'Places', exact: true }).click()
  await left.getByRole('combobox', { name: 'left source', exact: true }).selectOption('local')
  await page.getByRole('button', { name: 'Media · NAS', exact: true }).click()
  await expect(left.getByRole('combobox', { name: 'left source', exact: true })).toHaveValue('network-current')
  await expect(dialog).toHaveCount(0)
  expect((await requests(page)).filter(r => r.type === 'files.network.connect').at(-1)).toEqual({ type: 'files.network.connect', address: '\\\\NAS\\Media', prompt: false })
  await page.evaluate(() => {
    const original = window.desktop!.request
    window.desktop!.request = async r => r.type === 'files.network.connect' ? { ok: false, snapshot: window.backendTest.snapshot, error: 'Windows denied access to this folder.' } : original(r)
  })
  await page.getByRole('button', { name: 'Media · NAS', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Windows denied access')
  await expect(dialog.getByRole('checkbox', { name: 'Ask Windows for credentials', exact: true })).not.toBeChecked()
  await expect(dialog.getByRole('textbox', { name: 'Network folder', exact: true })).toHaveValue('\\\\NAS\\Media')
})

test('all seven file views expose complete sorting, preserve folders first and remember each folder', async ({ page }) => {
  test.setTimeout(60000)
  await setup(page)
  const left = page.getByRole('region', { name: 'Left file panel', exact: true })
  for (const view of ['compact', 'columned', 'detailed', 'wrapped', 'minimal', 'grid', 'gallery']) {
    await left.getByRole('combobox', { name: 'left file view' }).selectOption(view)
    for (const field of ['Name', 'Size', 'Type', 'Date modified']) {
      await left.getByRole('button', { name: 'Sort left files', exact: true }).click()
      const menu = left.getByRole('menu', { name: 'Sort left files' })
      await menu.getByRole('menuitemradio', { name: field, exact: true }).click()
      await left.getByRole('button', { name: 'Sort left files', exact: true }).click()
      await expect(menu.getByRole('menuitemradio', { name: field, exact: true })).toHaveAttribute('aria-checked', 'true')
      await menu.getByRole('menuitemradio', { name: 'Descending' }).click()
      const names = await left.locator('tr[aria-label], .fm-tile').evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-label')))
      expect(names[0]).toBe('Photos')
      if (field === 'Size') expect(names).toEqual(['Photos', 'Notes.txt', 'SD Maid.apk'])
    }
  }
  await left.getByText('Photos', { exact: true }).dblclick()
  await expect(left.getByRole('combobox', { name: 'left file view' })).toHaveValue('detailed')
  await left.getByRole('button', { name: 'Parent folder in left panel' }).click()
  await expect(left.getByRole('combobox', { name: 'left file view' })).toHaveValue('gallery')
  await left.getByRole('button', { name: 'Sort left files', exact: true }).click()
  await expect(left.getByRole('menuitemradio', { name: 'Date modified' })).toHaveAttribute('aria-checked', 'true')
  await expect(left.getByRole('menuitemradio', { name: 'Descending' })).toHaveAttribute('aria-checked', 'true')
  await left.getByRole('menuitemradio', { name: 'Descending' }).press('Escape')
  await expect(left.getByRole('button', { name: 'Sort left files', exact: true })).toBeFocused()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('adb-vault-files')!).state.views)
  expect(saved['local::C:\\Downloads']).toMatchObject({ view: 'gallery', sort: 'modified', descending: true })
})

test('sort headers and keyboard menu stay in sync and fit a narrow panel', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 740 }); await setup(page)
  await page.getByRole('button', { name: 'Places', exact: true }).click()
  const left = page.getByRole('region', { name: 'Left file panel', exact: true })
  await left.getByRole('columnheader').getByRole('button', { name: 'Size' }).click()
  await left.getByRole('button', { name: 'Sort left files', exact: true }).click()
  await expect(left.getByRole('menuitemradio', { name: 'Size', exact: true })).toBeFocused()
  await left.getByRole('menuitemradio', { name: 'Size', exact: true }).press('End')
  await left.getByRole('menuitemradio', { name: 'Descending' }).press('Enter')
  await expect(left.getByRole('columnheader').filter({ hasText: 'Size' })).toHaveAttribute('aria-sort', 'descending')
  await left.getByRole('combobox', { name: 'left file view' }).selectOption('grid')
  await left.getByRole('button', { name: 'Sort left files', exact: true }).click()
  const bounds = await left.getByRole('menu').boundingBox(), pane = await left.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(pane!.x)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(pane!.x + pane!.width)
  for (const node of await page.locator('.fm-pane, .fm-workspace').all()) expect(await node.evaluate(e => e.scrollWidth > e.clientWidth)).toBe(false)
  await page.screenshot({ path: 'test-results/files-sort-menu.png' })
})

async function imageFixture(page: Page, slow = false) {
  await page.evaluate(slow => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 320; canvas.getContext('2d')!.fillRect(0, 0, 640, 320)
    const preview = canvas.toDataURL('image/png')
    const original = window.desktop!.request, pending = new Map<string, () => void>()
    window.desktop!.request = async request => {
      if (request.type === 'files.thumbnail.cancel') {
        window.backendTest.requests.push(request); pending.get(request.requestId)?.(); pending.delete(request.requestId)
        return { ok: true, snapshot: window.backendTest.snapshot }
      }
      if (request.type === 'files.thumbnail') {
        window.backendTest.requests.push(request)
        if (slow) await new Promise<void>(resolve => pending.set(request.requestId, resolve))
        return { ok: true, snapshot: window.backendTest.snapshot, thumbnail: preview }
      }
      const response = await original(request)
      if (request.type === 'files.list' && response.ok && response.fileListing) {
        const path = response.fileListing.location.path, sep = request.location.kind === 'device' ? '/' : '\\'
        response.fileListing.entries = Array.from({ length: 100 }, (_, i) => ({ name: `Photo${i}.png`, path: path + sep + `Photo${i}.png`, kind: 'file', size: 300, modified: 1, fingerprint: `photo-${i}` }))
        response.fileListing.entries.push({ name: 'large.png', path: path + sep + 'large.png', kind: 'file', size: 40_000_000, modified: 1, fingerprint: 'large' }, { name: 'document.pdf', path: path + sep + 'document.pdf', kind: 'file', size: 500, modified: 1, fingerprint: 'pdf' })
      }
      return response
    }
  }, slow)
  await page.getByRole('button', { name: 'Refresh right panel', exact: true }).click()
}

test('phone thumbnails load visible images, skip unsupported/large files and reuse the cache', async ({ page }) => {
  await setup(page); await imageFixture(page)
  const right = page.getByRole('region', { name: 'Right file panel', exact: true })
  await expect(right.getByRole('row', { name: 'Photo0.png', exact: true })).toBeVisible()
  expect((await requests(page)).filter(r => r.type === 'files.thumbnail')).toHaveLength(0)
  await right.getByRole('combobox', { name: 'right file view' }).selectOption('gallery')
  await expect(right.getByRole('option', { name: 'Photo0.png', exact: true }).locator('img')).toBeVisible()
  await expect.poll(async () => (await requests(page)).filter(r => r.type === 'files.thumbnail').length).toBeGreaterThan(3)
  expect(await right.getByRole('option', { name: 'Photo0.png', exact: true }).locator('img').evaluate(e => [(e as HTMLImageElement).naturalWidth, (e as HTMLImageElement).naturalHeight])).toEqual([320, 160])
  const initial = (await requests(page)).filter(r => r.type === 'files.thumbnail') as Extract<BackendRequest, { type: 'files.thumbnail' }>[]
  expect(initial.length).toBeLessThan(40)
  expect(initial.every(r => r.location.kind === 'device' && r.location.serial === 'PHONE' && r.location.transportId === '2' && r.fingerprint.startsWith('photo-'))).toBe(true)
  await right.getByRole('combobox', { name: 'right file view' }).selectOption('detailed')
  await right.getByRole('combobox', { name: 'right file view' }).selectOption('gallery')
  await expect(right.getByRole('option', { name: 'Photo0.png', exact: true }).locator('img')).toBeVisible()
  expect((await requests(page)).filter(r => r.type === 'files.thumbnail' && r.location.path.endsWith('/Photo0.png'))).toHaveLength(1)
  await right.getByRole('searchbox', { name: 'Filter right files' }).fill('large')
  await expect(right.getByRole('option', { name: 'large.png', exact: true })).toBeVisible()
  expect((await requests(page)).filter(r => r.type === 'files.thumbnail' && r.location.path.endsWith('/large.png'))).toHaveLength(0)
})

test('leaving thumbnail view cancels the active phone read and drops the queue', async ({ page }) => {
  await setup(page); await imageFixture(page, true)
  const right = page.getByRole('region', { name: 'Right file panel', exact: true })
  await right.getByRole('combobox', { name: 'right file view' }).selectOption('gallery')
  await expect.poll(async () => (await requests(page)).filter(r => r.type === 'files.thumbnail').length).toBe(1)
  await right.getByRole('combobox', { name: 'right file view' }).selectOption('detailed')
  await expect.poll(async () => (await requests(page)).filter(r => r.type === 'files.thumbnail.cancel').length).toBe(1)
  expect((await requests(page)).filter(r => r.type === 'files.thumbnail')).toHaveLength(1)
  await page.getByRole('navigation').getByRole('button', { name: 'Components', exact: true }).click()
  expect((await requests(page)).filter(r => r.type === 'files.thumbnail')).toHaveLength(1)
})

test('image formats decode to small previews, broken images fall back and reconnect uses a new cache identity', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => {
    const original = window.desktop!.request, canvas = document.createElement('canvas')
    canvas.width = 320; canvas.height = 640; canvas.getContext('2d')!.fillRect(0, 0, 320, 640)
    const formats: Record<string, string> = { png: canvas.toDataURL('image/png'), jpeg: canvas.toDataURL('image/jpeg'), webp: canvas.toDataURL('image/webp'), gif: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', broken: 'data:image/png;base64,AAAA' }
    window.desktop!.request = async request => {
      if (request.type === 'files.thumbnail') {
        window.backendTest.requests.push(request)
        return { ok: true, snapshot: window.backendTest.snapshot, thumbnail: formats[request.fingerprint] }
      }
      const reply = await original(request)
      if (request.type === 'files.list' && reply.ok && reply.fileListing && request.location.kind === 'device') {
        reply.fileListing.entries = Object.keys(formats).map(format => ({ name: format === 'broken' ? 'broken.png' : 'image.' + format, path: request.location.path + '/image.' + format, kind: 'file', size: 500, fingerprint: format, modified: 1 }))
      }
      return reply
    }
  })
  const right = page.getByRole('region', { name: 'Right file panel', exact: true })
  await right.getByRole('button', { name: 'Refresh right panel', exact: true }).click()
  await right.getByRole('combobox', { name: 'right file view' }).selectOption('gallery')
  for (const format of ['png', 'jpeg', 'webp', 'gif']) {
    const image = right.getByRole('option', { name: 'image.' + format, exact: true }).locator('img')
    await expect(image).toBeVisible()
    const dimensions = await image.evaluate(e => [(e as HTMLImageElement).naturalWidth, (e as HTMLImageElement).naturalHeight])
    expect(dimensions).toEqual(format === 'gif' ? [1, 1] : [160, 320])
  }
  await expect(right.getByRole('option', { name: 'broken.png', exact: true }).locator('img')).toHaveCount(0)
  await page.evaluate(() => {
    const connection = structuredClone(window.backendTest.snapshot.connection)
    connection.devices[0].transportId = '3'
    window.backendTest.emit({ type: 'connection', connection })
  })
  await expect(right).toContainText('Phone unavailable or reconnected')
  await right.getByRole('button', { name: 'Refresh right panel', exact: true }).click()
  await expect.poll(async () => (await requests(page)).filter(r => r.type === 'files.thumbnail' && r.location.transportId === '3').length).toBeGreaterThan(2)
  await page.screenshot({ path: 'test-results/files-phone-thumbnails.png' })
})
test('restricted phone items warn without hiding readable files or claiming the folder is empty', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => {
    const original = window.desktop!.request
    let reads = 0
    window.desktop!.request = async request => {
      const response = await original(request)
      if (request.type === 'files.list' && request.location.kind === 'device' && response.ok && response.fileListing) {
        response.fileListing.warning = '8 restricted items skipped. Android denied access; root access may be required.'
        if (++reads > 1) response.fileListing.entries = []
      }
      return response
    }
  })
  const right = page.getByRole('region', { name: 'Right file panel', exact: true })
  await right.getByRole('button', { name: 'Refresh right panel', exact: true }).click()
  await expect(right).toContainText('8 restricted items skipped.')
  await expect(right.getByRole('row', { name: 'Manual.pdf', exact: true })).toBeVisible()
  await right.getByRole('button', { name: 'Refresh right panel', exact: true }).click()
  await expect(right).toContainText('No accessible files to display')
  await expect(right).not.toContainText('This folder is empty')
})

test('two real-source panes have independent tabs, hidden files and a persistent layout', async ({ page }) => {
  await setup(page)
  const left = page.getByRole('region', { name: 'Left file panel', exact: true }), right = page.getByRole('region', { name: 'Right file panel', exact: true })
  await expect(left.getByRole('combobox', { name: 'left source' })).toHaveValue('local')
  await expect(right.getByRole('combobox', { name: 'right source' })).toHaveValue('phone')
  await expect(page.locator('#context-sidebar')).toHaveCount(0)
  await expect(left.getByText('.hidden', { exact: true })).toHaveCount(0)
  await left.getByRole('button', { name: 'Show hidden files in left panel' }).click(); await expect(left.getByText('.hidden', { exact: true })).toBeVisible()
  await left.getByRole('button', { name: 'New left tab' }).click(); await expect(left.getByRole('tab')).toHaveCount(2)
  await left.getByText('Photos', { exact: true }).dblclick(); await expect(left.getByRole('tab', { name: 'Photos', exact: true })).toBeVisible()
  await expect(right.getByRole('tab', { name: 'sdcard', exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/files-commander.png' })
  const overflow = await page.locator('.fm-workspace').evaluate(e => e.scrollWidth > e.clientWidth)
  expect(overflow).toBe(false)
})
test('folder tasks separate selected roots from nested progress and do not present a root count as a percentage', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => {
    const state: import('../electron/files-protocol').FilesState = { revision: 5, tasks: [{ id: 'tree-copy', action: 'copy', source: { kind: 'device', id: 'phone', serial: 'PHONE', transportId: '2', path: '/storage/emulated/0' }, destination: { kind: 'local', path: 'D:\\Backup' }, status: 'running', createdAt: new Date().toISOString(), items: [{ path: '/storage/emulated/0/DCIM', status: 'running' }], completed: 0, bytes: 886361292, processedContents: { files: 84, folders: 12 }, current: '/storage/emulated/0/DCIM/Camera/video.mp4', pauseRequested: false, stopRequested: false }] }
    window.backendTest.snapshot.files = state; window.backendTest.emit({ type: 'files', state: structuredClone(state) })
  })
  await page.getByRole('button', { name: /^Tasks/ }).click()
  const tasks = page.getByRole('complementary', { name: 'File tasks', exact: true })
  await expect(tasks).toContainText('Copy · 1 selected item')
  await expect(tasks).toContainText('Selected items finished: 0 / 1')
  await expect(tasks).toContainText('Files processed: 84 · Folders fully processed: 12')
  await expect(tasks).toContainText('845.3 MB transferred')
  const toolbar = page.getByLabel('Workspace operations')
  await expect(toolbar.getByRole('progressbar')).toHaveCount(0)
  await expect(toolbar).toContainText('Overall size not yet known')
  await expect(page.getByRole('button', { name: 'Copy files', exact: true })).toContainText('84 files processed · 845.3 MB transferred')
  await page.evaluate(() => {
    const state = window.backendTest.snapshot.files!; state.revision++
    Object.assign(state.tasks[0], { phase: 'transferring', fileProgress: { bytes: 100, totalBytes: 400 } })
    window.backendTest.emit({ type: 'files', state: structuredClone(state) })
  })
  await expect(toolbar.getByRole('progressbar', { name: 'Current file progress' })).toHaveAttribute('aria-valuenow', '25')
  await expect(toolbar).toContainText('Current file: 100 B / 400 B · 25%')
  await expect(tasks.getByRole('progressbar', { name: 'Current file progress' })).toHaveAttribute('aria-valuenow', '25')
  await expect(tasks).toContainText('Overall size: not yet known')
  await page.evaluate(() => {
    const state = window.backendTest.snapshot.files!; state.revision++
    const task = state.tasks[0]; task.totalBytes = 1000; task.bytes = 500; task.processedContents = { files: 1, folders: 0 }
    window.backendTest.emit({ type: 'files', state: structuredClone(state) })
  })
  await expect(tasks).toContainText('Files processed: 1 · Folders fully processed: 0')
  await expect(toolbar.getByRole('progressbar', { name: 'Total transferred progress' })).toHaveAttribute('aria-valuenow', '50')
  await expect(tasks.getByRole('progressbar')).toHaveCount(2)
  await expect(tasks.getByRole('progressbar', { name: 'Current file progress' })).toHaveAttribute('aria-valuenow', '25')
  await expect(tasks.getByRole('progressbar', { name: 'Total transferred progress' })).toHaveAttribute('aria-valuenow', '50')
  await page.screenshot({ path: 'test-results/files-task-nested-progress.png' })
})

test('folder progress shows counting, nested totals, skipped items and byte-free folders', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => {
    const task: import('../electron/files-protocol').FileTask = { id: 'folder-total', action: 'copy', source: { kind: 'device', id: 'phone', serial: 'PHONE', transportId: '2', path: '/sdcard' }, destination: { kind: 'local', path: 'D:\\Backup' }, status: 'running', createdAt: '', items: [{ path: '/sdcard/Music', status: 'pending' }], completed: 0, bytes: 0, phase: 'scanning', scan: { files: 120, folders: 9, bytes: 1024 }, processedContents: { files: 0, folders: 0 }, current: '/sdcard/Music/Album', pauseRequested: false, stopRequested: false }
    const state = { revision: 1, tasks: [task] }; window.backendTest.snapshot.files = state; window.backendTest.emit({ type: 'files', state: structuredClone(state) })
  })
  await page.getByRole('button', { name: /^Tasks/ }).click()
  const tasks = page.getByRole('complementary', { name: 'File tasks', exact: true }), toolbar = page.getByLabel('Workspace operations')
  await expect(toolbar.getByRole('button', { name: 'Copy files', exact: true })).toHaveAccessibleDescription('Counting files and folders')
  await expect(toolbar).toContainText('120 files · 9 folders found')
  await expect(tasks).toContainText('Calculating overall size')
  await expect(tasks.locator('.lattice-loader')).toBeVisible()
  await expect(tasks.getByRole('progressbar')).toHaveCount(0)
  await expect(tasks.locator('.operation-chip').getByRole('button')).toHaveCount(0)
  await expect(toolbar.getByRole('progressbar')).toHaveCount(0)
  await expect(tasks.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled()
  await expect(tasks.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled()
  await page.evaluate(() => {
    const state = window.backendTest.snapshot.files!; state.revision++
    Object.assign(state.tasks[0], { phase: 'transferring', totalBytes: 1000, bytes: 400, totalContents: { files: 120, folders: 9 }, processedContents: { files: 47, folders: 3 }, fileProgress: { bytes: 10, totalBytes: 100 } })
    window.backendTest.emit({ type: 'files', state: structuredClone(state) })
  })
  await expect(tasks).toContainText('Files processed: 47 / 120 · Folders fully processed: 3 / 9')
  await expect(toolbar.getByRole('progressbar', { name: 'Total transferred progress' })).toHaveAttribute('aria-valuenow', '40')
  await expect(tasks.getByRole('progressbar', { name: 'Current file progress' })).toHaveAttribute('aria-valuenow', '10')
  await expect(tasks.getByRole('progressbar', { name: 'Total transferred progress' })).toHaveAttribute('aria-valuenow', '40')
  await expect(tasks.getByRole('progressbar')).toHaveCount(2)
  await expect(tasks.locator('.operation-progress-track, .lattice-loader')).toHaveCount(0)
  await page.evaluate(() => { const state = window.backendTest.snapshot.files!; state.revision++; state.tasks[0].status = 'paused'; state.tasks[0].pauseRequested = true; window.backendTest.emit({ type: 'files', state: structuredClone(state) }) })
  await expect(tasks.locator('.operation-chip[data-status="paused"]')).toHaveCount(2)
  await expect(tasks.getByRole('button', { name: 'Resume', exact: true })).toBeEnabled()
  await expect(tasks.getByRole('progressbar', { name: 'Total transferred progress' })).toHaveAttribute('aria-valuenow', '40')
  await page.evaluate(() => { const state = window.backendTest.snapshot.files!; state.revision++; state.tasks[0].status = 'running'; state.tasks[0].pauseRequested = false; window.backendTest.emit({ type: 'files', state: structuredClone(state) }) })
  await page.screenshot({ path: 'test-results/files-folder-total-progress.png' })
  await page.evaluate(() => {
    const state = window.backendTest.snapshot.files!; state.revision++
    Object.assign(state.tasks[0], { phase: 'verifying', totalBytes: 500, skippedContents: { files: 20, folders: 2 }, totalContents: { files: 100, folders: 7 } })
    window.backendTest.emit({ type: 'files', state: structuredClone(state) })
  })
  await expect(tasks).toContainText('Skipped: 20 files · 2 folders')
  await expect(toolbar.getByRole('button', { name: 'Copy files', exact: true })).toHaveAccessibleDescription('Verifying')
  await expect(toolbar.getByRole('progressbar', { name: 'Total transferred progress' })).toHaveAttribute('aria-valuenow', '80')
  await page.evaluate(() => {
    const state = window.backendTest.snapshot.files!; state.revision++
    Object.assign(state.tasks[0], { phase: 'preparing', totalBytes: 0, bytes: 0, fileProgress: undefined, totalContents: { files: 1, folders: 3 }, processedContents: { files: 1, folders: 1 } })
    window.backendTest.emit({ type: 'files', state: structuredClone(state) })
  })
  await expect(tasks.getByRole('progressbar', { name: 'Objects processed progress' })).toHaveAttribute('aria-valuenow', '50')
  await expect(toolbar).toContainText('Objects processed: 2 / 4 items · 50%')
  await page.evaluate(() => {
    const state = window.backendTest.snapshot.files!; state.revision++
    Object.assign(state.tasks[0], { status: 'success', phase: undefined, totalContents: { files: 0, folders: 0 }, processedContents: { files: 0, folders: 0 }, skippedContents: { files: 1, folders: 3 } })
    window.backendTest.emit({ type: 'files', state: structuredClone(state) })
  })
  await expect(tasks.getByRole('progressbar')).toHaveCount(0)
  await expect(tasks).toContainText('No objects left to transfer.')
})

test('file progress prioritizes running work and explicitly distinguishes pause, queue, conflicts and verification', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => {
    const base: import('../electron/files-protocol').FileTask = { id: 'active', action: 'move', source: { kind: 'local', path: 'D:\\Music' }, destination: { kind: 'local', path: 'E:\\Music' }, status: 'running', createdAt: new Date().toISOString(), items: [{ path: 'D:\\Music\\Album', status: 'running' }], completed: 0, bytes: 200, fileProgress: { bytes: 100, totalBytes: 200 }, phase: 'transferring', processedContents: { files: 30, folders: 0 }, current: 'D:\\Music\\Album\\track.mp3', pauseRequested: false, stopRequested: false }
    const state = { revision: 10, tasks: [{ ...base, id: 'queued', current: 'waiting.mp3', status: 'queued' as const, fileProgress: undefined }, base] }
    window.backendTest.snapshot.files = state; window.backendTest.emit({ type: 'files', state: structuredClone(state) })
  })
  const toolbar = page.getByLabel('Workspace operations'), button = toolbar.getByRole('button', { name: 'Move files', exact: true })
  await expect(button).toContainText('track.mp3')
  await expect(button).toHaveAccessibleDescription('Transferring')
  await expect(toolbar).not.toContainText('0 folders')
  await page.getByRole('button', { name: 'More (1)', exact: true }).click()
  const all = page.getByRole('dialog', { name: 'Current operations' })
  await expect(all).toContainText('Queued')
  await expect(all.locator('.operation-spinner, .indeterminate')).toHaveCount(0)
  await all.getByRole('button', { name: 'Close', exact: true }).click()
  for (const [status, phase, expected] of [['running', 'verifying', 'Verifying'], ['paused', 'verifying', 'Paused'], ['queued', 'preparing', 'Queued'], ['conflict', 'preparing', 'Needs a decision'], ['running', 'finishing', 'Finishing']] as const) {
    await page.evaluate(({ status, phase }) => {
      const state = window.backendTest.snapshot.files!; state.revision++; state.tasks = [state.tasks.find(t => t.id === 'active')!]
      Object.assign(state.tasks[0], { status, phase, fileProgress: phase === 'verifying' ? { bytes: 200, totalBytes: 200 } : undefined })
      window.backendTest.emit({ type: 'files', state: structuredClone(state) })
    }, { status, phase })
    await expect(button).toHaveAccessibleDescription(expected)
    await expect(toolbar.locator('.operation-spinner, .indeterminate')).toHaveCount(0)
    if (status !== 'running') await expect(toolbar.locator('.lattice-loader')).toHaveCount(0)
    if (phase !== 'verifying') await expect(toolbar.getByRole('progressbar')).toHaveCount(0)
  }
  await page.screenshot({ path: 'test-results/files-finishing-status.png' })
})

test('multi-selection confirms the exact source, destination and files; task survives switching workspace', async ({ page }) => {
  await setup(page)
  const left = page.getByRole('region', { name: 'Left file panel', exact: true })
  await left.getByRole('row', { name: 'SD Maid.apk', exact: true }).click(); await left.getByRole('row', { name: 'Notes.txt', exact: true }).click({ modifiers: ['Control'] })
  await expect(left).toContainText('2 selected')
  await page.locator('.fm-commands').getByRole('button', { name: /Copy/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Copy · 2 objects' }); await expect(dialog).toContainText('C:\\Downloads'); await expect(dialog).toContainText('Destination folder · Redmi Note 4')
  await expect(dialog.getByRole('textbox', { name: 'Destination folder', exact: true })).toHaveValue('/sdcard')
  await expect(dialog.getByRole('combobox')).toHaveCount(0)
  await expect(dialog).toContainText('SD Maid.apk'); await expect(dialog).toContainText('Notes.txt')
  expect((await requests(page)).filter(r => r.type === 'files.enqueue')).toHaveLength(0)
  await dialog.getByRole('button', { name: 'Copy', exact: true }).click()
  const task = (await requests(page)).find(r => r.type === 'files.enqueue') as Extract<BackendRequest, { type: 'files.enqueue' }>
  expect(task.plan.items).toHaveLength(2); expect(task.plan.destination?.serial).toBe('PHONE'); expect(task.plan.confirmed).toBe(true); expect(task.plan.conflict).toBe('ask')
  await page.getByRole('navigation').getByRole('button', { name: 'Components', exact: true }).click()
  await page.getByRole('button', { name: 'Copy files', exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'File tasks' })).toBeVisible()
  await page.getByRole('button', { name: 'Close file tasks', exact: true }).click()
  expect((await requests(page)).filter(r => r.type === 'files.control')).toHaveLength(0)
})

test('copy edits the destination folder and asks about collisions only when they occur', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 740 }); await setup(page)
  const left = page.getByRole('region', { name: 'Left file panel', exact: true })
  await left.getByRole('row', { name: 'SD Maid.apk', exact: true }).click()
  await page.getByRole('region', { name: 'left folder contents', exact: true }).press('F5')
  const dialog = page.getByRole('dialog', { name: 'Copy · 1 object', exact: true }), destination = dialog.getByRole('textbox', { name: 'Destination folder', exact: true })
  await expect(dialog).toContainText('This PC · C:\\Downloads\\SD Maid.apk')
  await expect(destination).toBeFocused()
  expect(await destination.evaluate(e => (e as HTMLInputElement).selectionEnd! - (e as HTMLInputElement).selectionStart!)).toBe('/sdcard'.length)
  await expect(dialog.getByRole('combobox')).toHaveCount(0)
  await destination.fill(''); await destination.press('Enter')
  await expect(dialog.getByRole('button', { name: 'Copy', exact: true })).toBeDisabled()
  expect((await requests(page)).filter(r => r.type === 'files.enqueue')).toHaveLength(0)
  await destination.fill('/storage/1234-5678/Download')
  for (const node of [dialog, dialog.locator('.app-badge-dialog-content')]) expect(await node.evaluate(e => e.scrollWidth > e.clientWidth)).toBe(false)
  await page.screenshot({ path: 'test-results/files-copy-dialog.png' })
  await destination.press('Enter')
  await expect(dialog).not.toBeVisible()
  const enqueued = (await requests(page)).filter(r => r.type === 'files.enqueue') as Extract<BackendRequest, { type: 'files.enqueue' }>[]
  expect(enqueued).toHaveLength(1)
  expect(enqueued[0].plan).toMatchObject({ action: 'copy', destination: { kind: 'device', id: 'phone', serial: 'PHONE', transportId: '2', path: '/storage/1234-5678/Download' }, conflict: 'ask' })
  const panel = page.getByRole('complementary', { name: 'File tasks' })
  await expect(panel).not.toBeVisible()
  await page.evaluate(() => {
    const state = structuredClone(window.backendTest.snapshot.files!)
    state.revision++; state.tasks[0].status = 'conflict'
    state.tasks[0].conflict = { source: 'C:\\Downloads\\SD Maid.apk', destination: '/storage/1234-5678/Download/SD Maid.apk', directory: false }
    window.backendTest.snapshot.files = state
    window.backendTest.emit({ type: 'files', state: structuredClone(state) })
  })
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('group', { name: 'Existing destination' })).toContainText('/storage/1234-5678/Download/SD Maid.apk')
  await panel.getByRole('button', { name: 'Close file tasks' }).click()
  await page.evaluate(() => window.backendTest.emit({ type: 'files', state: structuredClone(window.backendTest.snapshot.files!) }))
  await expect(panel).not.toBeVisible()
  await page.getByRole('button', { name: 'Tasks', exact: false }).filter({ hasText: 'Tasks' }).click()
  await panel.getByRole('button', { name: 'Keep both', exact: true }).click()
  expect((await requests(page)).filter(r => r.type === 'files.resolve')).toEqual([{ type: 'files.resolve', id: 'task-2', choice: 'keep-both', all: false }])
})

test('move to a PC folder supports cancellation and retains the selected phone identity', async ({ page }) => {
  await setup(page)
  const right = page.getByRole('region', { name: 'Right file panel', exact: true }), list = page.getByRole('region', { name: 'right folder contents', exact: true })
  await right.getByRole('row', { name: 'Manual.pdf', exact: true }).click(); await list.press('F6')
  const dialog = page.getByRole('dialog', { name: 'Move · 1 object', exact: true }), destination = dialog.getByRole('textbox', { name: 'Destination folder', exact: true })
  await expect(dialog).toContainText('Redmi Note 4 · /sdcard/Manual.pdf')
  await expect(destination).toHaveValue('C:\\Downloads')
  await destination.fill('D:\\Documents'); await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await requests(page)).filter(r => r.type === 'files.enqueue')).toHaveLength(0)
  await list.press('F6'); await destination.press('Escape')
  await expect(dialog).not.toBeVisible()
  expect((await requests(page)).filter(r => r.type === 'files.enqueue')).toHaveLength(0)
  await list.press('F6'); await destination.fill('D:\\Documents'); await destination.press('Enter')
  const enqueued = (await requests(page)).filter(r => r.type === 'files.enqueue') as Extract<BackendRequest, { type: 'files.enqueue' }>[]
  expect(enqueued).toHaveLength(1)
  expect(enqueued[0].plan).toMatchObject({ action: 'move', source: { id: 'phone', serial: 'PHONE', transportId: '2' }, destination: { kind: 'local', path: 'D:\\Documents' }, items: [{ path: '/sdcard/Manual.pdf' }], conflict: 'ask' })
})
test('batch rename preview prevents duplicate names and never runs before confirmation', async ({ page }) => {
  await setup(page)
  const left = page.getByRole('region', { name: 'Left file panel', exact: true })
  await left.getByRole('row', { name: 'SD Maid.apk', exact: true }).click(); await left.getByRole('row', { name: 'Notes.txt', exact: true }).click({ modifiers: ['Control'] })
  await page.locator('.fm-commands').getByRole('button', { name: /Rename/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Batch rename' }); await dialog.getByRole('textbox', { name: 'Name pattern' }).fill('same.txt')
  await expect(dialog.getByText('Duplicate name')).toHaveCount(2); await expect(dialog.getByRole('button', { name: 'Rename', exact: true })).toBeDisabled()
  await dialog.getByRole('textbox', { name: 'Name pattern' }).fill('{n}-{name}{ext}')
  await expect(dialog.getByText('1-SD Maid.apk', { exact: true })).toBeVisible(); await expect(dialog.getByRole('button', { name: 'Rename', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: 'Close', exact: true }).click(); expect((await requests(page)).filter(r => r.type === 'files.enqueue')).toHaveLength(0)
})
test('keyboard selection and deletion are confirmed; disconnect keeps local Files usable', async ({ page }) => {
  await setup(page)
  const list = page.getByRole('region', { name: 'left folder contents', exact: true }); await list.focus(); await list.press('Control+a'); await list.press('Delete')
  const dialog = page.getByRole('dialog', { name: 'Delete · 3 objects' }); await expect(dialog).toContainText('Permanently deletes'); await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  expect((await requests(page)).filter(r => r.type === 'files.enqueue')).toHaveLength(0)
  await page.evaluate(() => { const c = window.backendTest.snapshot.connection; c.devices[0].status = 'offline'; c.activeDeviceId = null; window.backendTest.emit({ type: 'connection', connection: c }) })
  await expect(page.getByRole('region', { name: 'Left file panel', exact: true })).toBeVisible(); await expect(page.getByText('Phone unavailable or reconnected.', { exact: false })).toBeVisible()
})
test('compact and grid views fit a smaller window with Places open', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 740 }); await setup(page)
  await page.getByRole('button', { name: 'Places', exact: true }).click()
  await page.getByRole('combobox', { name: 'left file view' }).selectOption('compact'); await page.getByRole('combobox', { name: 'right file view' }).selectOption('grid')
  for (const selector of ['.fm-workspace', '.fm-pane']) for (const node of await page.locator(selector).all()) expect(await node.evaluate(e => e.scrollWidth > e.clientWidth)).toBe(false)
  await page.screenshot({ path: 'test-results/files-small.png' })
})
test('keyboard ranges extend across rows and file bookmarks reveal their parent', async ({ page }) => {
  await setup(page)
  const left = page.getByRole('region', { name: 'Left file panel', exact: true }), list = page.getByRole('region', { name: 'left folder contents', exact: true })
  await left.getByText('Photos', { exact: true }).click(); await expect(list).toBeFocused()
  await list.press('Shift+ArrowDown'); await list.press('Shift+ArrowDown'); await expect(left).toContainText('3 selected')
  await left.getByText('SD Maid.apk', { exact: true }).click({ button: 'right' })
  await left.getByRole('button', { name: 'Clear selection', exact: true }).click()
  await left.getByText('SD Maid.apk', { exact: true }).click({ button: 'right' })
  await left.getByRole('button', { name: 'Bookmark selected', exact: true }).click()
  await page.getByRole('button', { name: 'Places', exact: true }).click()
  await page.getByRole('navigation', { name: 'File locations', exact: true }).getByRole('button', { name: 'SD Maid.apk', exact: true }).click()
  await expect(left.getByRole('row', { name: 'SD Maid.apk', exact: true })).toHaveAttribute('aria-selected', 'true')
})

async function searchSetup(page: Page) {
  await setup(page)
  await page.evaluate(() => {
    const original = window.desktop!.request
    let index: import('../electron/file-search-protocol').FileIndexInfo | undefined
    window.desktop!.request = async r => {
      if (!['files.search', 'files.search.cancel', 'files.index.info', 'files.index.build', 'files.index.delete'].includes(r.type)) return original(r)
      window.backendTest.requests.push(r)
      const snapshot = window.backendTest.snapshot
      if (r.type === 'files.search' || r.type === 'files.index.build') {
        const build = r.type === 'files.index.build'
        if (build) index = { updatedAt: '2026-10-08T12:00:00Z', count: 4, location: r.location }
        snapshot.fileSearch = { id: crypto.randomUUID(), revision: (snapshot.fileSearch?.revision || 0) + 1, status: build ? 'complete' : 'running', operation: build ? 'index' : 'search', location: r.location, query: r.type === 'files.search' ? r.query : { source: 'live', name: '', nameMode: 'contains', caseSensitive: false, recursive: true, kind: 'any', text: '', archives: false }, scanned: build ? 4 : 0, matched: 0, results: [], current: r.location.path, warnings: [], message: build ? 'Index updated · 4 objects' : 'Searching files', index }
        window.backendTest.emit({ type: 'fileSearch', state: structuredClone(snapshot.fileSearch) })
      }
      if (r.type === 'files.search.cancel' && snapshot.fileSearch) { snapshot.fileSearch.status = 'cancelled'; snapshot.fileSearch.message = 'Stopped by user.'; snapshot.fileSearch.revision++; window.backendTest.emit({ type: 'fileSearch', state: structuredClone(snapshot.fileSearch) }) }
      if (r.type === 'files.index.delete') index = undefined
      return { ok: true, snapshot, fileIndex: index }
    }
  })
}
test('instant filtering does not scan; advanced search captures scope and survives closing', async ({ page }) => {
  await searchSetup(page)
  const left = page.getByRole('region', { name: 'Left file panel', exact: true })
  const before = (await requests(page)).length
  await left.getByRole('searchbox', { name: 'Filter left files' }).fill('Maid'); await expect(left.getByText('Notes.txt', { exact: true })).not.toBeVisible()
  expect((await requests(page)).length).toBe(before)
  await left.getByRole('button', { name: 'Search left folder', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Search files', exact: true })
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('*.apk'); await dialog.getByRole('combobox', { name: 'Match', exact: true }).selectOption('glob')
  await dialog.getByLabel('Subfolders', { exact: true }).uncheck(); await dialog.getByLabel('Min size (MiB)', { exact: true }).fill('1.5')
  await dialog.getByRole('button', { name: 'Search', exact: true }).click()
  const req = (await requests(page)).find(r => r.type === 'files.search') as Extract<BackendRequest, { type: 'files.search' }>
  expect(req.location.path).toBe('C:\\Downloads'); expect(req.query).toMatchObject({ name: '*.apk', nameMode: 'glob', recursive: false, minSize: 1572864 })
  await dialog.getByRole('button', { name: 'Close', exact: true }).click(); expect((await requests(page)).some(r => r.type === 'files.search.cancel')).toBe(false)
  await page.getByRole('navigation').getByRole('button', { name: 'Components', exact: true }).click()
  await page.getByRole('button', { name: 'Searching files', exact: true }).click(); await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Stop search', exact: true }).click(); await expect(dialog).toContainText('Results below are incomplete.')
})
test('index controls show timestamp and metadata-only search; results reveal real containing folders', async ({ page }) => {
  await searchSetup(page); await page.getByRole('button', { name: 'Search left folder', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Search files', exact: true })
  await dialog.getByRole('combobox', { name: 'Search in', exact: true }).selectOption('index'); await expect(dialog.getByRole('button', { name: 'Search', exact: true })).toBeDisabled()
  await expect(dialog.getByLabel('Containing text', { exact: true })).toBeDisabled(); await expect(dialog.getByLabel('Inside ZIP / APKS', { exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Build index', exact: true }).click(); await expect(dialog).toContainText('4 objects · Updated')
  await dialog.getByRole('button', { name: 'Search', exact: true }).click()
  await page.evaluate(() => { const s = window.backendTest.snapshot.fileSearch!; s.status = 'complete'; s.revision++; s.scanned = 4; s.matched = 1; s.message = '1 matches'; s.results = [{ entry: { name: 'Notes.txt', path: 'C:\\Downloads\\Notes.txt', kind: 'file', size: 40, modified: 1791442800000, fingerprint: 'fingerprint-Notes.txt' } }]; window.backendTest.emit({ type: 'fileSearch', state: structuredClone(s) }) })
  await expect(dialog.getByRole('button', { name: 'Show Notes.txt in folder', exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/files-search-index.png' })
  await dialog.getByRole('button', { name: 'Show Notes.txt in folder', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Left file panel', exact: true }).getByRole('row', { name: 'Notes.txt', exact: true })).toHaveAttribute('aria-selected', 'true')
})
test('archive matches show their container and member without exposing mutation commands', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 740 }); await searchSetup(page); await page.getByRole('button', { name: 'Search left folder', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Search files', exact: true })
  await dialog.getByLabel('Inside ZIP / APKS', { exact: true }).check(); await dialog.getByRole('button', { name: 'Search', exact: true }).click()
  await page.evaluate(() => { const s = window.backendTest.snapshot.fileSearch!; s.status = 'complete'; s.revision++; s.scanned = 4; s.matched = 1; s.message = '1 matches'; s.results = [{ entry: { name: 'base.apk', path: 'C:\\Downloads\\YouTube.apks', kind: 'file', size: 4096, modified: 1791442800000, fingerprint: 'fp' }, archive: 'C:\\Downloads\\YouTube.apks', member: 'base.apk' }]; window.backendTest.emit({ type: 'fileSearch', state: structuredClone(s) }) })
  await expect(dialog).toContainText('C:\\Downloads\\YouTube.apks → base.apk')
  await expect(dialog.getByRole('button', { name: 'Show archive YouTube.apks', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Copy path of base.apk', exact: true }).click(); expect(await page.evaluate(() => window.backendTest.clipboardWrites.at(-1))).toBe('C:\\Downloads\\YouTube.apks!/base.apk')
  expect((await requests(page)).some(r => r.type === 'files.enqueue' || r.type === 'files.open')).toBe(false)
  expect(await dialog.evaluate(e => e.scrollWidth > e.clientWidth)).toBe(false)
  await page.screenshot({ path: 'test-results/files-search-small.png' })
})

test('selection uses Shift ranges and Ctrl toggles with no checkboxes; parent is never an operation target', async ({ page }) => {
  await setup(page)
  const left = page.getByRole('region', { name: 'Left file panel', exact: true }), list = page.getByRole('region', { name: 'left folder contents', exact: true })
  await expect(left.getByRole('checkbox')).toHaveCount(0)
  await left.getByRole('row', { name: 'Photos', exact: true }).click()
  await left.getByRole('row', { name: 'SD Maid.apk', exact: true }).click({ modifiers: ['Shift'] }); await expect(left).toContainText('3 selected')
  await left.getByRole('row', { name: 'Notes.txt', exact: true }).click({ modifiers: ['Control'] }); await expect(left).toContainText('2 selected')
  await expect(left.getByRole('row', { name: 'Notes.txt', exact: true })).toHaveAttribute('aria-selected', 'false')
  await list.press('Control+a'); await expect(left).toContainText('3 selected'); await list.press('Delete')
  const dialog = page.getByRole('dialog', { name: 'Delete · 3 objects' }); await expect(dialog).not.toContainText('Parent folder')
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  expect((await requests(page)).some(r => r.type === 'files.enqueue')).toBe(false)
})

test('parent entry stays first under sorting/filtering and selects the folder after returning', async ({ page }) => {
  await setup(page)
  const left = page.getByRole('region', { name: 'Left file panel', exact: true }), parent = left.getByRole('button', { name: 'Parent folder in left panel', exact: true })
  await expect(left.locator('.fm-path').getByRole('button', { name: 'Parent folder in left panel' })).toHaveCount(0)
  await expect(left.locator('tbody tr').first()).toContainText('Parent folder')
  await left.getByRole('button', { name: 'Size', exact: true }).click(); await left.getByRole('searchbox').fill('no matches'); await expect(parent).toBeVisible()
  await left.getByRole('searchbox').fill(''); await left.getByRole('row', { name: 'Photos', exact: true }).dblclick()
  await parent.click(); await expect(left.getByRole('row', { name: 'Photos', exact: true })).toHaveAttribute('aria-selected', 'true')
  const latest = (await requests(page)).filter(r => r.type === 'files.list').at(-1) as Extract<BackendRequest, { type: 'files.list' }>
  expect(latest.location.path).toBe('C:\\Downloads')
  await left.getByRole('combobox', { name: 'left file view', exact: true }).selectOption('grid'); await expect(left.locator('.fm-list').locator('> button').first()).toHaveAccessibleName('Parent folder in left panel')
  await expect(left.getByRole('checkbox')).toHaveCount(0)
})

test('SMB source saves only the address, keeps share breadcrumbs, and uses normal copy confirmation', async ({ page }) => {
  await setup(page)
  const left = page.getByRole('region', { name: 'Left file panel', exact: true })
  await left.getByRole('combobox', { name: 'left source', exact: true }).selectOption('network-add')
  const dialog = page.getByRole('dialog', { name: 'SMB / Samba folder', exact: true })
  await dialog.getByRole('textbox', { name: 'Network folder', exact: true }).fill('smb://NAS/Shared%20files')
  await dialog.getByRole('textbox', { name: 'Name in Places', exact: true }).fill('My NAS')
  await dialog.getByRole('checkbox', { name: 'Ask Windows for credentials', exact: true }).check()
  await page.screenshot({ path: 'test-results/files-smb-dialog.png' })
  await dialog.getByRole('button', { name: 'Open folder', exact: true }).click()
  const request = (await requests(page)).find(r => r.type === 'files.network.connect')
  expect(request).toEqual({ type: 'files.network.connect', address: '\\\\NAS\\Shared files', prompt: true })
  await expect(left.getByRole('combobox', { name: 'left source', exact: true })).toHaveValue('network-current')
  await expect(left.locator('.fm-breadcrumb').getByRole('button', { name: '\\\\NAS\\Shared files', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Places', exact: true }).click(); await expect(page.getByRole('button', { name: 'My NAS', exact: true })).toBeVisible()
  await left.getByRole('row', { name: 'Notes.txt', exact: true }).click(); await page.locator('.fm-commands').getByRole('button', { name: /Copy/ }).click()
  const copy = page.getByRole('dialog', { name: 'Copy · 1 object', exact: false })
  await expect(page.getByRole('dialog')).toContainText('SMB / Samba · \\\\NAS\\Shared files')
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(copy).not.toBeVisible()
  await left.getByRole('row', { name: 'Photos', exact: true }).dblclick(); await left.getByRole('button', { name: 'Parent folder in left panel', exact: true }).click()
  await expect(left.getByRole('row', { name: 'Photos', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.screenshot({ path: 'test-results/files-smb-panes.png' })
})

test('invalid SMB destinations never attempt authentication or change the current folder', async ({ page }) => {
  await setup(page)
  const left = page.getByRole('region', { name: 'Left file panel', exact: true })
  await left.getByRole('combobox', { name: 'left source', exact: true }).selectOption('network-add')
  const dialog = page.getByRole('dialog', { name: 'SMB / Samba folder', exact: true })
  await dialog.getByRole('textbox', { name: 'Network folder', exact: true }).fill('smb://user:password@NAS/share')
  await dialog.getByRole('button', { name: 'Open folder', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('without credentials')
  expect((await requests(page)).some(r => r.type === 'files.network.connect')).toBe(false)
  await dialog.getByRole('button', { name: 'Close', exact: true }).click(); await expect(left.getByRole('combobox', { name: 'left source', exact: true })).toHaveValue('local')
})


test('Commander keyboard reaches parent, opens folders with Right, returns with Left, and switches panels', async ({ page }) => {
  await setup(page)
  const left = page.getByRole('region', { name: 'Left file panel', exact: true }), list = page.getByRole('region', { name: 'left folder contents', exact: true })
  const parent = left.getByRole('button', { name: 'Parent folder in left panel', exact: true })
  await list.focus(); await list.press('Home'); await expect(parent).toHaveAttribute('aria-current', 'true')
  await list.press('ArrowDown'); await expect(left.getByRole('row', { name: 'Photos', exact: true })).toHaveAttribute('aria-selected', 'true')
  await list.press('ArrowUp'); await expect(parent).toHaveAttribute('aria-current', 'true'); await expect(left).not.toContainText('1 selected')
  await list.press('ArrowDown'); await list.press('ArrowRight')
  await expect(left.getByRole('tab', { name: 'Photos', exact: true })).toBeVisible(); await expect(list).toBeFocused()
  await list.press('Home'); await list.press('Enter')
  await expect(left.getByRole('tab', { name: 'Downloads', exact: true })).toBeVisible()
  await expect(left.getByRole('row', { name: 'Photos', exact: true })).toHaveAttribute('aria-selected', 'true')
  await list.press('ArrowRight'); await expect(left.getByRole('tab', { name: 'Photos', exact: true })).toBeVisible()
  await list.press('ArrowLeft'); await expect(left.getByRole('tab', { name: 'Downloads', exact: true })).toBeVisible()
  await parent.focus(); await parent.press('ArrowDown'); await expect(list).toBeFocused()
  await expect(left.getByRole('row', { name: 'Photos', exact: true })).toHaveAttribute('aria-selected', 'true')
  await list.press('End'); await list.press('ArrowRight')
  expect((await requests(page)).filter(r => r.type === 'files.open')).toHaveLength(0)
  await list.press('Tab'); await expect(page.getByRole('region', { name: 'right folder contents', exact: true })).toBeFocused()
  await page.keyboard.press('Shift+Tab'); await expect(list).toBeFocused()
})

test('parent cursor is excluded from keyboard ranges and commands in lists, grids, and filtered empty folders', async ({ page }) => {
  await setup(page)
  const left = page.getByRole('region', { name: 'Left file panel', exact: true }), list = page.getByRole('region', { name: 'left folder contents', exact: true })
  const parent = left.getByRole('button', { name: 'Parent folder in left panel', exact: true })
  await list.focus(); await list.press('Home'); await list.press('Shift+ArrowDown'); await list.press('Shift+ArrowDown'); await expect(left).toContainText('2 selected')
  await list.press('Shift+Home'); await expect(parent).toHaveAttribute('aria-current', 'true'); await expect(left).toContainText('1 selected')
  await list.press('Home'); await list.press('Delete'); await expect(page.getByRole('dialog')).toHaveCount(0)
  await list.press(' '); await expect(left).not.toContainText('selected')
  await left.getByRole('combobox', { name: 'left file view', exact: true }).selectOption('grid'); await list.focus(); await list.press('ArrowDown')
  await expect(left.getByRole('option', { name: 'Photos', exact: true })).toHaveAttribute('aria-selected', 'true')
  await list.press('PageDown'); await expect(left.getByRole('option', { name: 'SD Maid.apk', exact: true })).toHaveAttribute('aria-selected', 'true')
  await list.press('PageUp'); await expect(parent).toHaveAttribute('aria-current', 'true')
  await left.getByRole('searchbox').fill('no matches'); await list.focus(); await list.press('Home'); await list.press('Enter')
  const last = (await requests(page)).filter(r => r.type === 'files.list').at(-1) as Extract<BackendRequest, { type: 'files.list' }>
  expect(last.location.path).toBe('C:\\')
})

test('phone storage shortcuts distinguish SD and USB, share cached discovery, and refresh after card removal', async ({ page }) => {
  await setup(page)
  const right = page.getByRole('region', { name: 'Right file panel', exact: true }), storage = right.getByRole('combobox', { name: 'right storage', exact: true })
  await expect(storage.locator('option', { hasText: 'SD card · Photos' })).toHaveCount(1)
  await expect(storage.locator('option', { hasText: 'USB storage · Read only' })).toHaveCount(1)
  await storage.selectOption('/storage/1234-5678'); await expect(right.getByRole('tab', { name: '1234-5678', exact: true })).toBeVisible()
  const selected = (await requests(page)).filter(r => r.type === 'files.list').at(-1) as Extract<BackendRequest, { type: 'files.list' }>
  expect(selected.location).toMatchObject({ path: '/storage/1234-5678', serial: 'PHONE', transportId: '2' })
  await page.getByRole('button', { name: 'Places', exact: true }).click()
  await page.getByRole('navigation', { name: 'File locations', exact: true }).getByRole('button', { name: 'Internal storage', exact: true }).click()
  await expect(storage).toHaveValue('/storage/emulated/0')
  expect((await requests(page)).filter(r => r.type === 'files.storages')).toHaveLength(1)
  await page.screenshot({ path: 'test-results/files-storage-shortcuts.png' })
  await page.evaluate(() => {
    const original = window.desktop!.request
    window.desktop!.request = async r => {
      const reply = await original(r)
      if (r.type === 'files.storages' && reply.ok) reply.fileStorages = reply.fileStorages?.filter(v => v.kind !== 'sd')
      return reply
    }
  })
  await right.getByRole('button', { name: 'Refresh right panel', exact: true }).click()
  await expect(storage.locator('option', { hasText: 'SD card · Not mounted' })).toBeDisabled()
  await expect(page.getByRole('navigation', { name: 'File locations', exact: true }).getByRole('button', { name: 'SD card · Not mounted', exact: true })).toBeDisabled()
  expect((await requests(page)).filter(r => r.type === 'files.storages')).toHaveLength(2)
})


test('profile storage stays independent in each pane and categories use the selected profile root', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => {
    const original = window.desktop!.request
    window.desktop!.request = async r => {
      const reply = await original(r)
      if (r.type === 'files.storages' && reply.ok) reply.fileStorages = [
        { kind: 'internal', name: 'Internal storage · Personal · ID 0', path: '/storage/emulated/0', userId: 0, primary: true },
        { kind: 'internal', name: 'Internal storage · Office · ID 10 · Work profile', path: '/storage/emulated/10', userId: 10, primary: false },
      ]
      return reply
    }
  })
  const left = page.getByRole('region', { name: 'Left file panel', exact: true }), right = page.getByRole('region', { name: 'Right file panel', exact: true })
  await right.getByRole('button', { name: 'Refresh right panel', exact: true }).click()
  await expect(right.getByLabel('right storage', { exact: true }).locator('option', { hasText: 'Office' })).toHaveCount(1)
  await right.getByLabel('right storage', { exact: true }).selectOption('/storage/emulated/10')
  await expect(right.getByRole('row', { name: 'Manual.pdf', exact: true })).toBeVisible()
  await left.getByLabel('left source', { exact: true }).selectOption('phone')
  await left.getByLabel('left storage', { exact: true }).selectOption('/storage/emulated/0')
  await expect(left.getByRole('row', { name: 'Manual.pdf', exact: true })).toBeVisible()
  await expect(right.getByLabel('right storage', { exact: true })).toHaveValue('/storage/emulated/10')
  await right.getByRole('row', { name: 'Manual.pdf', exact: true }).click()
  await page.getByRole('button', { name: 'Places', exact: true }).click()
  const places = page.getByRole('navigation', { name: 'File locations', exact: true })
  await expect(places.getByRole('button', { name: 'Internal storage · Office · ID 10 · Work profile', exact: true })).toBeVisible()
  await places.getByRole('button', { name: 'Images', exact: true }).click()
  await expect.poll(async () => (await requests(page)).filter(r => r.type === 'files.search').at(-1)).toMatchObject({ location: { path: '/storage/emulated/10', id: 'phone', serial: 'PHONE', transportId: '2' } })
  await expect(left.getByLabel('left storage', { exact: true })).toHaveValue('/storage/emulated/0')
  expect((await requests(page)).filter(r => r.type === 'files.storages')).toHaveLength(2)
  await page.screenshot({ path: 'desktop-test-results/files-profiles.png' })
})

test('denied profile storage keeps its destination and never substitutes primary-profile files', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => {
    const original = window.desktop!.request
    window.desktop!.request = async r => {
      if (r.type === 'files.list' && r.location.path === '/storage/emulated/10') {
        window.backendTest.requests.push(r)
        return { ok: false, snapshot: window.backendTest.snapshot, error: 'Permission denied' }
      }
      const reply = await original(r)
      if (r.type === 'files.storages' && reply.ok) reply.fileStorages?.push({ kind: 'internal', name: 'Internal storage · Office · ID 10', path: '/storage/emulated/10', userId: 10 })
      return reply
    }
  })
  const right = page.getByRole('region', { name: 'Right file panel', exact: true })
  await right.getByRole('button', { name: 'Refresh right panel', exact: true }).click()
  await expect(right.getByLabel('right storage', { exact: true }).locator('option', { hasText: 'Office' })).toHaveCount(1)
  await right.getByLabel('right storage', { exact: true }).selectOption('/storage/emulated/10')
  await expect(right.getByRole('alert')).toContainText('Start and unlock that profile on the phone')
  await expect(right.getByRole('row', { name: 'Manual.pdf', exact: true })).toHaveCount(0)
  await expect(right.getByLabel('right storage', { exact: true })).toHaveValue('/storage/emulated/10')
  const read = (await requests(page)).filter(r => r.type === 'files.list').at(-1) as Extract<BackendRequest, { type: 'files.list' }>
  expect(read.location).toMatchObject({ path: '/storage/emulated/10', serial: 'PHONE', transportId: '2' })
  expect(read.location.root).not.toBe(true)
})

test('Ctrl+C and Ctrl+V keep selected sources and paste into the focused folder, without affecting text inputs', async ({ page }) => {
  await setup(page)
  const left = page.getByRole('region', { name: 'Left file panel', exact: true }), right = page.getByRole('region', { name: 'Right file panel', exact: true })
  await left.getByRole('row', { name: 'SD Maid.apk', exact: true }).click()
  await left.getByRole('row', { name: 'Notes.txt', exact: true }).click({ modifiers: ['Control'] })
  await page.getByRole('region', { name: 'left folder contents', exact: true }).press('Control+c')
  await right.getByRole('row', { name: 'Download', exact: true }).dblclick()
  await page.getByRole('region', { name: 'right folder contents', exact: true }).press('Control+v')
  const dialog = page.getByRole('dialog', { name: 'Copy · 2 objects' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Copy', exact: true }).click()
  const write = (await requests(page)).find(r => r.type === 'files.clipboard.write') as Extract<BackendRequest, { type: 'files.clipboard.write' }>
  expect(write.selection.source.path).toBe('C:\\Downloads')
  expect(write.selection.items.map(i => i.path)).toEqual(['C:\\Downloads\\SD Maid.apk', 'C:\\Downloads\\Notes.txt'])
  const paste = (await requests(page)).find(r => r.type === 'files.clipboard.paste') as Extract<BackendRequest, { type: 'files.clipboard.paste' }>
  expect(paste.destination).toMatchObject({ kind: 'device', path: '/sdcard/Download', transportId: '2' })
  await right.getByRole('searchbox').fill('hello')
  await right.getByRole('searchbox').press('Control+v')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('image albums show their covers while scanning; opening an album and a photo does not start another scan', async ({ page }) => {
  await searchSetup(page)
  const right = page.getByRole('region', { name: 'Right file panel', exact: true })
  await right.getByRole('searchbox').focus()
  await page.getByRole('button', { name: 'Places', exact: true }).click()
  await page.getByRole('navigation', { name: 'File locations' }).getByRole('button', { name: 'Images', exact: true }).click()
  await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 150
    const context = canvas.getContext('2d')!; context.fillStyle = '#a0d5c5'; context.fillRect(0, 0, 200, 150)
    const image = canvas.toDataURL(), original = window.desktop!.request
    window.desktop!.request = async r => {
      if (r.type === 'files.thumbnail' || r.type === 'files.preview' || r.type === 'files.preview.close') {
        window.backendTest.requests.push(r)
        return { ok: true, snapshot: window.backendTest.snapshot, ...(r.type === 'files.thumbnail' ? { thumbnail: image } : r.type === 'files.preview' ? { filePreview: { kind: 'image' as const, url: image } } : {}) }
      }
      return original(r)
    }
    const state = window.backendTest.snapshot.fileSearch!
    Object.assign(state, { revision: state.revision + 1, scanned: 3, matched: 3, canonicalLocation: { ...state.location, path: '/storage/emulated/0' }, results: ['DCIM/Camera/Photo.jpg', 'DCIM/Camera/Second.png', 'Pictures/Screenshots/Screen.png'].map((name, i) => ({ entry: { name: name.split('/').at(-1)!, path: '/storage/emulated/0/' + name, kind: 'file', size: 8_000_000, modified: 1791442800000 + i, fingerprint: 'image-' + i } })) })
    window.backendTest.emit({ type: 'fileSearch', state: structuredClone(state) })
  })
  await expect(right.getByRole('option', { name: 'Camera', exact: true }).locator('img')).toBeVisible()
  await expect(right.getByRole('option', { name: 'Screenshots', exact: true })).toContainText('1 files')
  await right.getByRole('option', { name: 'Camera', exact: true }).dblclick()
  await expect(right.getByRole('option', { name: 'Photo.jpg', exact: true })).toBeVisible()
  await right.getByRole('option', { name: 'Photo.jpg', exact: true }).dblclick()
  const viewer = page.getByRole('dialog', { name: 'Photo.jpg', exact: true })
  await expect(viewer.getByRole('img', { name: 'Photo.jpg' })).toBeVisible()
  await page.screenshot({ path: 'test-results/files-image-viewer.png' })
  await viewer.getByRole('button', { name: 'Close', exact: true }).click()
  await right.getByRole('button', { name: 'Parent folder in right panel', exact: true }).click()
  await expect(right.getByRole('option', { name: 'Camera', exact: true })).toBeVisible()
  await right.getByRole('button', { name: 'All files', exact: true }).click()
  await right.getByRole('combobox', { name: 'right media type' }).selectOption('png')
  await expect(right.getByRole('option', { name: 'Photo.jpg', exact: true })).toHaveCount(0)
  await expect(right.getByRole('option', { name: 'Screen.png', exact: true })).toBeVisible()
  expect((await requests(page)).filter(r => r.type === 'files.search')).toHaveLength(1)
  expect((await requests(page)).filter(r => r.type === 'files.preview.close')).toHaveLength(1)
  await expect(right.getByRole('option', { name: 'Screen.png', exact: true }).locator('img')).toBeVisible()
  await expect(right.getByRole('option', { name: 'Second.png', exact: true }).locator('img')).toBeVisible()
  await page.screenshot({ path: 'test-results/files-albums.png' })
})

test('double-click opens inert text preview and supports choosing an external application', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => {
    const original = window.desktop!.request
    window.desktop!.request = async r => {
      if (r.type === 'files.preview') { window.backendTest.requests.push(r); return { ok: true, snapshot: window.backendTest.snapshot, filePreview: { kind: 'text', text: '<script>window.bad = true</script>\nHello' } } }
      return original(r)
    }
  })
  await page.getByRole('row', { name: 'Notes.txt', exact: true }).dblclick()
  const dialog = page.getByRole('dialog', { name: 'Notes.txt', exact: true })
  await expect(dialog.locator('pre')).toContainText('<script>window.bad = true</script>')
  await dialog.getByRole('button', { name: 'Open with…', exact: true }).click()
  expect((await requests(page)).find(r => r.type === 'files.open')).toMatchObject({ withApp: true, location: { path: 'C:\\Downloads\\Notes.txt' } })
  await dialog.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect.poll(async () => (await requests(page)).filter(r => r.type === 'files.preview.close').length).toBe(1)
})

test('audio viewer distinguishes read failures from decoding and unsupported format errors', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => {
    const original = window.desktop!.request
    window.desktop!.request = async r => {
      if (r.type === 'files.preview') return { ok: true, snapshot: window.backendTest.snapshot, filePreview: { kind: 'audio' } }
      const result = await original(r)
      if (r.type === 'files.list' && result.ok && result.fileListing) result.fileListing.entries = result.fileListing.entries.map(e => e.name === 'Notes.txt' ? { ...e, name: 'Track.mp3', path: e.path.replace('Notes.txt', 'Track.mp3') } : e)
      return result
    }
  })
  await page.getByRole('button', { name: 'Refresh left panel', exact: true }).click()
  for (const [code, message] of [[2, 'The audio could not be read.'], [3, 'The audio could not be decoded.'], [4, 'The audio could not be loaded.']] as const) {
    await page.getByRole('row', { name: 'Track.mp3', exact: true }).dblclick()
    const dialog = page.getByRole('dialog', { name: 'Track.mp3', exact: true })
    await dialog.locator('audio').evaluate((audio, code) => {
      Object.defineProperty(audio, 'error', { value: { code } })
      audio.dispatchEvent(new Event('error'))
    }, code)
    await expect(dialog.getByRole('alert')).toContainText(message)
    await expect(dialog.getByRole('alert')).not.toContainText('This audio codec is not supported')
    await expect(dialog.getByRole('button', { name: 'Open with…', exact: true })).toBeEnabled()
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  }
})

async function setupPhoneAudio(page: Page, failDuringOpen = false) {
  await setup(page)
  await page.evaluate(failDuringOpen => {
    const connection = window.backendTest.snapshot.connection
    Object.assign(connection.devices[0], { id: 'wifi:physical-phone', hardwareId: 'physical-phone', serial: '192.168.1.2:4000', method: 'Wi-Fi', transportId: '2' })
    connection.activeDeviceId = 'wifi:physical-phone'
    window.backendTest.emit({ type: 'connection', connection: structuredClone(connection) })
    const original = window.desktop!.request
    window.desktop!.request = async r => {
      if (r.type === 'files.preview') {
        window.backendTest.requests.push(r)
        const connection = window.backendTest.snapshot.connection, device = connection.devices.find(d => d.id === r.location.id)
        if (failDuringOpen) { failDuringOpen = false; device!.transportId = '8'; window.backendTest.emit({ type: 'connection', connection: structuredClone(connection) }); return { ok: false, snapshot: window.backendTest.snapshot, error: 'The phone connection changed. Select its source again; this operation was not redirected.' } }
        if (!device || r.location.serial !== device.serial || r.location.transportId !== device.transportId) return { ok: false, snapshot: window.backendTest.snapshot, error: 'Stale test transport' }
        return { ok: true, snapshot: window.backendTest.snapshot, filePreview: { kind: 'audio' } }
      }
      const reply = await original(r)
      if (r.type === 'files.list' && r.location.kind === 'device' && reply.ok && reply.fileListing) reply.fileListing.entries = ['First.mp3', 'Second.mp3'].map((name, i) => ({ name, path: '/sdcard/Music/' + name, kind: 'file', size: 1234, modified: 1791442800000, fingerprint: 'audio-' + i }))
      return reply
    }
  }, failDuringOpen)
  const panel = page.getByRole('region', { name: 'Right file panel', exact: true })
  await panel.getByRole('combobox', { name: 'right source', exact: true }).selectOption('wifi:physical-phone')
  await expect(panel.getByRole('row', { name: 'First.mp3', exact: true })).toBeVisible()
  return panel
}

test('audio opening and next-track reads resolve the original phone without redirecting existing playback', async ({ page }) => {
  const panel = await setupPhoneAudio(page)
  await page.evaluate(() => {
    const connection = window.backendTest.snapshot.connection
    Object.assign(connection.devices[0], { serial: '192.168.1.2:5000', transportId: '7' })
    window.backendTest.emit({ type: 'connection', connection: structuredClone(connection) })
  })
  await panel.getByRole('row', { name: 'First.mp3', exact: true }).dblclick()
  const viewer = page.getByRole('dialog', { name: 'First.mp3', exact: true })
  await expect(viewer.locator('audio')).toBeVisible()
  const previews = async () => (await requests(page)).filter((r): r is Extract<BackendRequest, { type: 'files.preview' }> => r.type === 'files.preview')
  expect((await previews())[0]).toMatchObject({ fingerprint: 'audio-0', location: { id: 'wifi:physical-phone', hardwareId: 'physical-phone', transportId: '7', serial: '192.168.1.2:5000', path: '/sdcard/Music/First.mp3' } })
  await page.evaluate(() => {
    const connection = window.backendTest.snapshot.connection
    connection.devices[0].transportId = '9'
    connection.devices.push({ ...connection.devices[0], id: 'other', hardwareId: 'other-phone', serial: 'OTHER', transportId: '10' })
    connection.activeDeviceId = 'other'
    window.backendTest.emit({ type: 'connection', connection: structuredClone(connection) })
  })
  await expect(viewer.locator('audio')).toBeVisible(); expect(await previews()).toHaveLength(1)
  await viewer.getByRole('button', { name: 'Next file', exact: true }).click()
  const second = page.getByRole('dialog', { name: 'Second.mp3', exact: true })
  await expect(second.locator('audio')).toBeVisible()
  expect((await previews())[1]).toMatchObject({ fingerprint: 'audio-1', location: { id: 'wifi:physical-phone', transportId: '9', path: '/sdcard/Music/Second.mp3' } })
  await page.evaluate(() => {
    const connection = window.backendTest.snapshot.connection
    connection.devices[0].hardwareId = 'replacement-phone'
    window.backendTest.emit({ type: 'connection', connection: structuredClone(connection) })
  })
  await second.getByRole('button', { name: 'Previous file', exact: true }).click()
  await expect(viewer.getByRole('alert')).toContainText('identity cannot be confirmed')
  expect(await previews()).toHaveLength(2)
  expect((await requests(page)).some(r => r.type === 'files.enqueue')).toBe(false)
})

test('a connection change during preview offers an explicit retry with a new pinned request', async ({ page }) => {
  const panel = await setupPhoneAudio(page, true)
  await panel.getByRole('row', { name: 'First.mp3', exact: true }).dblclick()
  const viewer = page.getByRole('dialog', { name: 'First.mp3', exact: true })
  await expect(viewer.getByRole('alert')).toContainText('Retry preview to read it again from the same phone')
  const initial = (await requests(page)).filter((r): r is Extract<BackendRequest, { type: 'files.preview' }> => r.type === 'files.preview')
  expect(initial).toHaveLength(1)
  await viewer.getByRole('button', { name: 'Retry preview', exact: true }).click()
  await expect(viewer.locator('audio')).toBeVisible()
  const previews = (await requests(page)).filter((r): r is Extract<BackendRequest, { type: 'files.preview' }> => r.type === 'files.preview')
  expect(previews).toHaveLength(2); expect(previews[1].requestId).not.toBe(previews[0].requestId)
  expect(previews[0].location.transportId).toBe('2'); expect(previews[1].location.transportId).toBe('8')
  expect(previews[1].fingerprint).toBe(previews[0].fingerprint)
  expect((await requests(page)).some(r => r.type === 'files.preview.close' && r.requestId === previews[0].requestId)).toBe(true)
})

async function playablePhoneAudio(page: Page) {
  const panel = await setupPhoneAudio(page)
  // Generated silent PCM fixture: real browser playback, no user's media.
  const wav = Buffer.alloc(44 + 8000 * 2 * 30)
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
  wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40)
  await page.route('**/test-audio.wav?*', route => route.fulfill({ contentType: 'audio/wav', body: wav }))
  await page.evaluate(() => {
    const original = window.desktop!.request
    window.desktop!.request = async r => {
      const reply = await original(r)
      if (r.type === 'files.preview' && reply.ok) {
        await new Promise(resolve => setTimeout(resolve, 150))
        return { ...reply, filePreview: { kind: 'audio' as const, url: `/test-audio.wav?${r.requestId}` } }
      }
      return reply
    }
  })
  return panel
}

test('video viewer enters fullscreen and returns to the open preview', async ({ page }) => {
  await setup(page)
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90
    const stream = canvas.captureStream(0), recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' }), chunks: Blob[] = []
    recorder.ondataavailable = e => chunks.push(e.data)
    const done = new Promise<void>(resolve => { recorder.onstop = () => resolve() })
    recorder.start()
    for (let i = 0; i < 6; i++) { canvas.getContext('2d')!.fillStyle = i % 2 ? '#227d62' : '#acdaca'; canvas.getContext('2d')!.fillRect(0, 0, 160, 90); (stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack).requestFrame(); await new Promise(resolve => setTimeout(resolve, 100)) }
    recorder.stop(); await done; stream.getTracks().forEach(t => t.stop())
    return [...new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer())]
  })
  await page.route('**/test-video.webm', route => route.fulfill({ contentType: 'video/webm', body: Buffer.from(bytes) }))
  await page.evaluate(() => {
    const original = window.desktop!.request
    window.desktop!.request = async r => {
      const reply = await original(r)
      if (r.type === 'files.list' && reply.ok && reply.fileListing) reply.fileListing.entries = [{ name: 'Movie.webm', path: 'C:\\Downloads\\Movie.webm', kind: 'file', size: 500, modified: 1, fingerprint: 'video' }]
      if (r.type === 'files.preview' && reply.ok) return { ...reply, filePreview: { kind: 'video' as const, url: '/test-video.webm' } }
      return reply
    }
  })
  const panel = page.getByRole('region', { name: 'Left file panel', exact: true })
  await panel.getByRole('button', { name: 'Refresh left panel', exact: true }).click()
  await panel.getByRole('row', { name: 'Movie.webm', exact: true }).dblclick()
  const viewer = page.getByRole('dialog', { name: 'Movie.webm', exact: true })
  await expect.poll(() => viewer.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2)
  await viewer.getByRole('button', { name: 'Video fullscreen', exact: true }).click()
  await expect.poll(() => viewer.locator('video').evaluate(v => document.fullscreenElement === v)).toBe(true)
  await page.keyboard.press('Escape')
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true)
  await expect(viewer).toBeVisible()
  await viewer.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(viewer).toHaveCount(0)
  await expect.poll(async () => (await requests(page)).filter(r => r.type === 'files.preview.close').length).toBe(1)
})

test('audio starts on opening and stays playing in the same session when minimized and expanded', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 740 })
  const panel = await playablePhoneAudio(page)
  await panel.getByRole('row', { name: 'First.mp3', exact: true }).dblclick()
  const viewer = page.getByRole('dialog', { name: 'First.mp3', exact: true }), audio = viewer.locator('audio')
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => !a.paused && a.currentTime > 0)).toBe(true)
  const box = (await viewer.boundingBox())!
  expect(box.width).toBeLessThanOrEqual(620); expect(box.height).toBeLessThan(360)
  await page.screenshot({ path: 'test-results/audio-compact.png' })
  const element = (await audio.elementHandle())!
  await audio.evaluate((a: HTMLAudioElement) => { a.currentTime = 5 })
  await viewer.getByRole('button', { name: 'Minimize audio player', exact: true }).click()
  expect(await viewer.evaluate(e => e.matches(':modal'))).toBe(false)
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => !a.paused && a.currentTime > 5)).toBe(true)
  expect(await audio.evaluate((a, original) => a === original, element)).toBe(true)
  expect((await viewer.boundingBox())!.height).toBeLessThan(100)
  expect(await viewer.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/audio-mini.png' })
  await panel.locator('.fm-list').focus(); await page.keyboard.press('ArrowDown')
  expect((await requests(page)).filter(r => r.type === 'files.preview')).toHaveLength(1)
  expect((await requests(page)).filter(r => r.type === 'files.preview.close')).toHaveLength(0)
  await viewer.getByRole('button', { name: 'Expand audio player', exact: true }).click()
  expect(await viewer.evaluate(e => e.matches(':modal'))).toBe(true)
  expect(await audio.evaluate((a, original) => a === original, element)).toBe(true)
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => !a.paused && a.currentTime > 5)).toBe(true)
  await viewer.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(viewer).toHaveCount(0)
  expect(await element.evaluate((a: HTMLAudioElement) => a.paused)).toBe(true)
  await expect.poll(async () => (await requests(page)).filter(r => r.type === 'files.preview.close').length).toBe(1)
})

test('mini-player next track autoplays, another double-click replaces it, and leaving Files closes the session', async ({ page }) => {
  const panel = await playablePhoneAudio(page)
  await panel.getByRole('row', { name: 'First.mp3', exact: true }).dblclick()
  const viewer = page.locator('.file-viewer')
  await expect.poll(() => viewer.locator('audio').evaluate((a: HTMLAudioElement) => !a.paused && a.currentTime > 0)).toBe(true)
  await viewer.getByRole('button', { name: 'Minimize audio player', exact: true }).click()
  await viewer.getByRole('button', { name: 'Next file', exact: true }).click()
  await expect(viewer).toHaveAccessibleName('Second.mp3')
  await expect.poll(() => viewer.locator('audio').evaluate((a: HTMLAudioElement) => !a.paused && a.currentTime > 0)).toBe(true)
  const previous = (await viewer.locator('audio').elementHandle())!
  await panel.getByRole('row', { name: 'First.mp3', exact: true }).dblclick()
  await expect(viewer).toHaveAccessibleName('First.mp3')
  await expect(page.locator('audio')).toHaveCount(1)
  await expect.poll(() => viewer.locator('audio').evaluate((a: HTMLAudioElement) => !a.paused && a.currentTime > 0)).toBe(true)
  expect(await previous.evaluate((a: HTMLAudioElement) => a.paused && !a.isConnected)).toBe(true)
  expect((await requests(page)).filter(r => r.type === 'files.preview')).toHaveLength(3)
  await expect.poll(async () => (await requests(page)).filter(r => r.type === 'files.preview.close').length).toBe(2)
  await viewer.getByRole('button', { name: 'Minimize audio player', exact: true }).click()
  const current = (await viewer.locator('audio').elementHandle())!
  await page.getByRole('navigation').getByRole('button', { name: 'Apps', exact: true }).click()
  await expect(viewer).toHaveCount(0)
  expect(await current.evaluate((a: HTMLAudioElement) => a.paused)).toBe(true)
  await expect.poll(async () => (await requests(page)).filter(r => r.type === 'files.preview.close').length).toBe(3)
})

test('mini-player keeps connection errors and retry accessible without blocking the panels', async ({ page }) => {
  const panel = await setupPhoneAudio(page, true)
  await panel.getByRole('row', { name: 'First.mp3', exact: true }).dblclick()
  const viewer = page.getByRole('dialog', { name: 'First.mp3', exact: true })
  await expect(viewer.getByRole('alert')).toContainText('Retry preview')
  await viewer.getByRole('button', { name: 'Minimize audio player', exact: true }).click()
  await expect(viewer.getByRole('alert')).toBeVisible()
  await viewer.getByRole('button', { name: 'Retry preview', exact: true }).click()
  await expect(viewer.locator('audio')).toBeVisible()
  await viewer.getByRole('button', { name: 'Close audio player', exact: true }).click()
  await expect(viewer).toHaveCount(0)
  await expect.poll(async () => (await requests(page)).filter(r => r.type === 'files.preview.close').length).toBe(2)
})


test('Ctrl+X marks files as cut; cancelling paste keeps them and confirming submits move', async ({ page }) => {
  await setup(page)
  const left = page.getByRole('region', { name: 'Left file panel', exact: true }), row = left.getByRole('row', { name: 'Notes.txt', exact: true })
  await row.click(); await page.getByRole('region', { name: 'left folder contents', exact: true }).press('Control+x')
  await expect(row).toHaveClass(/cut/)
  const right = page.getByRole('region', { name: 'right folder contents', exact: true })
  await right.press('Control+v'); const dialog = page.getByRole('dialog', { name: 'Move · 1 object' })
  await expect(dialog).toBeVisible(); await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await requests(page)).filter(r => r.type === 'files.clipboard.paste')).toHaveLength(0)
  await expect(row).toHaveClass(/cut/)
  await right.press('Control+v'); await dialog.getByRole('button', { name: 'Move', exact: true }).click()
  await expect(dialog).toHaveCount(0); await expect(row).not.toHaveClass(/cut/)
  expect((await requests(page)).find(r => r.type === 'files.clipboard.write')).toMatchObject({ mode: 'move' })
  expect((await requests(page)).filter(r => r.type === 'files.clipboard.paste')).toHaveLength(1)
})

test('Paste reads Explorer files even without an internal selection and reports a changed clipboard', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => {
    const original = window.desktop!.request
    window.desktop!.request = async r => {
      if (r.type === 'files.clipboard.read') return { ok: true, snapshot: window.backendTest.snapshot, fileClipboard: { token: 'explorer', mode: 'copy', groups: [
        { source: { kind: 'local', path: 'D:\\Music' }, entries: [{ name: 'song.mp3', path: 'D:\\Music\\song.mp3', kind: 'file', fingerprint: 'song', size: 100, modified: 1 }] },
        { source: { kind: 'local', path: 'D:\\Photos' }, entries: [{ name: 'photo.jpg', path: 'D:\\Photos\\photo.jpg', kind: 'file', fingerprint: 'photo', size: 100, modified: 1 }] },
      ] } }
      if (r.type === 'files.clipboard.paste') return { ok: false, snapshot: window.backendTest.snapshot, error: 'The clipboard changed. Paste again to review the new selection.' }
      return original(r)
    }
  })
  const right = page.getByRole('region', { name: 'Right file panel', exact: true })
  await right.getByRole('button', { name: 'right file actions', exact: true }).click()
  await right.getByRole('button', { name: 'Paste · Ctrl+V', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Copy · 2 objects' })
  await expect(dialog).toContainText('Windows clipboard · 2 source folders')
  await dialog.getByRole('button', { name: 'Copy', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('clipboard changed')
  expect((await requests(page)).filter(r => r.type === 'files.enqueue')).toHaveLength(0)
})

test('phone Copy starts preparation without a separate command and Paste shows progress while it runs', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => {
    const original = window.desktop!.request
    window.desktop!.request = async r => {
      const reply = await original(r)
      if (reply.ok && reply.fileClipboard && ['files.clipboard.write', 'files.clipboard.read'].includes(r.type)) reply.fileClipboard.preparationTaskId = 'preparing'
      return reply
    }
  })
  const right = page.getByRole('region', { name: 'Right file panel', exact: true })
  await right.getByRole('row', { name: 'Manual.pdf', exact: true }).click()
  await right.getByRole('button', { name: 'right file actions', exact: true }).click()
  await expect(right.getByRole('button', { name: 'Copy to Windows clipboard…', exact: true })).toHaveCount(0)
  await right.getByRole('button', { name: 'Copy · Ctrl+C', exact: true }).click()
  await page.getByRole('region', { name: 'left folder contents', exact: true }).press('Control+v')
  await expect(page.getByRole('complementary', { name: 'File tasks', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect((await requests(page)).find(r => r.type === 'files.clipboard.write')).toMatchObject({ selection: { source: { id: 'phone', transportId: '2' }, items: [{ path: '/sdcard/Manual.pdf' }] } })
})

test('folder conflict offers Merge with a separate folder rule and no directory Replace', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => {
    window.backendTest.emit({ type: 'files', state: { revision: 2, tasks: [{ id: 'merge', action: 'copy', source: { kind: 'local', path: 'C:\\Downloads' }, destination: { kind: 'device', path: '/sdcard', id: 'phone', serial: 'PHONE', transportId: '2' }, status: 'conflict', createdAt: '', completed: 0, bytes: 0, current: 'Photos', pauseRequested: false, stopRequested: false, items: [{ path: 'C:\\Downloads\\Photos', status: 'running' }], conflict: { source: 'C:\\Downloads\\Photos', destination: '/sdcard/Photos', directory: true, mergeable: true } }] } })
  })
  const conflict = page.getByRole('group', { name: 'Existing destination', exact: true })
  await expect(conflict.getByRole('button', { name: 'Replace', exact: true })).toBeDisabled()
  await conflict.getByRole('checkbox', { name: 'Apply to remaining folder conflicts', exact: true }).check()
  await conflict.getByRole('button', { name: 'Merge folders', exact: true }).click()
  expect((await requests(page)).find(r => r.type === 'files.resolve')).toMatchObject({ id: 'merge', choice: 'merge', all: true })
})
