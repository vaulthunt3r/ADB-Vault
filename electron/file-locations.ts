import type { FileLocation } from './files-protocol.js'

export const isNetworkPath = (value: string) => value.startsWith('\\\\')

/** SMB URLs are only an input convenience; file operations use Windows UNC. */
export function networkPath(value: string): string {
  let p = value.trim()
  if (/^smb:\/\//i.test(p)) {
    const raw = p.slice(6)
    const slash = raw.indexOf('/')
    if (slash < 1 || /[@:?#\\]/.test(raw.slice(0, slash)) || /[?#\\]/.test(raw)) throw new Error('Use smb://server/share/folder without credentials or a port.')
    const parts = raw.slice(slash + 1).split('/').map(segment => {
      let decoded: string
      try { decoded = decodeURIComponent(segment) } catch { throw new Error('Invalid SMB address encoding.') }
      if (/[\\/]/.test(decoded)) throw new Error('An SMB path segment cannot contain a separator.')
      return decoded
    })
    p = '\\\\' + raw.slice(0, slash) + '\\' + parts.join('\\')
  }
  if (p.length > 4096 || !isNetworkPath(p) || /[\x00-\x1f/<>:"|?*]/.test(p)) throw new Error('Enter a network folder such as \\\\server\\share.')
  p = p.replace(/\\+$/, '')
  const [server, share, ...parts] = p.slice(2).split('\\')
  if (!server || !/^[\p{L}\p{N}_-][\p{L}\p{N}_.-]*$/u.test(server) || /[. ]$/.test(server) || !share || /^IPC\$$/i.test(share) || [share, ...parts].some(v => !v || v === '.' || v === '..' || /[. ]$/.test(v) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(v))) throw new Error('Enter a server and a disk share; device namespaces and . / .. segments are not supported.')
  return p
}
export const networkRoot = (value: string) => networkPath(value).split('\\').slice(0, 4).join('\\')
export const fileSourceLabel = (l: FileLocation) => l.kind === 'device' ? l.serial || 'Phone' : isNetworkPath(l.path) ? 'SMB / Samba' : 'This PC'

export function fileParentPath(l: FileLocation): string {
  if (!l.path || l.path === '/') return l.kind === 'local' ? '' : l.path
  const p = l.path.replace(/[\\/]+$/, '')
  if (l.kind === 'local' && isNetworkPath(p) && networkRoot(p) === p || /^[a-z]:$/i.test(p)) return ''
  const cut = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  const parent = p.slice(0, cut)
  return /^[a-z]:$/i.test(parent) ? parent + '\\' : parent || '/'
}
export function fileBreadcrumbs(l: FileLocation): { name: string; path: string }[] {
  if (l.kind === 'local' && isNetworkPath(l.path)) {
    const root = networkRoot(l.path), rest = l.path.slice(root.length).split('\\').filter(Boolean)
    return [{ name: root, path: root }, ...rest.map((name, i) => ({ name, path: root + '\\' + rest.slice(0, i + 1).join('\\') }))]
  }
  const separator = l.kind === 'device' || l.path.startsWith('/') ? '/' : '\\'
  return l.path.split(/[\\/]/).filter(Boolean).map((name, i, parts) => ({ name, path: (separator === '/' ? '/' : '') + parts.slice(0, i + 1).join(separator) + (separator === '\\' && i === 0 ? '\\' : '') }))
}
