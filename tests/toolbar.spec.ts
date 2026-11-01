import { test, expect } from '@playwright/test'
import { installBackendFixture, connectionEvent } from './backend-fixture'

const phone = { id: 'phone', serial: '192.168.1.2:4444', name: 'Test phone', method: 'Wi-Fi' as const, status: 'connected' as const, android: '16', endpoint: '192.168.1.2:4444', lastSeen: '', known: true, canDetach: true, transportId: '7' }
test.beforeEach(async ({ page }) => {
  await installBackendFixture(page); await page.goto('/')
  await connectionEvent(page, { activeDeviceId: 'phone', devices: [phone] })
})

test('overflow preserves chosen order, fits one row, and restores actions when space returns', async ({ page }) => {
  test.setTimeout(60_000)
  const order = ['workspace', 'screenshot', 'logcat', 'bugreport', 'tasks', 'activity', 'connection', 'mirror']
  await page.evaluate(pinned => localStorage.setItem('adb-vault-toolbar', JSON.stringify({ state: { pinned, operationPosition: 'end' }, version: 1 })), order)
  await page.reload(); await connectionEvent(page, { activeDeviceId: 'phone', devices: [phone] })
  const toolbar = page.getByLabel('Workspace toolbar'), menu = page.getByRole('dialog', { name: 'Toolbar actions', exact: true })
  for (const width of [1920, 1000, 900, 1440]) {
    await page.setViewportSize({ width, height: 940 })
    await expect.poll(async () => toolbar.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await toolbar.getByRole('button', { name: 'More toolbar actions', exact: true }).click()
    await expect(menu).toBeVisible()
    const shown = await toolbar.locator('[data-toolbar-action]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-toolbar-action')))
    const overflow = await menu.locator('[aria-label="Pinned actions"] [data-overflow-action]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-overflow-action')))
    expect([...shown, ...overflow]).toEqual(order)
    expect((await toolbar.boundingBox())!.height).toBe(46)
    const moreBox = (await toolbar.getByRole('button', { name: 'More toolbar actions', exact: true }).boundingBox())!
    const toolbarBox = (await toolbar.boundingBox())!
    expect(Math.abs(toolbarBox.x + toolbarBox.width - moreBox.x - moreBox.width - 12)).toBeLessThan(1)
    for (const item of await toolbar.locator('[data-toolbar-action]').all()) expect((await item.boundingBox())!.y).toBe(moreBox.y)
    await page.keyboard.press('Escape'); await expect(menu).not.toBeVisible()
    await toolbar.screenshot({ path: `test-results/unified-toolbar-overflow-${width}.png` })
  }
})

test('Connected card can be hidden in every workspace and phone selection remains in overflow', async ({ page }) => {
  const toolbar = page.getByLabel('Workspace toolbar')
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = page.getByRole('group', { name: 'Status bar', exact: true })
  await settings.getByRole('checkbox', { name: /Show Connected phone card/ }).uncheck()
  for (const section of ['Components', 'Apps', 'Files', 'Monitor', 'Activity', 'Connection']) {
    await page.getByRole('navigation').getByRole('button', { name: section, exact: true }).click()
    await expect(toolbar.locator('.toolbar-device')).toHaveCount(0)
    expect((await toolbar.boundingBox())!.height).toBe(46)
  }
  await page.reload(); await connectionEvent(page, { activeDeviceId: 'phone', devices: [phone] })
  await expect(toolbar.locator('.toolbar-device')).toHaveCount(0)
  await toolbar.getByRole('button', { name: 'More toolbar actions', exact: true }).click()
  const menu = page.getByRole('dialog', { name: 'Toolbar actions', exact: true })
  await expect(menu.getByRole('button', { name: 'Select phone', exact: true })).toContainText('Test phone')
  await menu.getByRole('button', { name: 'Select phone', exact: true }).click()
  await expect(menu).not.toBeVisible()
  const phones = page.getByRole('dialog', { name: 'Select a phone', exact: true })
  await expect(phones).toBeVisible()
  await phones.getByRole('button', { name: /Test phone/ }).click()
  await expect(phones).not.toBeVisible()
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click()
  await settings.getByRole('button', { name: 'Reset status bar', exact: true }).click()
  await expect(toolbar.locator('.toolbar-device')).toBeVisible()
})

