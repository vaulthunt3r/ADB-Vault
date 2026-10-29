export interface ScreenApplication { packageName: string; label: string }
export interface ScreenApplications { userId: number; applications: ScreenApplication[] }

// scrcpy --list-apps lists enabled, launchable applications. Long labels wrap
// onto a second line before the package column; do not split labels on spaces.
export function parseScreenApplications(output: string): ScreenApplication[] {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, '')
  const start = clean.indexOf('List of apps:')
  if (start < 0 || /\(access denied\)/i.test(clean)) throw new Error('Could not read applications from scrcpy. Check the connection and try again.')
  const apps = new Map<string, ScreenApplication>()
  const entries = clean.slice(start + 13).split(/\r?\n\s*[*-] /).slice(1)
  for (const entry of entries) {
    const match = /^([\s\S]*?)\s+([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)[ \t]*(?:\r?\n|$)/.exec(entry)
    if (!match) throw new Error('scrcpy returned an unreadable application list. Update scrcpy in Components.')
    const packageName = match[2], label = match[1].replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 160) || packageName
    apps.set(packageName, { packageName, label })
  }
  return [...apps.values()].sort((a, b) => a.label.localeCompare(b.label) || a.packageName.localeCompare(b.packageName))
}
