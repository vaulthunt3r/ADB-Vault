import { t } from "../lib/i18n"
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
  return <select aria-label={t("{0} storage", [side])} className="fm-storage-select" disabled={!connected} value={selected?.path || '/'} title={storage.error || t("{0} · Each profile has separate internal storage. Android may restrict access to other profiles. Refresh updates this list.", [selected?.name || t("Choose storage")])} onChange={e => navigate({ ...location, path: e.target.value })}>
    {storage.entries.map(v => <option key={v.path} value={v.path}>{v.name}{v.readOnly ? t(" · Read only") : ''}</option>)}
    {!storage.entries.some(v => v.kind === 'sd') && <option disabled value="no-sd">{storage.loading ? t("Reading storage…") : storage.error ? t("SD card · Unavailable") : t("SD card · Not mounted")}</option>}
    <option value="/">{t("File system /")}</option>
    {storage.error && <option value="/storage">{t("Browse /storage…")}</option>}
  </select>
}
