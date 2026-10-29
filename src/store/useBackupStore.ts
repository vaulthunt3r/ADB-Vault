import { create } from 'zustand'
import type { BackupState, PresetPreview, ExportDestinationSettings } from '../../electron/app-backup-protocol'
export interface BackupScope { packages: string[]; hidden: number; name: string }
interface BackupDialogContext extends BackupScope { purpose: 'backup' | 'preset'; id: string; userId: number; scope?: 'current' | 'marked'; scopes?: Record<'current' | 'marked', BackupScope> }
export const useBackupStore = create<{
  state: BackupState | null; preview: PresetPreview | null; dialog: BackupDialogContext | null
  destination: ExportDestinationSettings
  apkZstd: boolean
  open: (context: BackupDialogContext) => void; close: () => void
}>(set => ({ state: null, preview: null, dialog: null, apkZstd: false, destination: { mode: 'ask', folder: null }, open: dialog => set({ dialog }), close: () => set({ dialog: null }) }))
