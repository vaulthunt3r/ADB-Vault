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
  const profileLabel = `Profile · ${profiles.length} ${profiles.length === 1 ? 'profile' : 'profiles'}`
  return <label className="apps-profile-picker"><span className="apps-profile-icon" title={profileLabel} aria-hidden="true"><Users size={16} /></span><select disabled={actionBusy} aria-label="Android profile" title={`${profileLabel}\nRead apps for this profile; does not switch the phone's active user`} value={userId ?? ''} onChange={event => void selectProfile(deviceId, Number(event.target.value))}>
    {!profiles.some(profile => profile.id === userId) && <option value={userId ?? ''} disabled>Select a profile</option>}
    {profiles.map(profile => <option key={profile.id} value={profile.id}>{androidProfileLabel(profile.id, profiles, currentUserId)}{backgroundUserId === profile.id ? " · Loading…" : cachedUserIds.includes(profile.id) ? " · Loaded" : preloadErrors[profile.id] ? " · Load failed" : !profile.running ? " · Not running" : ''}</option>)}
  </select><ChevronDown className="apps-profile-chevron" size={16} aria-hidden="true" /></label>
}