test('new screen actions are pinnable, preserve order, and open the requested mode before any capture', async ({ page }) => {
  await page.evaluate(() => window.backendTest.emit({ type: 'components', components: window.backendTest.snapshot.components.map(c => c.id === 'scrcpy' ? { ...c, status: 'Installed', location: 'C:/scrcpy' } : c) }))
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = page.getByRole('group', { name: 'Status bar', exact: true })
  for (const name of ['Screen & recording', 'Virtual display', 'Camera', 'Camera controls', 'Wake screen', 'Sleep screen']) {
    await settings.getByRole('button', { name: `Pin ${name}`, exact: true }).click()
  }
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('adb-vault-toolbar')!).state.pinned)).toEqual(['workspace', 'screenshot', 'screenOptions', 'virtualDisplay', 'camera', 'cameraControls', 'wake', 'sleep'])
  await page.setViewportSize({ width: 900, height: 900 })
  const toolbar = page.getByLabel('Workspace toolbar'), menu = page.getByRole('dialog', { name: 'Toolbar actions', exact: true })
  for (const [action, mode] of [['Virtual display', 'Virtual display'], ['Camera', 'Camera'], ['Screen & recording', 'Phone screen']]) {
    await toolbar.getByRole('button', { name: 'More toolbar actions', exact: true }).click()
    await menu.getByRole('button', { name: action, exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Screen & recording', exact: true })
    await expect(dialog.getByRole('button', { name: mode, exact: true })).toHaveAttribute('aria-pressed', 'true')
    if (mode === 'Virtual display') await expect(dialog.getByRole('button', { name: 'Start', exact: true })).toBeDisabled()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  }
  expect(await page.evaluate(() => window.backendTest.requests.some(r => r.type === 'connection.screen'))).toBe(false)
  for (const action of ['Wake screen', 'Sleep screen']) {
    await toolbar.getByRole('button', { name: 'More toolbar actions', exact: true }).click()
    await menu.getByRole('button', { name: action, exact: true }).click()
  }
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'connection.screen'))).toEqual(['wake', 'sleep'].map(action => ({ type: 'connection.screen', id: phone.id, serial: phone.serial, transportId: phone.transportId, action })))
  await toolbar.getByRole('button', { name: 'More toolbar actions', exact: true }).click()
  await expect(menu.getByRole('button', { name: 'Camera controls', exact: true })).toBeDisabled()
  await page.evaluate(() => window.backendTest.emit({ type: 'screenSessions', sessions: [
    { id: 'camera-other', deviceId: 'other', deviceName: 'Other phone', mode: 'camera', startedAt: new Date().toISOString() },
    { id: 'camera-selected', deviceId: 'phone', deviceName: 'Test phone', mode: 'camera', startedAt: new Date().toISOString() },
  ] }))
  await menu.getByRole('button', { name: 'Camera controls', exact: true }).click()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'connection.cameraPanel'))).toEqual([{ type: 'connection.cameraPanel', sessionId: 'camera-selected' }])
})

test('pin order supports dragging, keyboard movement, persistence and operation placement', async ({ page }) => {
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = page.getByRole('group', { name: 'Status bar', exact: true })
  await settings.getByRole('button', { name: 'Pin File tasks', exact: true }).click()
  await settings.getByRole('button', { name: 'Drag File tasks', exact: true }).dragTo(settings.locator('li[data-action-id="workspace"]'))
  await expect(settings.locator('li').first()).toHaveAttribute('data-action-id', 'tasks')
  await settings.getByRole('button', { name: 'Drag Screenshot', exact: true }).press('ArrowUp')
  await expect(settings.locator('li').nth(1)).toHaveAttribute('data-action-id', 'screenshot')
  await settings.getByLabel('Operations position').selectOption('start')
  await page.reload()
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('adb-vault-toolbar')!).state.pinned)).toEqual(['tasks', 'screenshot', 'workspace'])
  const toolbar = page.getByLabel('Workspace toolbar'), area = page.getByLabel('Workspace operations')
  const before = (await area.boundingBox())!
  expect((await toolbar.getByRole('button', { name: 'More toolbar actions', exact: true }).boundingBox())!.x).toBeGreaterThan(before.x + before.width)
  expect(before.x).toBeLessThan((await toolbar.getByRole('button', { name: 'Select phone', exact: true }).boundingBox())!.x)
  await page.evaluate(() => window.backendTest.emit({ type: 'apps', apps: { ...window.backendTest.snapshot.apps, deviceId: 'phone', status: 'loading', message: 'Reading applications', progress: { completed: 148, total: 520 } } }))
  await expect(area.getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(148 / 520 * 100))
  expect((await area.boundingBox())!.width).toBe(before.width)
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click()
  await settings.getByLabel('Operations position').selectOption('end')
  expect((await area.boundingBox())!.x).toBeGreaterThan((await toolbar.getByRole('button', { name: 'Select phone', exact: true }).boundingBox())!.x)
  const operationBox = (await area.boundingBox())!
  expect((await toolbar.getByRole('button', { name: 'More toolbar actions', exact: true }).boundingBox())!.x).toBeGreaterThan(operationBox.x + operationBox.width)
  await page.screenshot({ path: 'test-results/unified-toolbar-settings.png' })
})

