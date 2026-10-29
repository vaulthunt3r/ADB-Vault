import { test, expect } from '@playwright/test'
import type { AndroidApp } from '../electron/apps-protocol'
import { appStorageValue, defaultAppFilters, defaultAppSort, filterAndSortApps, type AppSortKey } from '../src/lib/appView'
import { restoreAppsView } from '../src/store/useAppsViewStore'
import { appBadges, badgeChecks, badgeCatalog, storageTotals } from '../src/lib/appDetails'
import type { AppDetails } from '../electron/app-details-protocol'
import { badgeFilterResult } from '../src/lib/badgeFilters'
import { matchesAppSearch, parseAppSearch, pastedAppSearch } from '../src/lib/appSearch'

const app = (packageName: string, overrides: Partial<AndroidApp> = {}): AndroidApp => ({
  packageName, label: packageName, versionName: '1', versionCode: 1, uid: 10001, userId: 0,
  enabled: true, system: false, updatedSystemApp: false, sourceDir: '/data/app/base.apk',
  firstInstallTime: 0, lastUpdateTime: 0, targetSdk: 0, minSdk: 0, installer: null,
  enabledState: 0, suspended: false, stopped: false, debuggable: false, iconPng: null, ...overrides,
})

test('package lists match exact IDs with OR and combine with existing filters', () => {
  const source = [app('com.example.one'), app('com.example.one.plugin'), app('com.example.two', { system: true }), app('com.example.decoy', { label: 'com.example.one' })]
  for (const separator of ['\n', '\r\n', ', ', '; ', ' ', '\t']) {
    const query = ['com.example.one', 'COM.example.two', 'com.example.absent', 'com.example.one'].join(separator)
    expect(filterAndSortApps(source, defaultAppFilters(), query, defaultAppSort()).map(a => a.packageName)).toEqual(['com.example.one', 'com.example.two'])
    expect(filterAndSortApps(source, { ...defaultAppFilters(), type: 'system' }, query, defaultAppSort()).map(a => a.packageName)).toEqual(['com.example.two'])
    expect(parseAppSearch(query).packages?.size).toBe(3)
  }
  expect(filterAndSortApps(source, defaultAppFilters(), 'com.example.missing; com.example.absent', defaultAppSort())).toEqual([])
})

test('pasted formatted lists preserve package boundaries and ignore reference links', () => {
  const pasted = 'Suggested apps:\r\n- `com.example.one` — Analytics\r\n2. com.example.two — Store\r\nhttps://example.org/docs\r\nadb shell pm suspend com.example.one'
  expect(pastedAppSearch(pasted)).toBe('com.example.one, com.example.two')
  expect(pastedAppSearch('com.example.one\ncom.example.one')).toBe('`com.example.one`')
  const single = parseAppSearch(pastedAppSearch('com.example.one\ncom.example.one')!)
  expect(matchesAppSearch(app('com.example.one.plugin'), single)).toBe(false)
  expect(matchesAppSearch(app('com.example.one'), single)).toBe(true)
  expect([...parseAppSearch('android, com.example.one').packages!]).toEqual(['android', 'com.example.one'])
  expect(pastedAppSearch('- com.example.one — android services\n- com.example.two — Store')).toBe('com.example.one, com.example.two')
  expect(pastedAppSearch('- `android`\n- com.example.two')).toBe('android, com.example.two')
  expect(pastedAppSearch('com.example.one\nC:\\com.example.file\\notes.txt\ncom.example.two')).toBe('com.example.one, com.example.two')
})

