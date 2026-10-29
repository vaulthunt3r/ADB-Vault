import { create } from 'zustand'
import type { AppsSnapshot } from '../../electron/apps-protocol'
import type { ConnectionSnapshot } from '../../electron/contracts'

interface AppsSelectionState {
  deviceId: string | null
  userId: number | null
  packages: Set<string>
  setRows: (packages: string[], checked: boolean) => void
  clear: () => void
  replace: (deviceId: string, userId: number, packages: string[]) => boolean
  reconcile: (snapshot: AppsSnapshot) => void
  connectionChanged: (snapshot: ConnectionSnapshot) => void
}

// Session-only marks, independent of the package displayed in the inspector.
export const useAppsSelectionStore = create<AppsSelectionState>((set, get) => ({
  deviceId: null, userId: null, packages: new Set(),
  setRows: (rows, checked) => set(state => {
    const packages = new Set(state.packages)
    for (const row of rows) { if (checked) packages.add(row); else packages.delete(row) }
    return { packages }
  }),
  clear: () => set({ packages: new Set() }),
  replace: (deviceId, userId, packages) => {
    const state = get()
    if (state.deviceId !== deviceId || state.userId !== userId) return false
    set({ packages: new Set(packages) })
    return true
  },
  reconcile: snapshot => {
    const state = get()
    if (state.deviceId !== snapshot.deviceId || state.userId !== snapshot.userId) {
      set({ deviceId: snapshot.deviceId, userId: snapshot.userId, packages: new Set() }); return
    }
    if (snapshot.status !== 'ready' || !state.packages.size) return
    const existing = new Set(snapshot.apps.map(app => app.packageName))
    const packages = new Set([...state.packages].filter(pkg => existing.has(pkg)))
    if (packages.size !== state.packages.size) set({ packages })
  },
  connectionChanged: snapshot => {
    const state = get()
    if (state.packages.size && (snapshot.activeDeviceId !== state.deviceId || !snapshot.devices.some(device => device.id === state.deviceId && device.status === 'connected'))) state.clear()
  },
}))
