// Public product images use the real renderer with synthetic data only.
import { expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { installBackendFixture, connectionEvent } from './backend-fixture'
import type { AndroidApp } from '../electron/apps-protocol'

export async function captureShowcase(page: Page) {
  await installBackendFixture(page)
  await page.addInitScript(() => {
    localStorage.setItem('adb-vault-tour-v1', 'seen')
    localStorage.setItem('adb-vault-appearance', JSON.stringify({ state: { themeId: 'air', density: 'compact', cornerStyle: 'rounded' }, version: 1 }))
  })
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await connectionEvent(page, { devices: [{ id: 'DEMO', serial: 'DEMO', name: 'Demo phone', status: 'connected', android: '16', method: 'USB', endpoint: 'DEMO', lastSeen: '', known: true, canDetach: false }], activeDeviceId: 'DEMO' })
  const names = ['Browser', 'Calculator', 'Calendar', 'Camera', 'Files', 'Gallery', 'Journal', 'Music', 'Notes', 'Recorder', 'Translator', 'Weather']
  const icons = await page.evaluate(async () => {
    const paths = ['M16 5a11 11 0 1 0 0 22a11 11 0 0 0 0-22 M5 16h22 M16 5c-6 7-6 15 0 22c6-7 6-15 0-22', 'M8 4h16v24H8z M11 8h10 M12 15h1 M19 15h1 M12 21h1 M19 21h1', 'M7 8h18v19H7z M7 13h18 M11 5v6 M21 5v6 M12 18h2 M19 18h2 M12 23h2', 'M5 10h22v16H5z M11 10l2-4h6l2 4 M21 18a5 5 0 1 0-10 0a5 5 0 0 0 10 0', 'M4 9h10l3 4h11v14H4z', 'M5 6h22v22H5z M5 23l7-8 5 5 4-4 6 8 M22 11h.1', 'M7 5h18v23H7z M11 11h10 M11 16h10 M11 21h6', 'M13 24V7l13-3v17 M13 10l13-3 M13 24c0 4-9 4-9 0s9-4 9 0 M26 21c0 4-9 4-9 0s9-4 9 0', 'M7 4h18v24H7z M11 10h10 M11 16h10 M11 22h6', 'M12 5h8v15h-8z M7 15v3a9 9 0 0 0 18 0v-3 M16 27v4', 'M4 8h15 M12 4v4 M7 8c1 7 5 11 11 14 M17 8c-1 7-5 11-11 14 M18 28l5-14 5 14 M20 23h6', 'M23 10a6 6 0 1 0-11 3 M10 25a6 6 0 1 1 1-12a7 7 0 1 1 12 12z']
    const colors = ['#3976df','#52647a','#d46566','#7d66ba','#d59938','#589c81','#8573c1','#da7b50','#4f96a3','#bf738d','#5e83ba','#c99b43']
    return Promise.all(paths.map(async (d, index) => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${colors[index]}"/><g transform="translate(4 4) scale(.75)" fill="none" stroke="white" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></g></svg>`
      const image = new Image(); image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 96; canvas.getContext('2d')!.drawImage(image, 0, 0)
      return canvas.toDataURL('image/png').split(',')[1]
    }))
  })
  const apps: AndroidApp[] = names.map((label, index) => ({ packageName: `org.example.${label.toLowerCase()}`, label, versionName: `${index % 3 + 1}.${index % 5}.0`, versionCode: index + 1, uid: 10001 + index, userId: 0, enabled: true, system: ['Camera', 'Calendar'].includes(label), updatedSystemApp: false, sourceDir: `/data/app/${label.toLowerCase()}/base.apk`, firstInstallTime: 1790841600000, lastUpdateTime: 1792656000000, targetSdk: 35, minSdk: 26, installer: 'com.android.packageinstaller', enabledState: 0, suspended: false, stopped: false, debuggable: false, iconPng: icons[index], apkSizeBytes: (index + 3) * 2450000, dataBytes: (index + 1) * 1320000, cacheBytes: (index + 1) * 120000, storageRequested: true, splitCount: index % 4 === 0 ? 2 : 0 }))
  await page.evaluate(apps => {
    window.backendTest.snapshot.apps.apps = apps
    window.backendTest.snapshot.appNotes!.entries = [{ id: 'demo-note', packageName: 'org.example.notes', label: 'Keep', text: 'My everyday notes app.', color: '#3e8c78', createdAt: '2026-10-01T12:00:00Z', updatedAt: '2026-10-01T12:00:00Z', origin: null }]
    window.backendTest.emit({ type: 'components', components: window.backendTest.snapshot.components.map(c => ({ ...c, status: 'Installed', message: undefined, version: c.id === 'scrcpy' ? '5.0.1' : c.version, location: 'C:/Tools/' + c.id })) })
    const original = window.desktop!.request
    window.desktop!.request = async request => {
      if (request.type === 'connection.screenApplications') return { ok: true, snapshot: window.backendTest.snapshot, screenApplications: { userId: 0, applications: apps.map(a => ({ label: a.label, packageName: a.packageName })) } }
      if (request.type === 'connection.screenCapabilities') { const reply = await original(request); return reply.ok && reply.screenCapabilities ? { ...reply, screenCapabilities: { ...reply.screenCapabilities, version: '5.0.1' } } : reply }
      if (request.type === 'files.list') {
        const location = { ...request.location, path: request.location.path || (request.location.kind === 'local' ? 'C:\\Android' : '/storage/emulated/0') }
        const local = location.kind === 'local', sep = local ? '\\' : '/'
        const names = local ? ['App backups','Documents','Photos','Projects','Media','Notes.apk','Reading list.pdf','Travel notes.txt'] : ['DCIM','Documents','Download','Movies','Music','Pictures','Recordings','Notifications']
        return { ok: true, snapshot: window.backendTest.snapshot, fileListing: { location, parent: local ? 'C:\\' : '/storage/emulated', free: local ? 268435456000 : 83047219200, entries: names.map((name, i) => ({ name, path: location.path + sep + name, kind: !name.includes('.') ? 'directory' as const : 'file' as const, size: name.includes('.') ? [0,0,0,0,0,24600000,850000,4200][i] : 0, modified: 1792656000000 - i * 86400000, fingerprint: 'demo-' + name })) } }
      }
      if (request.type === 'files.storages') return { ok: true, snapshot: window.backendTest.snapshot, fileStorages: [{ kind: 'internal', name: 'Internal storage', path: '/storage/emulated/0', primary: true }] }
      return original(request)
    }
  }, apps)
  await page.getByRole('navigation').getByRole('button', { name: 'Apps', exact: true }).click()
  await expect(page.getByRole('table', { name: 'Installed applications' })).toBeVisible()
  await page.getByRole('button', { name: 'Details for Notes', exact: true }).click()
  await page.mouse.move(1270, 710)
  await mkdir('docs/images/screens', { recursive: true })
  await page.screenshot({ path: 'docs/images/screens/apps.png', animations: 'disabled' })
  await page.getByRole('navigation').getByRole('button', { name: 'Files', exact: true }).click()
  const left = page.getByRole('region', { name: 'Left file panel', exact: true })
  await expect(left.getByRole('row', { name: 'Notes.apk', exact: true })).toBeVisible()
  await left.getByRole('row', { name: 'Photos', exact: true }).click()
  await page.mouse.move(1270, 710)
  await page.screenshot({ path: 'docs/images/screens/files.png', animations: 'disabled' })
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.getByRole('navigation').getByRole('button', { name: 'Connection', exact: true }).click()
  await page.getByRole('tab', { name: 'Actions', exact: true }).click()
  await page.getByRole('button', { name: 'Screen & recording', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Screen & recording' })
  await dialog.getByRole('button', { name: 'Virtual display', exact: true }).click()
  await dialog.getByRole('combobox', { name: 'Application to open', exact: true }).selectOption('org.example.music')
  await page.mouse.move(1270, 990)
  await dialog.screenshot({ path: 'docs/images/screens/display.png', animations: 'disabled' })
}
