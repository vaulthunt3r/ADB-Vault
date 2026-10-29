import { domainToASCII } from 'node:url'
import { isIP } from 'node:net'
import { domainTlds } from './domain-tlds.js'
import type { ApkAddress, ApkAddresses } from './database-protocol.js'

export interface AddressInventory { candidates: ApkAddress[]; files: number; issues: string[] }
// File suffixes are also real TLDs. Ignore them only for bare-string candidates;
// an explicit https://archive.zip remains an address.
const fileSuffixes = new Set(['apk', 'apks', 'arsc', 'dex', 'so', 'java', 'class', 'xml', 'json', 'txt', 'js', 'css', 'html', 'zip', 'rar', 'tar', 'png', 'jpg', 'gif', 'svg', 'map', 'properties', 'md'])
function domain(value: string, bare = false): string | null {
  const host = domainToASCII(value.replace(/^\*\./, '').replace(/\.$/, '')).toLowerCase()
  if (bare && /^(?:(?:com|org|net|io|dev)\.[^.]+\.|(?:android|java|javax|kotlin|kotlinx)\.)/.test(host)) return null
  if (host.length > 253 || isIP(host)) return null
  const labels = host.split('.'), tld = labels.at(-1)!
  if (labels.length < 2 || !domainTlds.has(tld) || (bare && fileSuffixes.has(tld)) || !labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null
  return host
}
function url(value: string): URL | null {
  if (!/^https?:\/\//i.test(value) || /[\x00-\x20\x7f<>"'`\\]/.test(value)) return null
  // Strip sentence punctuation; preserve balanced parentheses used in URL paths.
  let candidate = value.replace(/[.,;]+$/, '')
  while (candidate.endsWith(')') && (candidate.match(/\)/g)?.length || 0) > (candidate.match(/\(/g)?.length || 0)) candidate = candidate.slice(0, -1)
  try {
    const parsed = new URL(candidate)
    if (!parsed.hostname || (parsed.port && (Number(parsed.port) < 1 || Number(parsed.port) > 65535))) return null
    const host = parsed.hostname.replace(/^\[|\]$/g, '')
    if (!domain(parsed.hostname) && !isIP(host) && host !== 'localhost') return null
    return parsed
  } catch { return null }
}
export function analyzeAddresses(input: AddressInventory, incompleteApks: boolean): ApkAddresses {
  const domains = new Map<string, ApkAddress>(), urls = new Map<string, ApkAddress>()
  const issues = [...input.issues]
  const add = (map: Map<string, ApkAddress>, value: string, sources: ApkAddress['sources']) => {
    const entry = map.get(value) || { value, sources: [] }
    for (const source of sources) {
      if (entry.sources.some(item => item.apk === source.apk && item.entry === source.entry)) continue
      if (entry.sources.length === 8) { if (!issues.includes('Only the first 8 source files per address are shown.')) issues.push('Only the first 8 source files per address are shown.'); break }
      entry.sources.push(source)
    }
    map.set(value, entry)
  }
  for (const candidate of input.candidates) {
    const parsed = url(candidate.value)
    if (parsed) {
      add(urls, parsed.href, candidate.sources)
      const host = domain(parsed.hostname)
      if (host) add(domains, host, candidate.sources)
    } else if (!candidate.value.includes('://')) {
      const host = domain(candidate.value, true)
      if (host) add(domains, host, candidate.sources)
    }
  }
  if (incompleteApks) issues.push('Some APK files could not be fully inspected; additional addresses may be missing.')
  return { status: issues.length ? 'partial' : 'complete', files: input.files, issues, domains: [...domains.values()].sort((a, b) => a.value.localeCompare(b.value)), urls: [...urls.values()].sort((a, b) => a.value.localeCompare(b.value)) }
}