test('ordinary phrases and a single package keep substring search', () => {
  expect(pastedAppSearch('Мои заметки')).toBeNull()
  expect(pastedAppSearch('com.example.one')).toBeNull()
  expect(parseAppSearch('https://example.org https://another.example').packages).toBeNull()
  expect(matchesAppSearch(app('com.example.one.plugin'), parseAppSearch('com.example.one'))).toBe(true)
  expect(matchesAppSearch(app('com.example.one', { label: 'Мои заметки' }), parseAppSearch(' МОИ ЗАМЕТКИ '))).toBe(true)
  expect(matchesAppSearch(app('com.example.one'), parseAppSearch(''))).toBe(true)
})
test('About storage avoids double counting cache and never invents unknown badge states', () => {
  expect(storageTotals({ requested: true, appBytes: 100, dataBytes: 50, cacheBytes: 10 })).toEqual({ dataWithoutCache: 40, total: 150 })
  expect(storageTotals({ requested: true, appBytes: null, dataBytes: 0, cacheBytes: 0 })).toEqual({ dataWithoutCache: 0, total: null })
  expect(storageTotals({ requested: true, appBytes: 100, dataBytes: 5, cacheBytes: 10 }).dataWithoutCache).toBeNull()
  expect(appBadges(app('x', { updatedSystemApp: true, suspended: true, debuggable: true, splitCount: 3 })).map(b => b.label)).toEqual(['Updated system', '3 splits', 'Debuggable', 'Suspended'])
  expect(appBadges(app('x')).map(b => b.label)).not.toContain('Hidden')
})

test('badge filters implement three-valued all/any matching and restore only valid choices', () => {
  const base = app('a', { debuggable: true }), other = app('b')
  expect(badgeFilterResult(base, undefined, ['debuggable', 'trackers'], 'all')).toBeNull()
  expect(badgeFilterResult(base, undefined, ['debuggable', 'trackers'], 'any')).toBe(true)
  expect(badgeFilterResult(other, undefined, ['debuggable', 'trackers'], 'all')).toBe(false)
  expect(badgeFilterResult(other, undefined, ['debuggable', 'trackers'], 'any')).toBeNull()
  const evidence = { badges: {}, splits: [], links: [], issues: [], badgeChecks: { trackers: { present: true, reason: 'Matched', items: [] } } }
  const filters = { ...defaultAppFilters(), badges: ['trackers'] as const }
  expect(filterAndSortApps([base, other], { ...filters, badges: [...filters.badges] }, '', defaultAppSort(), { b: evidence }).map(a => a.packageName)).toEqual(['b'])
  const saved = restoreAppsView({ filters: { badges: ['running', 'fake', 'running', 'backup', 'magiskHide', 'type'], badgeMatch: 'any' } })
  expect(saved.filters.badges).toEqual(['running', 'backup']); expect(saved.filters.badgeMatch).toBe('any')
})

test('Documented tags use explicit colour rules, omit additions and keep unknown separate from false', () => {
  const base = app('x', { splitCount: 0 })
  const details = { badges: { openLinks: true, openLinksByDefault: true }, splits: [], links: [{ host: 'example.org', state: 'Verified' }], issues: [], badgeChecks: { trackers: { present: true, reason: 'Matched', items: [{ name: 'tracker.One', value: 'Not disabled' }] } } } as unknown as AppDetails
  expect(appBadges(base).map(b => b.label)).toEqual(['User'])
  expect(appBadges(base, details).find(b => b.key === 'openLinks')?.tone).toBe('red')
  expect(appBadges(base, details).find(b => b.key === 'trackers')?.tone).toBe('orange')
  details.badges.openLinksByDefault = false; details.badges.trackersBlocked = true
  expect(appBadges(base, details).find(b => b.key === 'openLinks')?.tone).toBe('dark-cyan')
  expect(appBadges(base, details).find(b => b.key === 'trackers')?.tone).toBe('dark-cyan')
  details.badges.openLinksByDefault = null
  expect(appBadges(base, details).find(b => b.key === 'openLinks')?.tone).toBe('neutral')
  expect(badgeCatalog).toHaveLength(29)
  expect(badgeChecks(base, details).backup.present).toBeNull()
  expect(badgeChecks(base, details).disabled.present).toBe(false)
  details.badges.disabled = true
  expect(badgeChecks(base, details).disabled.present).toBe(true)
})

