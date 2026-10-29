import { create } from 'zustand'
import type { MonitorSample, MonitorTab } from '../../electron/monitor-protocol'
export interface MonitorPoint { time: number; sample: MonitorSample | null }
const empty = (): Record<MonitorTab, MonitorPoint[]> => ({ processes: [], memory: [], battery: [], network: [] })
interface MonitorState {
  context: string; tab: MonitorTab; paused: boolean; interval: number
  networkView: 'overview' | 'connections'
  networkFilter: { deviceId: string; userId: number; packageName: string } | null
  history: Record<MonitorTab, MonitorPoint[]>; error: string | null; reading: boolean
  reset: (context: string) => void
  append: (sample: MonitorSample) => void
  gap: (tab: MonitorTab) => void
}
export const useMonitorStore = create<MonitorState>((set) => ({
  context: '', tab: 'processes', paused: false, interval: 5, history: empty(), error: null, reading: false,
  networkView: 'overview', networkFilter: null,
  reset: context => set({ context, history: empty(), error: null, reading: false }),
  append: sample => set(s => ({ error: null, history: { ...s.history, [sample.tab]: [...s.history[sample.tab], { time: sample.time, sample }].slice(-120) } })),
  gap: tab => set(s => s.history[tab].length && s.history[tab].at(-1)?.sample ? { history: { ...s.history, [tab]: [...s.history[tab], { time: Date.now(), sample: null }].slice(-120) } } : {}),
}))
