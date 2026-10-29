import { test, expect, type Page } from '@playwright/test'
import { installBackendFixture, connectionEvent } from './backend-fixture'

async function setup(page: Page) {
  await installBackendFixture(page); await page.goto('/')
  await connectionEvent(page, { activeDeviceId: 'phone', devices: [{ id: 'phone', serial: 'PHONE', transportId: '2', name: 'Redmi Note 4', android: '13', status: 'connected', method: 'USB', endpoint: 'PHONE', lastSeen: '', known: true, canDetach: false }] })
  await page.evaluate(() => {
    const original = window.desktop!.request
    window.backendTest.snapshot.apps.profiles = [{ id: 0, name: 'Owner', managed: false, running: true }, { id: 11, name: 'Work', managed: true, running: true }]
    window.desktop!.request = async request => {
      if (request.type === 'apps.installOpen' && request.files) {
        const reply = await original(request)
        if (reply.snapshot.restore) reply.snapshot.restore.applications = reply.snapshot.restore.applications.filter(a => request.files!.items.some(i => i.path.endsWith(a.label)))
        return reply
      }
      if (!request.type.startsWith('files.')) return original(request)
      window.backendTest.requests.push(request)
      if (request.type === 'files.storages') return { ok: true, snapshot: window.backendTest.snapshot, fileStorages: [] }
      if (request.type === 'files.list') {
        const location = { ...request.location, path: request.location.path || 'C:\\Downloads' }
        const names = ['Alpha.apk', 'Beta.apks', 'Notes.txt', 'Folder.apk']
        return { ok: true, snapshot: window.backendTest.snapshot, fileListing: { location, parent: location.kind === 'local' ? 'C:\\' : '/', entries: names.map(name => ({ name, path: location.path + (location.kind === 'device' ? '/' : '\\') + name, kind: name === 'Folder.apk' ? 'directory' : 'file', size: 1024, modified: 1000, fingerprint: 'fingerprint-' + name })) } }
      }
      return { ok: true, snapshot: window.backendTest.snapshot }
    }
  })
  await page.getByRole('navigation').getByRole('button', { name: 'Files', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Left file panel', exact: true }).getByRole('row', { name: 'Alpha.apk', exact: true })).toBeVisible()
}
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Install applications', exact: true })
const installerRequests = (page: Page) => page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'apps.installOpen'))

test('Files installs a mixed APK/APKS selection, loads the target in place, and can change profile before confirmation', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 740 }); await setup(page)
  const left = page.getByRole('region', { name: 'Left file panel', exact: true }), install = page.locator('.fm-commands').getByRole('button', { name: 'Install…', exact: true })
  await expect(install).toBeDisabled()
  await left.getByRole('row', { name: 'Alpha.apk', exact: true }).click()
  await left.getByRole('row', { name: 'Beta.apks', exact: true }).click({ modifiers: ['Control'] })
  await expect(install).toBeEnabled()
  await left.getByRole('row', { name: 'Notes.txt', exact: true }).click({ modifiers: ['Control'] }); await expect(install).toBeDisabled()
  await left.getByRole('row', { name: 'Notes.txt', exact: true }).click({ modifiers: ['Control'] })
  await install.click()
  await expect(dialog(page).getByRole('checkbox', { name: 'Install Alpha.apk', exact: true })).toBeChecked()
  await expect(dialog(page).getByRole('checkbox', { name: 'Install Beta.apks', exact: true })).toBeChecked()
  await expect(dialog(page).getByRole('button', { name: 'Choose files…' })).toHaveCount(0)
  await expect(page.locator('.fm-workspace')).toBeVisible()
  expect(await installerRequests(page)).toEqual([{ type: 'apps.installOpen', id: 'phone', userId: 0, files: { source: { kind: 'local', path: 'C:\\Downloads' }, items: [{ path: 'C:\\Downloads\\Alpha.apk', fingerprint: 'fingerprint-Alpha.apk' }, { path: 'C:\\Downloads\\Beta.apks', fingerprint: 'fingerprint-Beta.apks' }] } }])
  expect(await page.evaluate(() => window.backendTest.requests.some(r => r.type === 'apps.restoreBatch' || r.type === 'apps.restoreInstall'))).toBe(false)
  await dialog(page).getByRole('combobox', { name: 'Android profile' }).selectOption('11')
  await expect(dialog(page).getByRole('button', { name: 'Install selected (2)…' })).toBeDisabled()
  await dialog(page).getByRole('button', { name: 'Check selected files…' }).click()
  expect((await installerRequests(page)).at(-1)).toMatchObject({ userId: 11, files: { items: [{ path: 'C:\\Downloads\\Alpha.apk' }, { path: 'C:\\Downloads\\Beta.apks' }] } })
  await expect(dialog(page).getByRole('button', { name: 'Install selected (2)…' })).toBeEnabled()
  await page.screenshot({ path: 'test-results/files-install-selection.png' })
  await dialog(page).getByRole('button', { name: 'Install selected (2)…' }).click()
  expect(await page.evaluate(() => window.backendTest.requests.at(-1))).toEqual({ type: 'apps.restoreBatch', plan: { packages: ['org.example.alpha', 'org.example.beta'], components: ['apk'] } })
})