test('phone and overflow menus toggle on repeated clicks, keyboard and outside dismissal', async ({ page }) => {
  const toolbar = page.getByLabel('Workspace toolbar')
  const phoneButton = toolbar.getByRole('button', { name: 'Select phone', exact: true })
  const more = toolbar.getByRole('button', { name: 'More toolbar actions', exact: true })
  const phoneMenu = page.getByRole('dialog', { name: 'Select a phone', exact: true })
  const actions = page.getByRole('dialog', { name: 'Toolbar actions', exact: true })
  const before = await page.evaluate(() => window.backendTest.requests.length)
  for (const target of [phoneButton.locator('strong'), phoneButton.locator('svg').last()]) {
    await target.click()
    await expect(phoneMenu).toBeVisible()
    await expect(phoneButton).toHaveAttribute('aria-expanded', 'true')
    await target.click()
    await expect(phoneMenu).not.toBeVisible()
    await expect(phoneButton).toHaveAttribute('aria-expanded', 'false')
  }
  await phoneButton.focus(); await page.keyboard.press('Enter')
  await expect(phoneMenu).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(phoneMenu).not.toBeVisible()
  await phoneButton.click(); await more.click()
  await expect(phoneMenu).not.toBeVisible()
  await expect(actions).toBeVisible()
  await more.click()
  await expect(actions).not.toBeVisible()
  await phoneButton.click(); await page.keyboard.press('Escape')
  await expect(phoneMenu).not.toBeVisible()
  await expect(phoneButton).toHaveAttribute('aria-expanded', 'false')
  await phoneButton.click(); await page.locator('.titlebar-subtitle').click()
  await expect(phoneMenu).not.toBeVisible()
  expect(await page.evaluate(() => window.backendTest.requests.length)).toBe(before)
})

test('profile is one full-size control and Apps action buttons match card height', async ({ page }) => {
  await page.getByRole('navigation').getByRole('button', { name: 'Apps', exact: true }).click()
  await page.evaluate(() => window.backendTest.emit({ type: 'apps', apps: { ...window.backendTest.snapshot.apps, deviceId: 'phone', userId: 0, currentUserId: 0, status: 'ready', profiles: [{ id: 0, name: 'Owner', managed: false, running: true }, { id: 10, name: 'Work', managed: true, running: true }] } }))
  const toolbar = page.getByLabel('Workspace toolbar')
  const picker = toolbar.locator('.toolbar-profile-slot .apps-profile-picker')
  const select = picker.getByLabel('Android profile', { exact: true })
  const card = (await picker.boundingBox())!
  expect(await select.boundingBox()).toEqual(card)
  expect(card.height).toBe(38)
  await expect(picker.locator('.apps-profile-icon')).not.toHaveAttribute('tabindex')
  // Both the glyph and arrow are decorations above the same native select.
  for (const glyph of ['.apps-profile-icon', '.apps-profile-chevron']) {
    expect(await picker.locator(glyph).evaluate(el => {
      const box = el.getBoundingClientRect()
      return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.tagName
    })).toBe('SELECT')
  }
  for (const button of await page.locator('.apps-query-actions .button:visible').all()) expect((await button.boundingBox())!.height).toBe(card.height)
  expect((await page.locator('.apps-query-toolbar .component-search').boundingBox())!.height).toBe(card.height)
  await select.focus()
  await expect(select).toHaveCSS('outline-style', 'solid')
  await select.selectOption('10')
  await expect.poll(() => page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'apps.selectProfile').at(-1))).toEqual({ type: 'apps.selectProfile', id: 'phone', userId: 10 })
  await expect(select).toHaveValue('10')
  await page.screenshot({ path: 'test-results/toolbar-unified-profile.png' })
  await page.setViewportSize({ width: 900, height: 680 })
  await page.getByRole('button', { name: 'Left sidebar: expanded; show icons' }).click()
  await page.getByRole('button', { name: 'Left sidebar: icons; expand' }).click()
  expect(await toolbar.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
})

