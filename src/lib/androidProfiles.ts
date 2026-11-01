import type { AndroidProfile } from '../../electron/app-profiles'

export function androidProfileLabel(id: number, profiles: AndroidProfile[], currentUserId: number | null) {
  const profile = profiles.find(p => p.id === id)
  return `${profile?.name || "Profile"} · ID ${id}${profile?.managed ? " · Work profile" : ''}${id === currentUserId ? " · Current" : ''}`
}
