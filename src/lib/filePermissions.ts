import type { FileEntry } from '../../electron/files-protocol'

export function fileAccessHint(entry: FileEntry, root = false) {
  const reason = entry.fingerprint ? entry.kind === 'directory' || entry.kind === 'link' ? "This folder failed the read or enter check for the current access." : "Android denied access to this object with the current access." : "Android reported this name but denied its properties. Its type, size and contents are unknown."
  return `${reason} ${root ? "Access is restricted even with root enabled." : "Root may help: check root access in Connection, then enable the shield in this Files tab."} Root does not guarantee access to every folder.`
}

export function permissionGroups(mode: string | undefined, directory = false) {
  if (!mode || !/^[0-7]{1,4}$/.test(mode)) return []
  const rights = directory ? ['List names', 'Create/remove entries', 'Enter/traverse'] : ['Read', 'Write', 'Execute']
  return mode.padStart(3, '0').slice(-3).split('').map((digit, index) => ({
    label: ['Owner', 'Group', 'Others'][index], digit,
    text: rights.filter((_, n) => Number(digit) & [4, 2, 1][n]).join(' · ') || "No permissions",
  }))
}

export function permissionSummary(mode: string | undefined, directory = false) {
  const groups = permissionGroups(mode, directory)
  if (!groups.length) return "Permissions unavailable"
  const special = mode!.length === 4 ? Number(mode![0]) : 0
  const flags = ['Set user ID', 'Set group ID', 'Sticky bit'].filter((_, n) => special & [4, 2, 1][n])
  return groups.map(g => `${g.label} (${g.digit}): ${g.text}`).join('\n') + (flags.length ? '\nSpecial flags: ' + flags.join(', ') : '')
}
