import { test, expect } from '@playwright/test'
import { badgeCheckState } from '../src/lib/badgeCheckState'
import { customBadgeStyle } from '../src/lib/badgeAppearance'
import { sanitizeBadgeColors } from '../src/store/useBadgeAppearanceStore'

test('legend separates confirmed absence, missing root, unsupported and uncollected checks', () => {
  const check = { present: null, reason: 'Not collected in this snapshot.', items: [] }
  expect(badgeCheckState('ssaid', { ...check, present: false }, false)).toBe('Not present')
  expect(badgeCheckState('systemless', { ...check, present: true }, true)).toBe('Present')
  expect(badgeCheckState('ssaid', check, false)).toBe('Root required')
  expect(badgeCheckState('ssaid', { ...check, reason: 'Root was unavailable or denied. Allow Shell in your root manager.' }, true)).toBe('Root access required')
  expect(badgeCheckState('saf', { ...check, reason: 'URI grant inspection requires Android 10 or newer' }, true)).toBe('Not supported')
  expect(badgeCheckState('saf', { ...check, reason: 'URI grant inspection requires Android 10 or newer' }, false)).toBe('Not supported')
  expect(badgeCheckState('saf', { ...check, reason: 'Permission denied' }, true)).toBe('Access denied')
  expect(badgeCheckState('wx', check, true)).toBe('Not checked')
  expect(badgeCheckState('ssaid', { ...check, reason: 'Enable root in Settings → Apps and refresh Details' }, true)).toBe('Not checked')
  expect(badgeCheckState('keyStore', { ...check, reason: 'Command timed out' }, true)).toBe('Unavailable')
  expect(badgeCheckState('backup', check, false)).toBe('Not checked')
  expect(badgeCheckState('magiskHide', check, true)).toBe('Not supported')
})
test('manual text color is independent of background; invalid persisted colors cannot inject styles', () => {
  expect(customBadgeStyle('#ffffff')?.color).toBe('#000000')
  expect(customBadgeStyle('#000000')?.color).toBe('#ffffff')
  expect(customBadgeStyle('#000000', '#123456')?.color).toBe('#123456')
  expect(customBadgeStyle(undefined, '#ffffff')).toEqual({ color: '#ffffff' })
  expect(customBadgeStyle('bad', 'bad')).toBeUndefined()
  expect(sanitizeBadgeColors({ 'type.user': '#123456', running: 'url(test)', unknown: '#ffffff' })).toEqual({ 'type.user': '#123456' })
  expect(sanitizeBadgeColors({ 'filter.allTypes': '#123456', 'filter.enabled': '#abcdef', 'filter.singleApk': 'invalid' })).toEqual({ 'filter.allTypes': '#123456', 'filter.enabled': '#abcdef' })
  const bloatwareColors = { bloatware: '#112233', 'bloatware.delete': '#445566', 'bloatware.replace': '#778899', 'bloatware.caution': '#aabbcc', 'bloatware.unsafe': '#ddeeff' }
  expect(sanitizeBadgeColors({ ...bloatwareColors, 'bloatware.unknown': '#000000' })).toEqual(bloatwareColors)
})
