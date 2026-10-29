import { t as translateUi } from '../lib/i18n'
import { t } from "../lib/i18n"
import { useRestoreBusy } from '../store/useRestoreStore'
import { useBackupStore } from '../store/useBackupStore'
import { useAppActionsStore } from '../store/useAppActionsStore'
import { ChevronDown, Users } from 'lucide-react'
import { useAppsStore } from '../store/useAppsStore'
import { androidProfileLabel } from '../lib/androidProfiles'
export function AppsProfilePicker({ deviceId }: { deviceId: string | null }) {
  const { profiles, userId, currentUserId, selectProfile, cachedUserIds, backgroundUserId, preloadErrors } = useAppsStore()
  const restoring = useRestoreBusy()
  const backupBusy = useBackupStore(s => s.state?.status === 'running') || restoring
  const actionBusy = useAppActionsStore(s => s.action?.status === 'running') || backupBusy
  if (!deviceId || !profiles.length) return null
  const profileLabel = translateUi("Profile · {0} {1}", [profiles.length, profiles.length === 1 ? 'profile' : 'profiles'])
  return <label className="apps-profile-picker"><span className="apps-profile-icon" title={profileLabel} aria-hidden="true"><Users size={16} /></span><select disabled={actionBusy} aria-label={t("Android profile")} title={t("{0}\nRead apps for this profile; does not switch the phone's active user", [profileLabel])} value={userId ?? ''} onChange={event => void selectProfile(deviceId, Number(event.target.value))}>
    {!profiles.some(profile => profile.id === userId) && <option value={userId ?? ''} disabled>{t("Select a profile")}</option>}
    {profiles.map(profile => <option key={profile.id} value={profile.id}>{androidProfileLabel(profile.id, profiles, currentUserId)}{backgroundUserId === profile.id ? t(" · Loading…") : cachedUserIds.includes(profile.id) ? t(" · Loaded") : preloadErrors[profile.id] ? t(" · Load failed") : !profile.running ? t(" · Not running") : ''}</option>)}
  </select><ChevronDown className="apps-profile-chevron" size={16} aria-hidden="true" /></label>
}
