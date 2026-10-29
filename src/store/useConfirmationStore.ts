import { create } from 'zustand'
import type { ConfirmationState } from '../../electron/confirmation-protocol'

export const useConfirmationStore = create<ConfirmationState & { receive: (state?: ConfirmationState) => void }>((set) => ({
  revision: -1, prompt: null,
  receive: state => { if (state) set(previous => state.revision >= previous.revision ? state : previous) },
}))