test('Play signing is never inferred from the installer and requires a positive collector result', () => {
  const base = app('x', { installer: 'com.android.vending' })
  expect(badgeChecks(base).playAppSigning.present).toBeNull()
  expect(appBadges(base).some(b => b.key === 'playAppSigning')).toBe(false)
  for (const present of [true, false, null]) {
    const details = { badges: {}, splits: [], links: [], issues: [], badgeChecks: { playAppSigning: { present, reason: 'Metadata check', items: [{ name: 'com.android.stamp.type', value: 'STAMP_TYPE_DISTRIBUTION_APK' }] } } } as unknown as AppDetails
    expect(badgeChecks(base, details).playAppSigning.present).toBe(present)
    expect(appBadges(base, details).some(b => b.key === 'playAppSigning')).toBe(present === true)
  }
})

test('Saved table view validates persisted fields and preserves the identity column', () => {
  const restored = restoreAppsView({ visibility: { label: false, cacheBytes: true, kind: 'false', fake: true }, sort: { key: 'bad', direction: 'desc' } })
  expect(restored.visibility.label).toBe(true)
  expect(restored.visibility.cacheBytes).toBe(true)
  expect(restored.visibility.kind).toBe(true)
  expect(restored.visibility.fake).toBeUndefined()
  expect(restored.sort).toEqual(defaultAppSort())
  expect(restoreAppsView(null).sort).toEqual(defaultAppSort())
  expect(restoreAppsView({ sort: { key: 'apkSizeBytes', direction: 'desc' } }).sort.key).toBe('apkSizeBytes')
  const order = restoreAppsView({ order: ['cacheBytes', 'invalid', 'cacheBytes', 'label'], density: 'bad' })
  expect(order.order.slice(0, 2)).toEqual(['cacheBytes', 'label'])
  expect(order.order).toHaveLength(18)
  expect(new Set(order.order).size).toBe(18)
  expect(restoreAppsView({ filters: { type: 'bad', packaging: 'archive', stopped: 'yes', suspended: true } }).filters).toEqual({ ...defaultAppFilters(), suspended: true })
  expect(restoreAppsView({ filters: { type: 'user', updatedSystem: true } }).filters.type).toBe('system')
})
test('filters combine independent framework flags and localized search without changing inventory', () => {
  const source = [app('user', { label: 'Заметки' }), app('system', { system: true }),
    app('updated', { updatedSystemApp: true, enabled: false, stopped: true, suspended: true }),
    app('stopped', { stopped: true }), app('suspended', { suspended: true })]
  const filters = defaultAppFilters(), sort = defaultAppSort()
  const names = (overrides: Partial<typeof filters>, search = '') => filterAndSortApps(source, { ...filters, ...overrides }, search, sort).map(a => a.packageName)
  expect(names({ type: 'system' })).toEqual(['system', 'updated'])
  expect(names({ type: 'user' }).sort()).toEqual(['stopped', 'suspended', 'user'])
  expect(names({ type: 'system', availability: 'disabled', stopped: true, suspended: true })).toEqual(['updated'])
  expect(names({ updatedSystem: true })).toEqual(['updated'])
  expect(names({ stopped: true, suspended: true, availability: 'enabled' })).toEqual([])
  expect(names({}, ' ЗАМЕТКИ ')).toEqual(['user'])
  expect(names({}, 'UPDATED')).toEqual(['updated'])
  expect(source.map(a => a.packageName)).toEqual(['user', 'system', 'updated', 'stopped', 'suspended'])
})
for (const key of ['firstInstallTime', 'lastUpdateTime', 'targetSdk', 'minSdk', 'apkSizeBytes'] as AppSortKey[]) {
  test(`${key}: both directions, missing last, stable package tie breaker`, () => {
    const source = [app('z', { [key]: 20 }), app('missing'), app('a', { [key]: 20 }), app('low', { [key]: 10 })]
    const names = (direction: 'asc' | 'desc') => filterAndSortApps(source, defaultAppFilters(), '', { key, direction }).map(a => a.packageName)
    expect(names('asc')).toEqual(['low', 'a', 'z', 'missing'])
    expect(names('desc')).toEqual(['a', 'z', 'low', 'missing'])
  })
}
test('name and package sorting use natural order with deterministic ties', () => {
  const source = [app('pkg10', { label: 'App 2' }), app('pkg2', { label: 'App 10' }), app('pkg1', { label: 'App 2' }), app('empty', { label: '' })]
  const names = (key: AppSortKey, direction: 'asc' | 'desc') => filterAndSortApps(source, defaultAppFilters(), '', { key, direction }).map(a => a.packageName)
  expect(names('label', 'asc')).toEqual(['pkg1', 'pkg10', 'pkg2', 'empty'])
  expect(names('label', 'desc')).toEqual(['pkg2', 'pkg1', 'pkg10', 'empty'])
  expect(names('packageName', 'asc')).toEqual(['empty', 'pkg1', 'pkg2', 'pkg10'])
  expect(names('packageName', 'desc')).toEqual(['pkg10', 'pkg2', 'pkg1', 'empty'])
})

