import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { badgeAppearanceVariants, validBadgeColor } from '../lib/badgeAppearance'
const ids = new Set(badgeAppearanceVariants.map(b => b.id))
export function sanitizeBadgeColors(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([key, color]) => ids.has(key) && validBadgeColor(color)))
}
export const useBadgeAppearanceStore = create<{ colors: Record<string, string>; textColors: Record<string, string>; setTextColor: (id: string, color?: string) => void; setColor: (id: string, color: string) => void; reset: (id?: string) => void }>()(persist(set => ({
  colors: {}, textColors: {},
  setTextColor: (id, color) => { if (ids.has(id) && (color === undefined || validBadgeColor(color))) set(s => ({ textColors: color ? { ...s.textColors, [id]: color.toLowerCase() } : Object.fromEntries(Object.entries(s.textColors).filter(([key]) => key !== id)) })) },
  setColor: (id, color) => { if (ids.has(id) && validBadgeColor(color)) set(s => ({ colors: { ...s.colors, [id]: color.toLowerCase() } })) },
  reset: id => set(s => ({ colors: id ? Object.fromEntries(Object.entries(s.colors).filter(([key]) => key !== id)) : {}, textColors: id ? Object.fromEntries(Object.entries(s.textColors).filter(([key]) => key !== id)) : {} })),
}), { name: 'adb-vault-badge-colors', version: 1, partialize: s => ({ colors: s.colors, textColors: s.textColors }), merge: (saved, current) => ({ ...current, colors: sanitizeBadgeColors((saved as { colors?: unknown } | undefined)?.colors), textColors: sanitizeBadgeColors((saved as { textColors?: unknown } | undefined)?.textColors) }) }))
