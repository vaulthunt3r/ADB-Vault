import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultWebServices, safeWebUrl, validateWebService, webServiceUrl, restoreWebServices } from '../dist-electron/web-services.js'

test('all defaults are valid and include the screenshot services plus Android scanners', () => {
  assert.equal(new Set(defaultWebServices.map(s => s.id)).size, defaultWebServices.length)
  for (const s of defaultWebServices) { validateWebService(s); assert.ok(webServiceUrl(s, { label: 'Example App', packageName: 'org.example.app' }, 'package').startsWith('https://')) }
  for (const name of ['Google Play', 'Google', 'DuckDuckGo', 'APKMirror', 'F-Droid', 'GitHub', '4PDA', 'XDA', 'APKPure', 'Baidu', 'Yandex', 'Qwant', 'Galaxy Store', 'AppGallery', 'GetApps', 'Bing', 'FileScan.io', 'Hybrid Analysis', 'VirusTotal', 'Jotti', 'MetaDefender', 'Koodous']) assert.ok(defaultWebServices.some(s => s.name === name))
})
test('substitution encodes query, Unicode names and path fragments once', () => {
  const s = { id: 'test', name: 'Test', kind: 'search', enabled: true, url: 'https://example.org/find/{package}?q={query}&name={name}' }
  const app = { packageName: 'org.example.app', label: 'Заметки & #?/%' }
  const url = new URL(webServiceUrl(s, app, 'name'))
  assert.equal(url.searchParams.get('q'), app.label); assert.equal(url.searchParams.get('name'), app.label)
  assert.equal(url.pathname, '/find/org.example.app'); assert.equal(url.hash, '')
})
test('templates reject executable schemes, credentials and host placeholders', () => {
  const s = { id: 'test', name: 'Test', kind: 'search', enabled: true }
  for (const url of ['javascript:alert(1)', 'file:///C:/x', 'https://user:pass@example.org/', 'https://{package}/', 'https://example.org/?x={bad}', 'https://example.org/\n', 'https://example.org\\@evil.org']) assert.throws(() => validateWebService({ ...s, url }))
  for (const url of ['file:///C:/x', 'http://example.org', 'ms-settings:x', 'https://u:p@example.org', 'https://example.org/\n']) assert.throws(() => safeWebUrl(url))
})
test('saved enabled flags and custom entries persist while corrupt preferences are discarded', () => {
  const custom = { id: 'custom', name: 'My site', kind: 'search', enabled: false, url: 'https://example.org/?q={query}' }
  const saved = restoreWebServices([{ ...defaultWebServices[0], enabled: false }, custom, custom, { ...custom, id: 'unsafe', url: 'file:///x' }])
  assert.equal(saved.find(s => s.id === 'play').enabled, false)
  assert.equal(saved.filter(s => s.id === 'custom').length, 1); assert.equal(saved.some(s => s.id === 'unsafe'), false)
  assert.ok(saved.some(s => s.id === 'virustotal')); assert.equal(restoreWebServices(null).length, defaultWebServices.length)
})
