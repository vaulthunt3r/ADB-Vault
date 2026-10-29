import type { BatteryUsageRow } from './android-diagnostics-protocol.js'

const number = (s: string | undefined) => s !== undefined && s.trim() !== '' && Number.isFinite(Number(s)) && Number(s) >= 0 ? Number(s) : null
// Checkin v9 uses quoted job/alarm names and sanitizes commas in wakelock names.
function csv(line: string) {
  const result: string[] = []; let field = '', quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') { if (quoted && line[i + 1] === '"') { field += '"'; i++ } else quoted = !quoted }
    else if (c === ',' && !quoted) { result.push(field); field = '' } else field += c
  }
  result.push(field); return result
}
export function parseBatteryUsage(text: string) {
  const rows = new Map<number, BatteryUsageRow>(), packages = new Map<number, Set<string>>()
  let recognized = false, unsupported = false
  const row = (uid: number) => {
    let item = rows.get(uid)
    if (!item) { item = { uid, packages: [], estimatedMah: null, partialMs: null, backgroundMs: null, wakeups: null, wakelocks: [], alarms: [] }; rows.set(uid, item) }
    return item
  }
  for (const line of text.split(/\r?\n/)) {
    const c = csv(line)
    if (!/^\d+$/.test(c[0] || '') || c.length < 5) continue
    if (c[0] !== '9') { unsupported = true; continue }
    recognized = true
    if (c[2] === 'i' && c[3] === 'uid' && /^\d+$/.test(c[4]) && /^[\w.]+$/.test(c[5] || '')) {
      const uid = Number(c[4]); const names = packages.get(uid) || new Set<string>(); names.add(c[5]); packages.set(uid, names); continue
    }
    // Never mix since-charge, current and unplugged aggregates.
    if (c[2] !== 'l' || !/^\d+$/.test(c[1])) continue
    const uid = Number(c[1]); if (!Number.isSafeInteger(uid) || uid < 0) continue
    if (c[3] === 'pwi' && c[4] === 'uid' && number(c[5]) !== null) row(uid).estimatedMah = number(c[5])
    else if (c[3] === 'awl' && number(c[4]) !== null) { row(uid).partialMs = number(c[4]); row(uid).backgroundMs = number(c[5]) }
    else if (c[3] === 'wl') {
      const partial = c.indexOf('p', 5)
      if (partial > 5 && number(c[partial - 1]) !== null) row(uid).wakelocks.push({ name: c[4], milliseconds: number(c[partial - 1])!, count: number(c[partial + 1]) })
    } else if (c[3] === 'wua' && number(c[5]) !== null) {
      const item = row(uid), count = number(c[5])!
      item.wakeups = (item.wakeups ?? 0) + count; item.alarms.push({ name: c[4], count })
    }
  }
  if (!recognized) throw new Error(unsupported ? 'This Android battery statistics format is not supported.' : 'Android did not return readable battery statistics. Access may be restricted.')
  const result = [...rows.values()].map(item => ({ ...item, packages: [...(packages.get(item.uid) || [])], wakelocks: item.wakelocks.sort((a, b) => b.milliseconds - a.milliseconds).slice(0, 50), alarms: item.alarms.sort((a, b) => b.count - a.count).slice(0, 50) })).sort((a, b) => (b.estimatedMah ?? -1) - (a.estimatedMah ?? -1) || (b.partialMs ?? -1) - (a.partialMs ?? -1))
  const issues: string[] = []
  if (!result.length) issues.push('No supported per-UID usage records were reported for this period.')
  if (!result.some(r => r.estimatedMah !== null)) issues.push('Per-application energy estimates are unavailable on this device.')
  if (!result.some(r => r.partialMs !== null)) issues.push('Aggregate wake-lock duration is unavailable. Individual locks can overlap and are not added together.')
  if (!result.some(r => r.wakeups !== null)) issues.push('Wakeup-alarm counts were not reported. This does not mean zero wakeups.')
  if (unsupported) issues.push('Unsupported checkin records were omitted.')
  if (result.length > 2000) issues.push('Only the first 2,000 UID records are shown.')
  return { rows: result.slice(0, 2000), issues }
}