test('double-click APK and Enter on APKS open the installer; closing does not install', async ({ page }) => {
  await setup(page)
  const left = page.getByRole('region', { name: 'Left file panel', exact: true })
  await left.getByRole('row', { name: 'Alpha.apk', exact: true }).dblclick()
  await expect(dialog(page).getByRole('button', { name: 'Install selected (1)…' })).toBeEnabled()
  expect((await installerRequests(page))[0]).toMatchObject({ files: { items: [{ path: 'C:\\Downloads\\Alpha.apk' }] } })
  await dialog(page).getByRole('button', { name: 'Close', exact: true }).click()
  await left.getByRole('row', { name: 'Beta.apks', exact: true }).click()
  await page.getByRole('region', { name: 'left folder contents', exact: true }).press('Enter')
  await expect(dialog(page).getByRole('checkbox', { name: 'Install Beta.apks', exact: true })).toBeChecked()
  expect((await installerRequests(page)).at(-1)).toMatchObject({ files: { items: [{ path: 'C:\\Downloads\\Beta.apks' }] } })
  await page.keyboard.press('Escape')
  expect(await page.evaluate(() => window.backendTest.requests.some(r => ['files.open', 'apps.restoreBatch', 'apps.restoreInstall'].includes(r.type)))).toBe(false)
})

test('cancelling profile preparation prevents a late completed collection from opening installers', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => {
    const original = window.desktop!.request
    let finish: (() => void) | undefined
    window.desktop!.request = async request => {
      if (request.type === 'apps.refresh') {
        window.backendTest.emit({ type: 'apps', apps: { ...window.backendTest.snapshot.apps, status: 'loading', deviceId: request.id } })
        await new Promise<void>(resolve => { finish = resolve })
        return original(request)
      }
      if (request.type === 'apps.cancel') finish?.()
      return original(request)
    }
  })
  await page.getByRole('region', { name: 'Left file panel', exact: true }).getByRole('row', { name: 'Alpha.apk', exact: true }).dblclick()
  await expect(dialog(page).locator('.lattice-loader')).toBeVisible()
  await expect(dialog(page).getByRole('progressbar')).toHaveCount(0)
  await dialog(page).getByRole('button', { name: 'Cancel preparation', exact: true }).click()
  await expect(dialog(page).getByRole('alert')).toHaveText('Preparation cancelled. Nothing was installed.')
  expect(await installerRequests(page)).toHaveLength(0)
})

test('phone context menu sends the exact files and source transport, with no selection dropped', async ({ page }) => {
  await setup(page)
  const right = page.getByRole('region', { name: 'Right file panel', exact: true })
  await right.getByRole('row', { name: 'Alpha.apk', exact: true }).click()
  await right.getByRole('row', { name: 'Beta.apks', exact: true }).click({ modifiers: ['Control'] })
  await right.getByRole('row', { name: 'Beta.apks', exact: true }).click({ button: 'right' })
  await right.getByRole('group', { name: 'File commands' }).getByRole('button', { name: 'Install…', exact: true }).click()
  await expect(dialog(page).getByRole('button', { name: 'Install selected (2)…' })).toBeEnabled()
  expect((await installerRequests(page))[0]).toMatchObject({ files: { source: { kind: 'device', id: 'phone', serial: 'PHONE', transportId: '2', path: '/sdcard' }, items: [{ path: '/sdcard/Alpha.apk', fingerprint: 'fingerprint-Alpha.apk' }, { path: '/sdcard/Beta.apks', fingerprint: 'fingerprint-Beta.apks' }] } })
  await dialog(page).getByRole('button', { name: 'Close', exact: true }).click()
  await right.getByRole('row', { name: 'Folder.apk', exact: true }).click()
  await expect(page.locator('.fm-commands').getByRole('button', { name: 'Install…', exact: true })).toBeDisabled()
  await right.getByRole('row', { name: 'Alpha.apk', exact: true }).click()
  await connectionEvent(page, { activeDeviceId: null, devices: [] })
  await expect(page.locator('.fm-commands').getByRole('button', { name: 'Install…', exact: true })).toBeDisabled()
})
