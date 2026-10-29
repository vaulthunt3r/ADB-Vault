import { create } from 'zustand'
import type { AppNotesState } from '../../electron/app-notes-protocol'
export const useAppNotesStore = create<AppNotesState>(() => ({ status: 'loading', entries: [], error: null }))
