import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { parsePermissionSnapshot, permissionRestriction, type PermissionChange, type PermissionSnapshot } from './app-permissions-protocol.js'
import type { AndroidApp } from './apps-protocol.js'
import type { AppActionTarget } from './app-actions-protocol.js'

type Command = (args: string[], timeout?: number) => Promise<string>
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
export interface PermissionAccess {
  directory: string
  publish: (target: AppActionTarget, state: PermissionSnapshot | null) => void
}
export async function changePermission(request: PermissionChange, app: AndroidApp, access: PermissionAccess, command: Command) {
  const jar = path.join(access.directory, 'manager-server.jar')
  const manifest = JSON.parse(await readFile(path.join(access.directory, 'helper-manifest.json'), 'utf8'))
  const digest = createHash('sha256').update(await readFile(jar)).digest('hex')
  if (manifest.protocolVersion !== 1 || manifest.helperVersion !== '0.1.0' || digest !== manifest.sha256) throw new Error('Bundled Android helper failed verification.')
  const remote = '/data/local/tmp/android-manager/manager-server.jar'
  if ((await command(['shell', `if [ -f ${remote} ]; then sha256sum ${remote}; fi`])).split(/\s+/)[0] !== digest) {
    await command(['shell', 'mkdir -p /data/local/tmp/android-manager'])
    await command(['push', jar, `${remote}.permissions-new`], 30000)
    if ((await command(['shell', 'sha256sum', `${remote}.permissions-new`])).split(/\s+/)[0] !== digest) throw new Error('Android helper upload checksum mismatch.')
    await command(['shell', `chmod 444 ${remote}.permissions-new && mv -f ${remote}.permissions-new ${remote}`])
  }
  const read = async () => {
    const output = await command(['shell', `CLASSPATH=${remote} app_process / dev.adbvault.helper.Main --permission-state ${request.packageName} ${request.userId}`], 30000)
    const state = parsePermissionSnapshot(output, request)
    if (state.uid !== app.uid || state.versionCode !== app.versionCode) throw new Error('The application changed. Refresh applications before changing permissions.')
    access.publish(request, state)
    return state
  }
  const state = await read()
  const permission = state.requestedPermissions.find(p => p.name === request.permission)
  if (!permission) throw new Error('This application does not request that permission.')
  const reason = permissionRestriction(permission, state.targetSdk, state.sharedUidPackages.length > 1)
  if (reason) throw new Error(reason)
  if (permission.granted !== request.expectedGranted) throw new Error('The permission changed on the phone. Its current state has been updated; review it before trying again.')
  let failure: unknown
  try {
    // Exactly one mutation; no automatic retry, flag clearing, AppOps changes or root fallback.
    await command(['shell', ['pm', request.granted ? 'grant' : 'revoke', '--user', String(request.userId), request.packageName, request.permission].map(quote).join(' ')])
  } catch (error) { failure = error }
  let after: PermissionSnapshot
  try { after = await read() }
  catch {
    access.publish(request, null)
    throw new Error(`${failure instanceof Error ? failure.message + ' ' : ''}The permission result could not be verified. Refresh applications before retrying; the change may already have been applied.`)
  }
  if (failure) {
    if (failure instanceof Error && /SecurityException|Permission Denial|permission denied|not allowed|not a changeable permission/i.test(failure.message)) {
      const blocked = after.requestedPermissions.find(p => p.name === request.permission)
      if (blocked) {
        blocked.changeRestriction = `Android denied permission management: ${failure.message.slice(0, 1200)}. Refresh applications after changing the phone's access policy to check again.`
        access.publish(request, after)
      }
    }
    throw failure
  }
  if (after.requestedPermissions.find(p => p.name === request.permission)?.granted !== request.granted) throw new Error('Android did not apply the requested permission state. The current state is shown; the permission may depend on another permission or a device policy.')
}
