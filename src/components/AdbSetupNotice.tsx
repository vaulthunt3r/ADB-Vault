import { FolderSearch } from 'lucide-react'
import { t } from '../lib/i18n'
import { isBusy } from '../lib/components'
import { useAppStore } from '../store/useAppStore'

export function AdbSetupNotice() {
  const adb = useAppStore(s => s.components.find(component => component.id === 'adb'))
  const pending = useAppStore(s => s.componentPending || s.bulkBusy || s.components.some(c => isBusy(c.status)))
  const choose = useAppStore(s => s.setLocateId)
  const install = useAppStore(s => s.operate)
  if (!adb || isBusy(adb.status) || adb.location) return null
  return <div className="adb-setup-notice">
    <div><strong>{t("ADB setup")}</strong><p>{t("No working ADB was found. If you already have the Android SDK, choose its adb.exe or platform-tools folder.")}</p></div>
    <div className="adb-setup-actions">
      <button className="button primary" disabled={pending} onClick={() => choose('adb')}><FolderSearch size={15} />{t("Use existing ADB")}</button>
      <button className="text-button" disabled={pending} onClick={() => void install('adb', 'install')}>{t("Download Platform Tools")}</button>
    </div>
  </div>
}
