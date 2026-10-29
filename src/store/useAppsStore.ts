import { t } from "../lib/i18n"
import { create } from 'zustand'
import { emptyApps, type AppsSnapshot } from '../../electron/apps-protocol'
import { requestBackend } from '../lib/backend'
import { useAppStore } from './useAppStore'
import { useAppsSelectionStore } from './useAppsSelectionStore'
const pendingDetails = new Map<string, Promise<boolean>>()
export function readAppDetails(id: string, userId: number, packageName: string) {
  const key = JSON.stringify([id, userId, packageName])
  const pending = pendingDetails.get(key)
  if (pending) return pending
  const request = requestBackend({ type: 'apps.details', id, userId, packageName }).finally(() => pendingDetails.delete(key))
  pendingDetails.set(key, request); return request
}
interface AppsState extends AppsSnapshot {
  selectedRemovedPackage: string | null
  selectRemoved: (packageName: string) => void
  selectedPackage: string | null
  refresh: (id: string, userId?: number) => Promise<void>
  selectProfile: (id: string, userId: number) => Promise<void>
  cancel: () => Promise<void>
  select: (packageName: string) => void
}
export const useAppsStore = create<AppsState>((set, get) => ({
  ...emptyApps(), selectedPackage: null, selectedRemovedPackage: null,
  selectRemoved: selectedRemovedPackage => { set({ selectedRemovedPackage }); useAppStore.getState().showInspector('details') },
  refresh: async (id, requestedUserId) => {
    if (get().status === 'loading') return
    const previous = get().deviceId === id ? get() : emptyApps()
    const userId = requestedUserId ?? previous.userId ?? undefined
    set({ ...emptyApps(), options: get().options, loadingMode: get().loadingMode, cachedUserIds: previous.cachedUserIds, deviceId: id, userId: userId ?? null, profiles: previous.profiles, currentUserId: previous.currentUserId, status: 'loading', message: t("Starting application collection…"), selectedPackage: null })
    if (!await requestBackend({ type: 'apps.refresh', id, ...(userId !== undefined ? { userId } : {}) }) && get().status === 'loading') set({ status: 'error', error: 'Could not collect applications. Check the device connection and retry.' })
  },
  selectProfile: async (id, userId) => { await requestBackend({ type: 'apps.selectProfile', id, userId }) },
  cancel: async () => { await requestBackend({ type: 'apps.cancel' }) },
  select: selectedPackage => {
    set({ selectedPackage })
    const inspector = useAppStore.getState()
    inspector.showInspector(inspector.section === 'apps' && useAppsSelectionStore.getState().packages.size && inspector.inspectorTab === 'actions' ? 'actions' : 'details')
  },
}))
export function receiveApps(snapshot: AppsSnapshot) {
  useAppsSelectionStore.getState().reconcile(snapshot)
  const previous = useAppsStore.getState()
  if (previous.deviceId === snapshot.deviceId && previous.userId === snapshot.userId && previous.badgeRead?.status === 'running' && snapshot.badgeRead && snapshot.badgeRead.status !== 'running') {
    const read = snapshot.badgeRead
    useAppStore.getState().notify(`Badge reading ${read.status === 'complete' ? 'complete' : 'cancelled'} · ${read.completed} / ${read.total}${read.failed ? ` · ${read.failed} failed` : ''}`, 5000)
  }
  useAppsStore.setState({ ...snapshot, removedApps: snapshot.removedApps || [], selectedRemovedPackage: snapshot.deviceId === previous.deviceId && snapshot.userId === previous.userId && snapshot.removedApps?.some(a => a.packageName === previous.selectedRemovedPackage) ? previous.selectedRemovedPackage : null, badgeEvidence: snapshot.badgeEvidence ?? {}, badgeRead: snapshot.badgeRead, details: snapshot.details ?? null, selectedPackage: snapshot.deviceId === previous.deviceId && snapshot.userId === previous.userId && (snapshot.status === 'loading' || snapshot.apps.some(a => a.packageName === previous.selectedPackage)) ? previous.selectedPackage : null })
}
