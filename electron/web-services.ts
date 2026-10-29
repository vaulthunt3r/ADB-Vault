export type WebServiceKind = 'search' | 'scanner'
export interface WebService { id: string; name: string; kind: WebServiceKind; url: string; enabled: boolean; note?: string }
export interface ScanPreparation { directory: string; files: { file: string; sha256: string }[]; message: string }
const service = (id: string, name: string, url: string, kind: WebServiceKind = 'search', note?: string): WebService => ({ id, name, url, kind, enabled: true, note })
const siteSearch = (host: string) => `https://www.google.com/search?q=site%3A${host}%20{query}`
export const defaultWebServices: WebService[] = [
  service('play', 'Google Play', 'https://play.google.com/store/apps/details?id={package}', 'search', 'Direct package page'),
  service('google', 'Google', 'https://www.google.com/search?q={query}'),
  service('duckduckgo', 'DuckDuckGo', 'https://duckduckgo.com/?q={query}'),
  service('apkmirror', 'APKMirror', 'https://www.apkmirror.com/?post_type=app_release&searchtype=apk&s={query}'),
  service('fdroid', 'F-Droid', 'https://search.f-droid.org/?q={query}&lang=en'),
  service('github', 'GitHub', 'https://github.com/search?q={query}&type=repositories'),
  service('4pda', '4PDA', siteSearch('4pda.to'), 'search', 'Website search via Google'),
  service('xda', 'XDA', siteSearch('xdaforums.com'), 'search', 'Website search via Google'),
  service('apkpure', 'APKPure', 'https://apkpure.com/search?q={query}'),
  service('baidu', 'Baidu', 'https://www.baidu.com/s?wd={query}'),
  service('yandex', 'Yandex', 'https://yandex.com/search/?text={query}'),
  service('qwant', 'Qwant', 'https://www.qwant.com/?q={query}&t=web'),
  service('galaxy', 'Galaxy Store', 'https://galaxystore.samsung.com/detail/{package}', 'search', 'Direct package page'),
  service('appgallery', 'AppGallery', siteSearch('appgallery.huawei.com'), 'search', 'Website search via Google'),
  service('getapps', 'GetApps', siteSearch('global.app.mi.com'), 'search', 'Website search via Google'),
  service('bing', 'Bing', 'https://www.bing.com/search?q={query}'),
  service('filescan', 'FileScan.io', 'https://www.filescan.io/', 'scanner'),
  service('hybrid', 'Hybrid Analysis', 'https://www.hybrid-analysis.com/', 'scanner'),
  service('virustotal', 'VirusTotal', 'https://www.virustotal.com/gui/home/upload', 'scanner'),
  service('jotti', 'Jotti', 'https://virusscan.jotti.org/', 'scanner'),
  service('metadefender', 'MetaDefender', 'https://metadefender.com/', 'scanner'),
  service('koodous', 'Koodous', 'https://koodous.com/', 'scanner', 'Android APK analysis; a service account may be required'),
]

export function safeWebUrl(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 8192 || /[\x00-\x20\x7f\\]/.test(value)) throw new Error('Use a valid HTTPS URL without spaces.')
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) throw new Error('Only HTTPS links without embedded credentials are supported.')
  return url.href
}
export function validateWebService(value: WebService): WebService {
  if (!value || !/^[a-zA-Z0-9_-]{1,80}$/.test(value.id) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 80 || /[\x00-\x1f]/.test(value.name)) throw new Error('Enter a service name (up to 80 characters).')
  if (!['search', 'scanner'].includes(value.kind) || typeof value.enabled !== 'boolean' || typeof value.url !== 'string' || value.url.length > 2048) throw new Error('Invalid service settings.')
  if (/[\x00-\x1f\x7f]/.test(value.url)) throw new Error('URL must not contain control characters.')
  const url = value.url.trim()
  const remainder = url.replace(/\{(?:query|name|package)\}/g, 'example')
  if (/[{}]/.test(remainder)) throw new Error('Supported placeholders: {query}, {name}, {package}.')
  const authority = url.match(/^https:\/\/([^/?#]*)/)?.[1]
  if (!authority || /[{}]/.test(authority)) throw new Error('Use a fixed HTTPS website address; placeholders belong in its path or query.')
  safeWebUrl(remainder)
  return { id: value.id, name: value.name.trim(), kind: value.kind, url, enabled: value.enabled }
}
export function webServiceUrl(service: WebService, app: { packageName: string; label: string }, query: 'package' | 'name'): string {
  const valid = validateWebService(service)
  const values = { package: app.packageName, name: app.label, query: query === 'package' ? app.packageName : app.label }
  return safeWebUrl(valid.url.replace(/\{(query|name|package)\}/g, (_match, key: keyof typeof values) => encodeURIComponent(values[key])))
}
export function restoreWebServices(saved: unknown): WebService[] {
  if (!Array.isArray(saved)) return defaultWebServices.map(s => ({ ...s }))
  const seen = new Set<string>(), result: WebService[] = []
  for (const raw of saved.slice(0, 100)) {
    try { const entry = validateWebService(raw); if (!seen.has(entry.id)) { seen.add(entry.id); result.push({ ...entry, note: defaultWebServices.find(s => s.id === entry.id && s.url === entry.url)?.note }) } } catch { /* Ignore malformed preferences. */ }
  }
  for (const entry of defaultWebServices) if (!seen.has(entry.id)) result.push({ ...entry })
  return result
}
