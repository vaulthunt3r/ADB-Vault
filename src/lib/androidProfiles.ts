import { t } from "./i18n"
import type { AndroidProfile } from '../../electron/app-profiles'

export function androidProfileLabel(id: number, profiles: AndroidProfile[], currentUserId: number | null) {
  const profile = profiles.find(p => p.id === id)
  return `${profile?.name || t("Profile")} · ID ${id}${profile?.managed ? t(" · Work profile") : ''}${id === currentUserId ? t(" · Current") : ''}`
}
