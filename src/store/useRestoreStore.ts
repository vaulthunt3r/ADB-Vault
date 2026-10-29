import { create } from 'zustand'
import { restoreBusy, type RestoreState } from '../../electron/app-restore-protocol'
import type { FileInstallSelection } from '../../electron/files-protocol'
export const useRestoreStore = create<{ state: RestoreState | null; visible: boolean; mode: 'restore' | 'install'; fileSelection: FileInstallSelection | null; filePreparing: boolean; fileError: string; open: (mode?: 'restore' | 'install') => void; close: () => void }>((set, get) => ({
  state: null, visible: false, mode: 'restore', fileSelection: null, filePreparing: false, fileError: '',
  open: (mode = 'restore') => set({ visible: true, mode: get().filePreparing ? 'install' : restoreBusy(get().state) ? get().state?.sourceKind === 'install' ? 'install' : 'restore' : mode, ...(!get().filePreparing && !restoreBusy(get().state) ? { fileSelection: null, fileError: '' } : {}) }), close: () => set({ visible: false }),
}))
export const useRestoreBusy = () => useRestoreStore(s => s.filePreparing || restoreBusy(s.state))
