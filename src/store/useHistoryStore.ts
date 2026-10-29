import { create } from 'zustand'
import type { HistoryOverview, SavedSession } from '../../electron/history-protocol'
import { useAppStore } from './useAppStore'

interface HistoryStore {
  overview?: HistoryOverview; activitySession: string | null; filesSession: string | null
  archives: Record<string, SavedSession>; loading: string[]; error?: string; dismissedRecovery: boolean
  receive: (overview: HistoryOverview) => void
  select: (view: 'activity' | 'files', id: string | null) => Promise<void>
  refresh: () => Promise<void>
}
export const useHistoryStore = create<HistoryStore>((set, get) => ({
  activitySession: null, filesSession: null, archives: {}, loading: [], dismissedRecovery: false,
  receive: overview => {
    const previous = get().overview?.current.id
    if (overview.error && overview.error !== get().overview?.error) useAppStore.getState().notify(overview.error)
    set({ overview, ...(previous && previous !== overview.current.id ? { activitySession: null, filesSession: null, archives: {}, dismissedRecovery: false } : {}) })
    if (overview.activity) useAppStore.getState().receiveActivity(overview.activity)
  },
  refresh: async () => {
    if (!window.desktop) return
    try { const reply = await window.desktop.request({ type: 'history.list' }); if (!reply.ok) throw new Error(reply.error); if (reply.snapshot.history) get().receive(reply.snapshot.history) }
    catch (error) { set({ error: String(error) }) }
  },
  select: async (view, id) => {
    set({ [view === 'activity' ? 'activitySession' : 'filesSession']: id, error: undefined })
    if (view === 'activity') useAppStore.setState({ selectedActivityId: null })
    if (!id || !window.desktop) return
    set(s => ({ loading: [...s.loading, id] }))
    try {
      const reply = await window.desktop.request({ type: 'history.read', sessionId: id })
      if (!reply.ok) throw new Error(reply.error)
      if (!reply.historySession) throw new Error('This history session is unavailable.')
      set(s => ({ archives: { ...s.archives, [id]: reply.historySession! } }))
    } catch (error) { set({ error: String(error) }) }
    finally { set(s => ({ loading: s.loading.filter(value => value !== id) })) }
  },
}))
