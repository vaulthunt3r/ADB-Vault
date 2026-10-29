export interface AndroidProfile { id: number; name: string; running: boolean; managed: boolean }
// `pm list users` uses UserInfo.toString(): ID:name:hexFlags. Names can contain colons.
export function parseAndroidProfiles(output: string): AndroidProfile[] {
  const profiles: AndroidProfile[] = []
  for (const line of output.split(/\r?\n/)) {
    const match = line.trim().match(/^UserInfo\{(\d{1,5}):(.*):([0-9a-fA-F]+)\}(.*)$/)
    if (!match) continue
    const id = Number(match[1]), flags = Number.parseInt(match[3], 16)
    if (profiles.some(profile => profile.id === id)) throw new Error('Duplicate Android profile ID.')
    profiles.push({ id, name: match[2].trim() || `User ${id}`, running: /\brunning\b/.test(match[4]), managed: (flags & 0x20) !== 0 })
  }
  if (!profiles.length) throw new Error('Android did not return an accessible profile list.')
  return profiles.sort((a, b) => a.id - b.id)
}
