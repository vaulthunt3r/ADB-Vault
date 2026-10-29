import type { AppDetails } from './app-details-protocol.js'
import { SignatureMatcher, type SignatureDatabase } from './signature-database.js'
let cached: SignatureDatabase | undefined
let matcher: SignatureMatcher | undefined
export function collectTrackerBadges(data: AppDetails, database?: SignatureDatabase) {
  const checks = data.badgeChecks ||= {}
  if (!database) { for (const key of ['trackers', 'bloatware']) checks[key] = { present: null, reason: 'No verified detection database is available. Check Components.', items: [] }; return }
  if (cached !== database) { matcher = new SignatureMatcher(database.trackers); cached = database }
  if (!data.components) checks.trackers = { present: null, reason: 'Component inventory was not collected.', items: [] }
  else {
    const unique = new Map<string, { name: string; type: string; enabled: boolean | null }>()
    for (const component of data.components) {
      const previous = unique.get(component.name)
      unique.set(component.name, previous ? { ...component, type: previous.type + ', ' + component.type, enabled: previous.enabled === true || component.enabled === true ? true : previous.enabled === false && component.enabled === false ? false : null } : component)
    }
    const matches = [...unique.values()].flatMap(component => {
      const names = [...new Set(matcher!.search(component.name).map(i => database.trackers[i].name))]
      return names.length ? [{ component, names }] : []
    })
    data.badges.trackersBlocked = matches.length > 0 && matches.every(m => m.component.enabled === false)
    checks.trackers = { present: matches.length > 0,
      reason: 'Manifest component matches using App Manager tracker signatures, revision ' + database.revision.slice(0, 12) + '. ² marks ETIP-only entries. Presence does not prove active tracking. Blocked means disabled in Android; App Manager firewall rules are not inspected. DEX class results are separate.',
      items: matches.map(({ component, names }) => ({ name: component.name, value: component.type + ' · ' + names.join(', ') + ' · ' + (component.enabled === false ? 'Disabled in Android' : component.enabled === true ? 'Not disabled' : 'Blocking state unavailable') })) }
  }
  const bloat = database.bloatware.find(b => b.id === data.packageName)
  const items = bloat ? Object.entries(bloat).filter(([key]) => key !== 'id').map(([name, value]) => ({ name, value: Array.isArray(value) ? value.join(', ') : String(value) })) : []
  if (bloat?.suggestions) for (const suggestion of database.suggestions.filter(s => s._id === bloat.suggestions)) items.push({ name: 'Alternative: ' + (suggestion.label || suggestion.id), value: suggestion.id + (suggestion.reason ? ' · ' + suggestion.reason : '') + (suggestion.repo ? ' · ' + suggestion.repo : '') })
  checks.bloatware = { present: !!bloat, reason: 'Android Debloat List via App Manager, revision ' + database.revision.slice(0, 12) + '. Exact package match. Classification is supplied by the dataset; it is not a recommendation to remove this application. Review warnings and dependencies.', items }
}

export function sensorBadge(output: string) {
  const state = output.trim().toLowerCase()
  if (state !== 'idle' && state !== 'active') throw new Error('Sensor service did not report an unambiguous active/idle state.')
  return { present: state === 'idle', reason: 'Sensor UID state at the time of reading. Idle applications normally have sensors disabled; this is not necessarily a manually applied restriction.', items: [{ name: 'Sensor UID state', value: state }] }
}
