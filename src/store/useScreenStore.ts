import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { DeviceRecord } from '../../electron/contracts'
import { screenDefaults, screenLaunch, validateScreenLaunch, type ScreenMode, type ScreenPreferences, type ScreenSession } from '../../electron/screen-protocol'

export function sanitizeScreenPreferences(value: unknown): ScreenPreferences {
  const source = value && typeof value === 'object' ? value as Partial<ScreenPreferences> : {}
  const clean = Object.fromEntries(Object.entries(screenDefaults).map(([key, fallback]) => [key, source[key as keyof ScreenPreferences] ?? fallback])) as unknown as ScreenPreferences
  try { validateScreenLaunch(screenLaunch(clean)); return clean } catch { return { ...screenDefaults } }
}
export const useScreenPreferences = create<{ preferences: ScreenPreferences; set: (value: ScreenPreferences) => void }>()(persist(set => ({
  preferences: { ...screenDefaults }, set: preferences => set({ preferences: sanitizeScreenPreferences(preferences) }),
}), { name: 'adb-vault-screen', version: 1, partialize: state => ({ preferences: state.preferences }), merge: (saved, current) => ({ ...current, preferences: sanitizeScreenPreferences((saved as { preferences?: unknown })?.preferences) }) }))

type ScreenApplication = { packageName: string; userId: number; label: string }
interface ScreenContext { device: DeviceRecord; mode?: ScreenMode; application?: ScreenApplication; suggestedApplication?: ScreenApplication }
export const useScreenStore = create<{ context: ScreenContext | null; sessions: ScreenSession[]; open: (device: DeviceRecord, application?: ScreenApplication, mode?: ScreenMode, suggestedApplication?: ScreenApplication) => void; close: () => void }>(set => ({
  context: null, sessions: [], open: (device, application, mode, suggestedApplication) => set({ context: { device: { ...device }, application, mode, suggestedApplication } }), close: () => set({ context: null }),
}))