test('quick actions use the selected phone and never redirect to another connected phone', async ({ page }) => {
  const toolbar = page.getByLabel('Workspace toolbar')
  await toolbar.getByRole('button', { name: 'Screenshot', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.backendTest.requests.filter(request => request.type === 'connection.screen'))).toEqual([{ type: 'connection.screen', id: phone.id, serial: phone.serial, transportId: phone.transportId, action: 'screenshot' }])
  // Losing the selected phone must not redirect a quick action to another one.
  // A connected selectedDeviceId remains usable even when activeDeviceId is null.
  await connectionEvent(page, { activeDeviceId: null, devices: [{ ...phone, status: 'disconnected' }, { ...phone, id: 'second', name: 'Second phone' }] })
  await expect(toolbar.getByRole('button', { name: 'Screenshot', exact: true })).toBeDisabled()
  await toolbar.getByRole('button', { name: 'Select phone', exact: true }).click()
  await page.getByRole('dialog', { name: 'Select a phone', exact: true }).getByRole('button', { name: /Second phone/ }).click()
  await expect(toolbar.getByRole('button', { name: 'Select phone', exact: true })).toContainText('Second phone')
  await toolbar.getByRole('button', { name: 'More toolbar actions', exact: true }).click()
  await page.getByRole('dialog', { name: 'Toolbar actions', exact: true }).getByRole('button', { name: 'Android logs', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Android logs · Logcat', exact: true })).toContainText('Second phone')
  expect(await page.evaluate(() => window.backendTest.requests.some(request => request.type === 'androidDiagnostics.start'))).toBe(false)
})

test('malformed saved actions are normalized and customization cannot start an operation', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('adb-vault-toolbar', JSON.stringify({ state: { pinned: ['tasks', 'not-real', 'tasks', null], operationPosition: 'invalid' }, version: 1 })))
  await page.reload()
  const toolbar = page.getByLabel('Workspace toolbar')
  await expect(toolbar.locator('[data-toolbar-action]')).toHaveCount(1)
  await expect(toolbar.locator('[data-toolbar-action]')).toHaveAttribute('data-toolbar-action', 'tasks')
  await expect(toolbar).toHaveAttribute('data-operation-position', 'end')
  const before = await page.evaluate(() => window.backendTest.requests.length)
  await toolbar.getByRole('button', { name: 'More toolbar actions', exact: true }).click()
  await page.getByRole('button', { name: 'Customize status bar…', exact: true }).click()
  await expect(page.getByRole('group', { name: 'Status bar', exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.backendTest.requests.length)).toBe(before)
})

test('mini cards expose descriptions on hover and focus, filter and pin without running commands', async ({ page }) => {
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = page.getByRole('group', { name: 'Status bar', exact: true })
  const before = await page.evaluate(() => window.backendTest.requests.length)
  const card = settings.getByRole('button', { name: 'Pin Virtual display', exact: true })
  // Scrolling closes tooltips. Finish scrolling the settings pane before hovering.
  await card.scrollIntoViewIfNeeded()
  await card.hover()
  const hint = page.getByRole('tooltip', { name: 'Choose an application for a separate Android window.', exact: true })
  await expect(hint).toBeVisible()
  await page.mouse.move(0, 0); await expect(hint).not.toBeVisible()
  await card.focus(); await expect(hint).toBeVisible()
  await card.press('Escape'); await expect(hint).not.toBeVisible()
  await card.click()
  await expect(settings.getByRole('list', { name: 'Toolbar action order' }).getByText('Virtual display', { exact: true })).toBeVisible()
  await settings.getByRole('button', { name: 'Unpin Virtual display' }).click()
  await expect(card).toBeVisible()
  await settings.getByRole('searchbox').fill('logcat')
  await expect(settings.getByRole('button', { name: 'Pin Android logs', exact: true })).toBeVisible()
  await expect(card).toHaveCount(0)
  await settings.getByRole('searchbox').fill('no-such-action')
  await expect(settings.getByText('No matching actions.', { exact: true })).toBeVisible()
  await settings.getByRole('searchbox').clear()
  const addLabels = await settings.getByRole('button', { name: /^Pin / }).evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')!))
  for (const label of addLabels) await settings.getByRole('button', { name: label, exact: true }).click()
  await settings.getByRole('checkbox', { name: 'Sample operation' }).check()
  await settings.getByLabel('Operations position').selectOption('start')
  const preview = settings.getByRole('group', { name: 'Status bar preview' })
  await preview.getByRole('button', { name: 'Preview overflow' }).click()
  const overflow = page.getByRole('dialog', { name: 'Preview overflow actions' })
  await expect(overflow).toBeVisible()
  const shown = await preview.locator('[data-preview-action]').evaluateAll(nodes => nodes.map(el => el.getAttribute('data-preview-action')))
  const hidden = await overflow.locator('[data-preview-overflow]').evaluateAll(nodes => nodes.map(el => el.getAttribute('data-preview-overflow')))
  expect([...shown, ...hidden]).toEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('adb-vault-toolbar')!).state.pinned))
  expect(await page.evaluate(() => window.backendTest.requests.length)).toBe(before)
  await page.keyboard.press('Escape')
})

