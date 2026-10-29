import { create } from 'zustand'
import type { AdbConsoleState, ConsoleMode, ConsoleTarget } from '../../electron/adb-console-protocol'
import { requestBackend } from '../lib/backend'

interface ConsoleStore extends AdbConsoleState {
  mode: ConsoleMode; command: string; timeout: number; pending: boolean; error: string
  receive: (state: AdbConsoleState) => void
  start: (target: ConsoleTarget) => Promise<void>
  stop: () => Promise<void>
  clear: () => Promise<void>
}
export const useAdbConsoleStore = create<ConsoleStore>((set, get) => ({
  revision: -1, run: null, history: [], mode: 'adb', command: '', timeout: 120000, pending: false, error: '',
  receive: state => { if (state.revision >= get().revision) set(state) },
  start: async target => {
    const s = get()
    if (s.pending || s.run?.status === 'running' || s.run?.status === 'stopping') return
    set({ pending: true, error: '' })
    try { await requestBackend({ type: 'console.run', target, mode: s.mode, command: s.command.trim(), timeout: s.timeout }, error => set({ error })) }
    finally { set({ pending: false }) }
  },
  stop: async () => {
    const s = get()
    if (s.pending || !s.run) return
    set({ pending: true, error: '' })
    try { await requestBackend({ type: 'console.stop', id: s.run.id }, error => set({ error })) }
    finally { set({ pending: false }) }
  },
  clear: async () => {
    if (get().pending) return
    set({ pending: true, error: '' })
    try { await requestBackend({ type: 'console.clear' }, error => set({ error })) }
    finally { set({ pending: false }) }
  },
}))
