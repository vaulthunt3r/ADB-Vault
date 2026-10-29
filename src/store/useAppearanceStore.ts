import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { findTheme, terminalAmberTheme, terminalThemes, type TerminalColor } from '../lib/themes'
import { isTerminalTitlePreset, normalizeTerminalTextSpeed, type TerminalTitlePreset } from '../lib/terminalTitle'

type Density = 'comfortable' | 'compact'
export type CornerStyle = 'rounded' | 'square'
function previousDensity(): Density {
  try {
    const density = JSON.parse(localStorage.getItem('adb-vault-apps-view') || 'null')?.state?.density === 'compact' ? 'compact' : 'comfortable'
    const saved = JSON.parse(localStorage.getItem('adb-vault-appearance') || 'null')
    // Save the old Apps preference before the table store drops its legacy field.
    if (density === 'compact' && saved?.state?.density === undefined) localStorage.setItem('adb-vault-appearance', JSON.stringify({ state: { ...saved?.state, density }, version: 1 }))
    return density
  } catch { return 'comfortable' }
}
interface AppearanceState {
  themeId: string; setTheme: (id: string) => void
  density: Density; setDensity: (density: Density) => void
  toolbarLabels: boolean; setToolbarLabels: (visible: boolean) => void
  cornerStyle: CornerStyle; setCornerStyle: (style: CornerStyle) => void
  zenMode: boolean; setZenMode: (enabled: boolean) => void
  terminalMode: boolean; toggleTerminalMode: () => void
  terminalColor: TerminalColor; setTerminalColor: (color: TerminalColor) => void
  terminalTitleAnimated: boolean; setTerminalTitleAnimated: (enabled: boolean) => void
  terminalTitlePreset: TerminalTitlePreset; setTerminalTitlePreset: (preset: TerminalTitlePreset) => void
  terminalTitleRepeat: boolean; setTerminalTitleRepeat: (repeat: boolean) => void
  terminalQuotesAnimated: boolean; setTerminalQuotesAnimated: (enabled: boolean) => void
  terminalTextSpeed: number; setTerminalTextSpeed: (speed: number) => void
  terminalPinned: boolean; toggleTerminalPin: () => void
  showTerminalTheme: boolean; setShowTerminalTheme: (visible: boolean) => void
}
export const useAppearanceStore = create<AppearanceState>()(persist(set => ({
  themeId: 'sage',
  density: previousDensity(),
  toolbarLabels: true,
  cornerStyle: 'rounded',
  zenMode: false,
  terminalMode: false,
  terminalColor: 'green',
  setTerminalColor: terminalColor => set({ terminalColor }),
  terminalTitleAnimated: true,
  terminalTitlePreset: 'terminal',
  terminalTitleRepeat: true,
  terminalQuotesAnimated: true,
  terminalTextSpeed: 1,
  setTerminalTitleAnimated: terminalTitleAnimated => set({ terminalTitleAnimated }),
  setTerminalTitlePreset: terminalTitlePreset => set({ terminalTitlePreset }),
  setTerminalTitleRepeat: terminalTitleRepeat => set({ terminalTitleRepeat }),
  setTerminalQuotesAnimated: terminalQuotesAnimated => set({ terminalQuotesAnimated }),
  setTerminalTextSpeed: speed => set({ terminalTextSpeed: normalizeTerminalTextSpeed(speed) }),
  terminalPinned: false,
  showTerminalTheme: false,
  toggleTerminalMode: () => set(state => ({ terminalMode: !state.terminalMode, terminalPinned: false })),
  toggleTerminalPin: () => set(state => state.terminalMode ? { terminalPinned: !state.terminalPinned } : state),
  setShowTerminalTheme: showTerminalTheme => set({ showTerminalTheme }),
  setZenMode: zenMode => set({ zenMode }),
  setDensity: density => set({ density }),
  setToolbarLabels: toolbarLabels => set({ toolbarLabels }),
  setCornerStyle: cornerStyle => set({ cornerStyle }),
  setTheme: id => set(terminalThemes.some(theme => theme.id === id)
    ? { terminalMode: true, terminalColor: id === terminalAmberTheme.id ? 'amber' : 'green' }
    : { themeId: findTheme(id).id, terminalMode: false, terminalPinned: false }),
}), {
  name: 'adb-vault-appearance', version: 1,
  partialize: state => ({ themeId: state.themeId, density: state.density, toolbarLabels: state.toolbarLabels, cornerStyle: state.cornerStyle, zenMode: state.zenMode, terminalColor: state.terminalColor, terminalPinned: state.terminalPinned, showTerminalTheme: state.showTerminalTheme, terminalTitleAnimated: state.terminalTitleAnimated, terminalTitlePreset: state.terminalTitlePreset, terminalTitleRepeat: state.terminalTitleRepeat, terminalQuotesAnimated: state.terminalQuotesAnimated, terminalTextSpeed: state.terminalTextSpeed }),
  merge: (saved, current) => {
    const value = saved as { themeId?: unknown; density?: unknown; toolbarLabels?: unknown; cornerStyle?: unknown; zenMode?: unknown; terminalColor?: unknown; terminalPinned?: unknown; showTerminalTheme?: unknown; terminalTitleAnimated?: unknown; terminalTitlePreset?: unknown; terminalTitleRepeat?: unknown; terminalQuotesAnimated?: unknown; terminalTextSpeed?: unknown } | undefined
    // Legacy terminalMode was saved automatically; only an explicit pin restores it now.
    return { ...current, themeId: findTheme(value?.themeId).id, density: value?.density === undefined ? current.density : value.density === 'compact' ? 'compact' : 'comfortable', toolbarLabels: value?.toolbarLabels !== false, cornerStyle: value?.cornerStyle === 'square' ? 'square' : 'rounded', zenMode: value?.zenMode === true, terminalColor: value?.terminalColor === 'amber' ? 'amber' : 'green', terminalMode: value?.terminalPinned === true, terminalPinned: value?.terminalPinned === true, showTerminalTheme: value?.showTerminalTheme === true,
      terminalTitleAnimated: value?.terminalTitleAnimated !== false,
      terminalTitlePreset: isTerminalTitlePreset(value?.terminalTitlePreset) ? value.terminalTitlePreset : 'terminal',
      terminalTitleRepeat: value?.terminalTitleRepeat !== false,
      terminalQuotesAnimated: value?.terminalQuotesAnimated !== false,
      terminalTextSpeed: normalizeTerminalTextSpeed(value?.terminalTextSpeed) }
  },
}))