test('storage columns and sorting distinguish zero, missing and inconsistent values', () => {
  const source = [app('large', { storageRequested: true, dataBytes: 100, cacheBytes: 20 }), app('zero', { storageRequested: true, dataBytes: 0, cacheBytes: 0 }), app('unknown'), app('bad', { storageRequested: true, dataBytes: 5, cacheBytes: 10 })]
  expect(appStorageValue(source[0], 'dataWithoutCache')).toBe(80)
  expect(appStorageValue(source[1], 'dataWithoutCache')).toBe(0)
  expect(appStorageValue(source[2], 'dataWithoutCache')).toBeNull()
  expect(appStorageValue(source[3], 'dataWithoutCache')).toBeNull()
  const names = (key: AppSortKey, direction: 'asc' | 'desc') => filterAndSortApps(source, defaultAppFilters(), '', { key, direction }).map(a => a.packageName)
  expect(names('dataWithoutCache', 'asc')).toEqual(['zero', 'large', 'bad', 'unknown'])
  expect(names('dataWithoutCache', 'desc')).toEqual(['large', 'zero', 'bad', 'unknown'])
  expect(names('cacheBytes', 'asc')).toEqual(['zero', 'bad', 'large', 'unknown'])
})

test('installer and SDK bounds combine, persist and do not call unknown installers sideloaded', () => {
  const source = [app('store', { installer: 'com.android.vending', targetSdk: 35, debuggable: true }), app('other', { installer: 'com.vendor.store', targetSdk: 29 }), app('unknown', { targetSdk: 34 }), app('noSdk', { installer: 'com.android.vending' })]
  const selected = { ...defaultAppFilters(), installer: 'com.android.vending', targetSdkMin: 30, targetSdkMax: 35 }
  expect(filterAndSortApps(source, selected, '', defaultAppSort()).map(a => a.packageName)).toEqual(['store'])
  expect(filterAndSortApps(source, { ...defaultAppFilters(), installer: '@unknown' }, '', defaultAppSort()).map(a => a.packageName)).toEqual(['unknown'])
  expect(filterAndSortApps(source, defaultAppFilters(), '', { key: 'debuggable', direction: 'desc' }).map(a => a.packageName)).toEqual(['store', 'noSdk', 'other', 'unknown'])
  expect(restoreAppsView({ filters: selected, sort: { key: 'dataWithoutCache', direction: 'desc' }, visibility: { debuggable: true, dataWithoutCache: true } }).filters).toEqual(selected)
  expect(restoreAppsView({ filters: { targetSdkMin: -1, targetSdkMax: 1.5, installer: '<invalid>' } }).filters).toEqual(defaultAppFilters())
})
