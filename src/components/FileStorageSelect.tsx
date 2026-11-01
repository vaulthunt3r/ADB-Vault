import { useEffect } from 'react'
import type { FileLocation, FileStorage } from '../../electron/files-protocol'
import { storageKey, useFilesStore } from '../store/useFilesStore'

const internal: FileStorage = { kind: 'internal', name: 'Internal storage', path: '/sdcard' }
export function useFileStorages(location: FileLocation, connected: boolean) {
  const key = storageKey(location), state = useFilesStore(s => s.storages[key]), load = useFilesStore(s => s.loadStorages)
  useEffect(() => { if (connected && location.kind === 'device') void load(location) }, [key, connected, load])
  return { ...state, loading: state?.loading ?? connected, entries: state?.entries || [internal] }
}

export function FileStorageSelect({ location, connected, side, navigate }: { location: FileLocation; connected: boolean; side: string; navigate: (l: FileLocation) => void }) {
  const storage = useFileStorages(location, connected)
  const primary = storage.entries.find(v => v.primary) || storage.entries.find(v => v.kind === 'internal')
  const selected = storage.entries.find(v => location.path === v.path || location.path.startsWith(v.path + '/') || v === primary && /^\/(?:sdcard|storage\/self\/primary)(?:\/|$)/.test(location.path))
  return <select aria-label={`${side} storage`} className="fm-storage-select" disabled={!connected} value={selected?.path || '/'} title={storage.error || `${selected?.name || "Choose storage"} · Each profile has separate internal storage. Android may restrict access to other profiles. Refresh updates this list.`} onChange={e => navigate({ ...location, path: e.target.value })}>
    {storage.entries.map(v => <option key={v.path} value={v.path}>{v.name}{v.readOnly ? " · Read only" : ''}</option>)}
    {!storage.entries.some(v => v.kind === 'sd') && <option disabled value="no-sd">{storage.loading ? "Reading storage…" : storage.error ? "SD card · Unavailable" : "SD card · Not mounted"}</option>}
    <option value="/">File system /</option>
    {storage.error && <option value="/storage">Browse /storage…</option>}
  </select>
}
