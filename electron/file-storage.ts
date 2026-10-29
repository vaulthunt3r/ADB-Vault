import type { FileStorage } from './files-protocol.js'
import type { AndroidProfile } from './app-profiles.js'

// Use explicit profile roots, never /sdcard aliases, for saved tabs and operations.
export function profileFileStorages(storages: FileStorage[], profiles: AndroidProfile[], primaryPath: string): FileStorage[] {
  const match = /^\/storage\/emulated\/(\d+)$/.exec(primaryPath)
  if (!match || !storages.some(s => s.kind === 'internal' && s.path === primaryPath)) return storages
  const primaryId = Number(match[1])
  const ids = [...new Set([primaryId, ...profiles.map(p => p.id)])]
  const internal = ids.map((id): FileStorage => {
    const profile = profiles.find(p => p.id === id)
    return { kind: 'internal', path: `/storage/emulated/${id}`, userId: id, primary: id === primaryId,
      name: `Internal storage · ${profile?.name || 'Profile'} · ID ${id}${profile?.managed ? ' · Work profile' : ''}` }
  })
  return [...internal, ...storages.filter(s => s.kind !== 'internal')]
}

// Android's DiskInfo/VolumeInfo dump distinguishes SD cards from USB disks.
// Only mounted, public paths are exposed; private/adopted volumes are not separate folders.
export function parseFileStorages(raw: string, primaryPath: string): FileStorage[] {
  const blocks = [...raw.matchAll(/^\s*(DiskInfo|VolumeInfo)\{([^}\r\n]+)\}:\s*\r?\n([\s\S]*?)(?=^\s*(?:DiskInfo|VolumeInfo|VolumeRecord)\{|^\S|(?![\s\S]))/gm)]
  if (!blocks.some(b => b[1] === 'VolumeInfo')) throw new Error('Android did not provide a supported storage list. Open /storage to browse available folders.')
  const field = (body: string, key: string) => body.match(new RegExp('(?:^|\\s)' + key + '=([^\\r\\n]*?)(?=\\s+\\w+=|[\\r\\n]|$)'))?.[1]?.trim() || ''
  const disks = new Map(blocks.filter(b => b[1] === 'DiskInfo').map(b => [b[2], field(b[3], 'flags')]))
  const volumes: FileStorage[] = [{ kind: 'internal', name: 'Internal storage', path: primaryPath }]
  for (const block of blocks.filter(b => b[1] === 'VolumeInfo')) {
    const body = block[3], type = field(body, 'type'), state = field(body, 'state'), p = field(body, 'path')
    if (!['PUBLIC', 'STUB', '0', '5'].includes(type) || !['MOUNTED', 'MOUNTED_READ_ONLY', '2', '3'].includes(state)) continue
    if (!/^\/storage\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(p) || ['/storage/emulated', '/storage/self'].includes(p)) continue
    const flags = disks.get(field(body, 'diskId')) || '', numeric = /^(?:0x[0-9a-f]+|\d+)$/i.test(flags) ? Number(flags) : 0
    const kind = flags.split('|').includes('SD') || numeric & 4 ? 'sd' : flags.split('|').includes('USB') || numeric & 8 ? 'usb' : 'external'
    const label = field(body, 'fsLabel'), name = kind === 'sd' ? 'SD card' : kind === 'usb' ? 'USB storage' : 'External storage'
    const storage: FileStorage = { kind, name: name + (label && label !== 'null' ? ' · ' + label : ''), path: p, readOnly: ['MOUNTED_READ_ONLY', '3'].includes(state) }
    // Some devices use a physical card as primary storage; avoid labelling it internal.
    const existing = volumes.findIndex(v => v.path === p)
    if (existing >= 0) volumes[existing] = storage
    else volumes.push(storage)
  }
  return volumes
}
