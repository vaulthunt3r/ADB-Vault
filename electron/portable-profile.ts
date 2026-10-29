import { existsSync, mkdirSync, openSync, closeSync, unlinkSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

export const portableMarker = 'portable-mode'

export function portableProfilePath(executable: string, packaged: boolean, explicitProfile: boolean): string | undefined {
  if (!packaged || explicitProfile || !existsSync(path.join(path.dirname(executable), portableMarker))) return undefined
  return path.join(path.dirname(executable), 'data')
}

interface ProfileApp {
  setPath(name: 'userData' | 'sessionData' | 'crashDumps', value: string): void
  setAppLogsPath(value: string): void
}

// Run before Electron creates a session. Never silently fall back to AppData
// when a portable folder is read-only: that would split the user's profile.
export function configurePortableProfile(app: ProfileApp, root: string) {
  mkdirSync(root, { recursive: true })
  const probe = path.join(root, `.write-check-${randomUUID()}`)
  const handle = openSync(probe, 'wx')
  closeSync(handle)
  unlinkSync(probe)
  const session = path.join(root, 'session'), crashes = path.join(root, 'crashes'), logs = path.join(root, 'logs')
  for (const folder of [session, crashes, logs]) mkdirSync(folder, { recursive: true })
  app.setPath('userData', root)
  app.setPath('sessionData', session)
  app.setPath('crashDumps', crashes)
  app.setAppLogsPath(logs)
}
