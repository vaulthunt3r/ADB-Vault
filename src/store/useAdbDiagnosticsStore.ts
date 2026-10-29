import { create } from 'zustand'
import type { AdbDiagnostics } from '../../electron/contracts'
import { requestComponent } from './useAppStore'

export const useAdbDiagnosticsStore = create<{ diagnostics: AdbDiagnostics | null; refreshing: boolean; refresh: () => Promise<void> }>((set, get) => ({
  diagnostics: null, refreshing: false,
  refresh: async () => {
    if (get().refreshing) return
    set({ refreshing: true })
    try { await requestComponent({ type: 'components.adbDiagnostics' }) } finally { set({ refreshing: false }) }
  },
}))