test('workspace overrides persist independently and returning to shared uses the current shared layout', async ({ page }) => {
  const toolbar = page.getByLabel('Workspace toolbar')
  const settings = page.getByRole('group', { name: 'Status bar', exact: true })
  const nav = page.getByRole('navigation')
  await nav.getByRole('button', { name: 'Settings', exact: true }).click()
  await settings.getByLabel('Configure status bar for').selectOption('apps')
  await expect(settings.getByRole('checkbox', { name: 'Use shared settings' })).toBeChecked()
  await expect(settings.getByRole('button', { name: 'Pin Camera', exact: true })).toHaveCount(0)
  await settings.getByRole('checkbox', { name: 'Use shared settings' }).uncheck()
  await settings.getByRole('checkbox', { name: 'Show Connected phone card' }).uncheck()
  await settings.getByRole('button', { name: 'Pin Camera', exact: true }).click()
  await settings.getByLabel('Operations position').selectOption('start')
  await settings.getByLabel('Configure status bar for').selectOption('shared')
  await settings.getByRole('button', { name: 'Pin Android logs', exact: true }).click()
  await page.reload(); await connectionEvent(page, { activeDeviceId: 'phone', devices: [phone] })
  for (const section of ['Apps', 'Files', 'Connection', 'Apps']) {
    await nav.getByRole('button', { name: section, exact: true }).click()
    await expect(toolbar.locator('.toolbar-device')).toHaveCount(section === 'Apps' ? 0 : 1)
    await expect(toolbar).toHaveAttribute('data-operation-position', section === 'Apps' ? 'start' : 'end')
  }
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('adb-vault-toolbar')!).state)
  expect(saved.pinned).toEqual(['workspace', 'screenshot', 'logcat'])
  expect(saved.overrides.apps).toEqual({ pinned: ['workspace', 'screenshot', 'camera'], operationPosition: 'start', showDevice: false })
  await nav.getByRole('button', { name: 'Settings', exact: true }).click()
  // Resetting shared settings preserves the independent Apps layout.
  await settings.getByRole('button', { name: 'Reset status bar' }).click()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('adb-vault-toolbar')!).state.overrides.apps)).toEqual(saved.overrides.apps)
  await settings.getByRole('button', { name: 'Pin Android logs', exact: true }).click()
  await settings.getByLabel('Configure status bar for').selectOption('apps')
  await settings.getByRole('checkbox', { name: 'Use shared settings' }).check()
  await nav.getByRole('button', { name: 'Apps', exact: true }).click()
  await expect(toolbar.locator('.toolbar-device')).toBeVisible()
  await expect(toolbar).toHaveAttribute('data-operation-position', 'end')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('adb-vault-toolbar')!).state.overrides.apps)).toBeUndefined()
})

test('customization fits narrow windows, matches appearance choices and keeps preview inert', async ({ page }) => {
  test.setTimeout(60_000)
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = page.getByRole('group', { name: 'Status bar', exact: true })
  await settings.getByRole('button', { name: 'Pin Camera', exact: true }).click()
  await settings.getByRole('checkbox', { name: 'Sample operation' }).check()
  for (const width of [1440, 1000, 900]) {
    await page.setViewportSize({ width, height: 940 })
    await expect.poll(() => settings.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await expect.poll(() => settings.getByRole('group', { name: 'Status bar preview' }).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  }
  await page.setViewportSize({ width: 1440, height: 1100 })
  await settings.getByRole('radio', { name: 'Icons only' }).check()
  await expect(settings.locator('[data-preview-action].with-label')).toHaveCount(0)
  await settings.getByRole('radio', { name: 'Icon and text' }).check()
  await page.mouse.move(0, 0)
  await settings.screenshot({ path: 'test-results/toolbar-cards-light.png' })
  await page.evaluate(() => {
    localStorage.setItem('adb-vault-appearance', JSON.stringify({ state: { themeId: 'blue', terminalPinned: true, cornerStyle: 'square', zenMode: true }, version: 1 }))
  })
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-zen-mode', 'true')
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click()
  await settings.getByRole('checkbox', { name: 'Sample operation' }).check()
  await page.mouse.move(0, 0)
  await settings.screenshot({ path: 'test-results/toolbar-cards-terminal.png' })
})
