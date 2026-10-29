import type { AppDetails, BadgeCheck } from './app-details-protocol.js'
import { validateAppTarget } from './app-details-protocol.js'
import { checked, type Runner } from './process.js'

const rootKeys = ['ssaid', 'keyStore', 'magiskDenyList', 'systemless'] as const
const unavailable = (reason: string): BadgeCheck => ({ present: null, reason, items: [] })
export const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`

export function parseRootChecks(output: string, data: Pick<AppDetails, 'packageName' | 'userId' | 'uid'>): Record<string, BadgeCheck> {
  if (output.length > 1_000_000) throw new Error('Root response exceeds the read limit.')
  const result = JSON.parse(output)
  if (result.type !== 'root-details' || result.protocolVersion !== 1 || result.packageName !== data.packageName || result.userId !== data.userId || result.uid !== data.uid) throw new Error('Root response does not match the selected app/profile.')
  const checks: Record<string, BadgeCheck> = {}
  for (const key of ['ssaid', 'hidden', 'saf', 'systemless', 'keyStore']) {
    const c = result.badgeChecks?.[key]
    if (c === undefined) continue
    if (!c || ![true, false, null].includes(c.present) || typeof c.reason !== 'string' || c.reason.length > 8192 || !Array.isArray(c.items) || c.items.length > 1024 || !c.items.every((i: any) => i && typeof i.name === 'string' && i.name.length <= 8192 && typeof i.value === 'string' && i.value.length <= 8192)) throw new Error('Invalid root badge response.')
    checks[key] = c
  }
  return checks
}

export function keyStoreCheck(output: string): BadgeCheck {
  const lines = output.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  if (lines.shift() !== 'Keys:' || lines.length > 1024 || lines.some(s => /\b(error|exception|denied|failed)\b/i.test(s))) throw new Error('Unsupported KeyStore listing response.')
  return { present: lines.length > 0, reason: 'Android KeyStore alias metadata for this UID. Shared-UID apps share entries; no key material is read.', items: lines.map(value => ({ name: 'Alias', value })) }
}

export class RootBadgeReader {
  private denied = new Map<string, string>()
  reset() { this.denied.clear() }
  async collect(data: AppDetails, adb: string, serial: string, digest: string, runner: Runner, signal: AbortSignal, deviceKey = serial) {
    validateAppTarget(data.packageName, data.userId)
    if (!Number.isSafeInteger(data.uid) || data.uid < 0 || Math.floor(data.uid / 100000) !== data.userId || !/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid root collection target.')
    const checks = data.badgeChecks ||= {}
    const root = (command: string, timeout = 15000) => runner(adb, ['-s', serial, 'shell', 'su', '-c', shellQuote(command)], timeout, undefined, undefined, { signal, maxOutputBytes: 1_000_000 })
    try {
      if (this.denied.has(deviceKey)) throw new Error(this.denied.get(deviceKey))
      try {
        const identity = checked(await root('id', 20000))
        if (!/^uid=0\b/.test(identity)) throw new Error('Root access was not granted to Shell.')
      } catch (error) {
        if (!signal.aborted) this.denied.set(deviceKey, 'Root was unavailable or denied. Allow Shell in your root manager, then turn the root setting off and on to retry.')
        throw error
      }
      const remote = '/data/local/tmp/android-manager/manager-server.jar'
      // Re-verify inside the privileged process, before app_process executes our helper.
      const command = `test "$(sha256sum ${remote} | cut -d ' ' -f 1)" = ${digest} && CLASSPATH=${remote} app_process / dev.adbvault.helper.Main --root-details ${shellQuote(data.packageName)} ${data.uid} ${data.userId}`
      const extra = parseRootChecks(checked(await root(command, 30000)), data)
      for (const [key, value] of Object.entries(extra)) {
        if (['hidden', 'saf'].includes(key) && (checks[key]?.present != null || typeof data.badges[key] === 'boolean')) continue
        checks[key] = value
        if (key === 'hidden' && value.present !== null) data.issues = data.issues.filter(i => i.area !== 'Hidden state')
      }
      try {
        if (!checks.keyStore) checks.keyStore = keyStoreCheck(checked(await root(`su ${data.uid} -c ${shellQuote('keystore_cli_v2 list')}`)))
      } catch (e) { checks.keyStore = unavailable(`KeyStore metadata unavailable: ${e instanceof Error ? e.message : String(e)}`) }
      try {
        const version = checked(await root('magisk -v'))
        if (!/MAGISK/i.test(version)) throw new Error('Supported Magisk installation not detected.')
        const status = await root('magisk --denylist status')
        const statusText = `${status.stdout} ${status.stderr}`.trim()
        if (!/denylist is (?:not )?enforced/i.test(statusText)) throw new Error('Unsupported Magisk DenyList status.')
        const lines = checked(await root('magisk --denylist ls')).split(/\r?\n/).filter(Boolean)
        if (lines.some(line => !/^[\w.]+\|[^\s|]+$/.test(line))) throw new Error('Unsupported Magisk DenyList format.')
        const matches = lines.filter(line => line.split('|')[0] === data.packageName)
        checks.magiskDenyList = { present: matches.length > 0, reason: `Magisk ${version}: ${statusText}. Package/process rules can apply across profiles.`, items: matches.map(line => ({ name: 'Process', value: line.split('|')[1] })) }
      } catch (e) { checks.magiskDenyList = unavailable(e instanceof Error ? e.message : String(e)) }
    } catch (e) {
      const reason = this.denied.get(deviceKey) || (e instanceof Error ? e.message : String(e))
      for (const key of rootKeys) checks[key] = unavailable(reason)
    }
  }
}
