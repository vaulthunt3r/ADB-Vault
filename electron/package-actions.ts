import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import type { AndroidApp } from './apps-protocol.js'
import { packageMethodLabel, type PackageAction, type PackageActionContext, type PackageActionOptions } from './package-actions-protocol.js'
export type PackageCommand = (args: string[], timeout?: number) => Promise<string>
export interface PackageActionAccess { directory: string; observe?: (app: AndroidApp, action: PackageAction, options: PackageActionOptions, context: PackageActionContext, outcome: PackageActionError['outcome'] | 'confirmed', message: string) => void }
export class PackageActionError extends Error {
  constructor(message: string, readonly outcome: 'denied' | 'uncertain' | 'failed') { super(message) }
}
class PackageMethodUnavailable extends PackageActionError {
  constructor(message: string) { super(message, 'failed') }
}
// Only a complete parser rejection proves that pm did not dispatch the operation.
// Mixed output (including success, a timeout or a permission error) must not retry.
function unsupportedShellSyntax(message: string, action: PackageAction) {
  const match = message.trim().match(/^(?:Error:\s*)?Unknown (command|option):?\s+['"]?([\w-]+)['"]?\.?$/i)
  if (!match) return false
  const command = action === 'disable' ? 'disable-user' : action.startsWith('clear-') ? 'clear' : action
  return match[1].toLowerCase() === 'command' ? match[2] === command : ['--user', ...(action === 'clear-cache' ? ['--cache-only'] : []), ...(action === 'uninstall' ? ['-k'] : [])].includes(match[2])
}
export const isPackageDenial = (message: string) => /SecurityException|permission deni|permission.*(?:not granted|requires)|does not have permission|cannot disable system|not allowed|DELETE_FAILED_(?:OWNER_BLOCKED|USER_RESTRICTED|DEVICE_POLICY_MANAGER)|blocked by|INTERNAL_DELETE_CACHE_FILES/i.test(message)
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
interface Inspection { protocol: 1; action: string; packageName: string; userId: number; context: PackageActionContext; outcome: 'confirmed' | 'denied' | 'uncertain' | 'failed'; message?: string; state: { installed: boolean; enabled?: boolean; uid?: number; versionCode?: number; apkAvailable?: boolean } }
export function parsePackageResult(output: string, app: AndroidApp, action: string): Inspection {
  const lines = output.trim().split(/\r?\n/).filter(line => line.startsWith('{'))
  if (lines.length !== 1) throw new Error('Android package helper returned an incomplete response.')
  const r = JSON.parse(lines[0]) as Inspection, c = r.context
  if (r.protocol !== 1 || r.packageName !== app.packageName || r.userId !== app.userId || r.action !== action || !['confirmed', 'denied', 'uncertain', 'failed'].includes(r.outcome) || !c || typeof c.fingerprint !== 'string' || !c.fingerprint.length || c.fingerprint.length > 1024 || !Number.isInteger(c.sdk) || ![0, 2000].includes(c.callerUid) || !['granted', 'denied', 'unknown'].includes(c.cachePermission) || (r.message !== undefined && (typeof r.message !== 'string' || r.message.length > 8192))) throw new Error('Android package helper response does not match the requested target.')
  return r
}
async function prepare(access: PackageActionAccess, command: PackageCommand) {
  const jar = path.join(access.directory, 'manager-server.jar'), manifest = JSON.parse(await readFile(path.join(access.directory, 'helper-manifest.json'), 'utf8'))
  const digest = createHash('sha256').update(await readFile(jar)).digest('hex')
  if (manifest.protocolVersion !== 1 || digest !== manifest.sha256) throw new Error('Bundled Android helper failed verification.')
  const remote = '/data/local/tmp/android-manager/manager-server.jar'
  if ((await command(['shell', `if [ -f ${remote} ]; then sha256sum ${remote}; fi`])).split(/\s+/)[0] !== digest) {
    await command(['shell', 'mkdir -p /data/local/tmp/android-manager'])
    await command(['push', jar, `${remote}.actions-new`], 30000)
    if ((await command(['shell', 'sha256sum', `${remote}.actions-new`])).split(/\s+/)[0] !== digest) throw new Error('Android helper upload checksum mismatch.')
    await command(['shell', `chmod 444 ${remote}.actions-new && mv -f ${remote}.actions-new ${remote}`])
  }
  return remote
}
export async function runPackageAction(app: AndroidApp, action: PackageAction, options: PackageActionOptions, access: PackageActionAccess, command: PackageCommand, shell: (script: string, timeout?: number) => Promise<string>) {
  const remote = await prepare(access, command)
  const helper = async (operation: string) => parsePackageResult(await shell(`CLASSPATH=${remote} app_process / dev.adbvault.helper.PackageActions ${[operation, app.packageName, String(app.userId), String(app.uid), String(app.versionCode), String(options.keepData === true)].map(quote).join(' ')}`, 40000), app, operation)
  const before = await helper('inspect')
  if (before.outcome !== 'confirmed' || !before.state?.installed || before.state.uid !== app.uid || before.state.versionCode !== app.versionCode || typeof before.state.enabled !== 'boolean') throw new Error(before.message || 'The application changed. Refresh applications before trying again.')
  if (before.context.callerUid !== (options.root ? 0 : 2000)) throw new Error('The action access level changed. Check the phone’s root access setting before trying again.')
  const runMethod = async (method: 'shell' | 'api') => {
    const actualOptions = { ...options, method }
    const observe = (outcome: PackageActionError['outcome'] | 'confirmed', message: string) => access.observe?.(app, action, actualOptions, before.context, outcome, message)
    let attempted = false, confirmed = false, failure: unknown
    try {
      if (action === 'clear-cache' && before.context.cachePermission !== 'granted') throw new PackageActionError(before.context.cachePermission === 'denied' ? 'Android denies INTERNAL_DELETE_CACHE_FILES to this access level. Cache was not cleared; app data was not touched.' : 'Cannot verify the permission for safe per-app cache clearing. No data was deleted.', before.context.cachePermission === 'denied' ? 'denied' : 'failed')
      if (method === 'api') {
        attempted = true
        const r = await helper(action)
        if (r.context.fingerprint !== before.context.fingerprint || r.context.callerUid !== before.context.callerUid) throw new PackageActionError('The phone or access level changed during the operation. Its result could not be verified.', 'uncertain')
        if (r.outcome !== 'confirmed') throw new PackageActionError(r.message || 'Android did not confirm the action.', r.outcome)
      } else {
        if (action === 'clear-cache' && !/clear\s+[^\r\n]*--cache-only/.test(await shell("'pm' 'help'"))) throw new PackageMethodUnavailable('This firmware does not advertise safe cache clearing via ADB. No cleanup command was sent.')
        const args = action === 'uninstall' ? ['pm', 'uninstall', ...(options.keepData ? ['-k'] : []), '--user', String(app.userId), app.packageName]
          : action === 'enable' || action === 'disable' ? ['pm', action === 'enable' ? 'enable' : 'disable-user', '--user', String(app.userId), app.packageName]
          : ['pm', 'clear', '--user', String(app.userId), ...(action === 'clear-cache' ? ['--cache-only'] : []), app.packageName]
        attempted = true
        let output: string
        try { output = await shell(args.map(quote).join(' '), action === 'clear-cache' ? 35000 : 60000) }
        catch (error) {
          if (!(error instanceof Error) || !unsupportedShellSyntax(error.message, action)) throw error
          attempted = false
          throw new PackageMethodUnavailable(error.message)
        }
        if (unsupportedShellSyntax(output, action)) { attempted = false; throw new PackageMethodUnavailable(output) }
        if ((action === 'clear-data' || action === 'clear-cache') && !/^Success\s*$/m.test(output)) throw new PackageActionError(output || 'Android did not confirm cleanup.', /Failure/i.test(output) ? 'failed' : 'uncertain')
      }
      confirmed = true
    } catch (error) { failure = error }
    if (attempted && ['enable', 'disable', 'uninstall'].includes(action)) {
      try {
        const after = await helper('inspect')
        if (after.outcome !== 'confirmed' || after.context.fingerprint !== before.context.fingerprint || after.context.callerUid !== before.context.callerUid || typeof after.state?.installed !== 'boolean') throw new Error('Invalid verification response.')
        const matches = action === 'uninstall' ? !after.state.installed : after.state.installed && after.state.uid === app.uid && after.state.versionCode === app.versionCode && after.state.enabled === (action === 'enable')
        if (!matches) throw new PackageActionError(failure instanceof Error ? failure.message : 'Android did not apply the requested state. The installation was read back.', failure instanceof PackageActionError ? failure.outcome : failure && isPackageDenial(String(failure)) ? 'denied' : failure && !/\bFailure\b/.test(String(failure)) ? 'uncertain' : 'failed')
        // A lost command reply is recoverable by a read, never by another mutation.
        const message = `${action === 'uninstall' ? 'Removed from this profile' : action === 'disable' ? 'Disabled for this profile' : 'Enabled for this profile'} · verified on device.${options.keepData ? ' Android was instructed to keep data/cache.' : ''} ${packageMethodLabel(actualOptions)}.`
        observe('confirmed', message); return message
      } catch (error) {
        failure = error instanceof PackageActionError ? error : new PackageActionError(`${failure instanceof Error ? failure.message + ' ' : ''}The result could not be verified. Refresh applications before retrying; the action may already have completed.`, 'uncertain')
      }
    }
    if (failure) {
      const message = failure instanceof Error ? failure.message : String(failure)
      const outcome = failure instanceof PackageActionError ? failure.outcome : isPackageDenial(message) ? 'denied' : attempted && !/\bFailure\b/.test(message) ? 'uncertain' : 'failed'
      observe(outcome, message)
      if (failure instanceof PackageMethodUnavailable) throw failure
      throw new PackageActionError(`${message}\nMethod: ${packageMethodLabel(actualOptions)}.`, outcome)
    }
    if (!confirmed) throw new PackageActionError('Android did not confirm the operation.', 'uncertain')
    const message = `${action === 'clear-cache' ? 'Cache' : 'App data'} cleared for this profile · confirmed by Android. ${packageMethodLabel(actualOptions)}.`
    observe('confirmed', message); return message
  }
  try { return await runMethod(options.method || 'shell') }
  catch (error) {
    if (options.method || !(error instanceof PackageMethodUnavailable)) throw error
    // No operation was dispatched. Re-read identity and access before the one
    // compatible alternative, preserving action, profile, data policy and root consent.
    const current = await helper('inspect')
    if (current.outcome !== 'confirmed' || current.context.fingerprint !== before.context.fingerprint || current.context.callerUid !== before.context.callerUid || !current.state?.installed || current.state.uid !== app.uid || current.state.versionCode !== app.versionCode || current.state.enabled !== before.state.enabled) throw new PackageActionError('The application or phone access changed. No alternate operation was sent. Refresh applications before trying again.', 'failed')
    return runMethod('api')
  }
}

export async function runRestoreExisting(app: AndroidApp, access: PackageActionAccess, command: PackageCommand, attempted: () => void) {
  const remote = await prepare(access, command)
  const inspect = async () => parsePackageResult(await command(['shell', '-T', `CLASSPATH=${remote} app_process / dev.adbvault.helper.PackageActions ${['inspect-restore', app.packageName, String(app.userId), String(app.uid), String(app.versionCode), 'false'].map(quote).join(' ')}`], 40000), app, 'inspect-restore')
  const before = await inspect()
  if (before.outcome !== 'confirmed' || before.state?.installed !== false || before.state.apkAvailable !== true || before.state.uid !== app.uid || before.state.versionCode !== app.versionCode || before.context.callerUid !== 2000 || app.actionContext && before.context.fingerprint !== app.actionContext.fingerprint) throw new Error('The package changed or its APK files are unavailable. Refresh the list before restoring.')
  let failure: unknown
  attempted()
  try {
    const output = await command(['shell', ['pm', 'install-existing', '--user', String(app.userId), app.packageName].map(quote).join(' ')], 60000)
    if (/Error|Failure|Exception|Permission Denial/i.test(output)) failure = new Error(output.slice(0, 1200))
  }
  catch (error) { failure = error }
  let after: Inspection
  try { after = await inspect() }
  catch { throw new PackageActionError('Restoration could not be verified. Refresh applications before retrying; it may already have completed.', 'uncertain') }
  if (after.outcome !== 'confirmed' || after.context.fingerprint !== before.context.fingerprint || after.context.callerUid !== before.context.callerUid || typeof after.state?.installed !== 'boolean' || after.state.uid !== app.uid || after.state.versionCode !== app.versionCode) throw new PackageActionError('The package or phone changed during restoration. Refresh applications before retrying.', 'uncertain')
  if (!after.state.installed) throw new PackageActionError(failure instanceof Error ? failure.message : 'Android did not restore the package to this profile. Its state was read back.', failure && isPackageDenial(String(failure)) ? 'denied' : failure && !/\bFailure\b|Unknown (?:command|option)|Error:.*(?:not found|does not exist)/i.test(String(failure)) ? 'uncertain' : 'failed')
  return 'Restored to this profile · verified on device. Deleted app data was not recovered.'
}
