import { create } from 'zustand'
import type { AppActionState } from '../../electron/app-actions-protocol'
export const useAppActionsStore = create<{ action: AppActionState | null }>(() => ({ action: null }))
