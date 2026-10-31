import { t } from "../lib/i18n"
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { clampSidebarWidth, fitSidebarWidths } from '../lib/layout'
import { initialComponents, type ComponentId, type ManagedComponent } from '../lib/components'
import { requestBackend } from '../lib/backend'
import type { ActivitySource, BackendRequest } from '../../electron/contracts'
import type { ActivityOperation } from '../lib/activityOperation'
import type { FailureDiagnostic } from '../../electron/failure-diagnostics-protocol'
import type { ActivityItem } from '../../electron/history-protocol'
import { useHistoryStore } from './useHistoryStore'
import { defaultWorkspaceOrder, workspacePreferences, type WorkspaceId } from '../lib/workspaces'
export type { ActivityItem } from '../../electron/history-protocol'

export type Section = WorkspaceId | 'settings'
export type SidebarState = 'expanded' | 'collapsed'
export type LeftSidebarState = 'expanded' | 'icons'
export type InspectorTab = 'details' | 'actions'
interface AppState {
  settingsTab: 'screen' | 'notifications' | 'appearance' | 'workspaces' | 'files' | 'apps' | 'badges' | 'connection' | 'web-services'
  stopAdbOnExit: boolean
  section: Section
  appsView: 'installed' | 'apk' | 'removed' | 'notes'
  openLocalApks: () => void
  workspaceOrder: WorkspaceId[]
  hiddenWorkspaces: WorkspaceId[]
  setWorkspaceOrder: (order: WorkspaceId[]) => void
  setWorkspaceVisible: (id: WorkspaceId, visible: boolean) => void
  resetWorkspaces: () => void
  leftSidebar: LeftSidebarState
  rightSidebar: SidebarState
  leftWidth: number
  rightWidth: number
  inspectorTab: InspectorTab
  workspaceTabs: Partial<Record<Section, InspectorTab>>
  inspectorPins: Partial<Record<Section, InspectorTab | null>>
  selectedId: ComponentId
  components: ManagedComponent[]
  activity: ActivityItem[]
  historyManaged: boolean
  receiveActivity: (items: ActivityItem[]) => void
  selectedActivityId: number | null
  lastOperationId: number | null
  dismissedOperations: Set<string>
  recordOperation: (operation: ActivityOperation | null) => void
  recordDiagnostic: (diagnostic: FailureDiagnostic) => void
  dismissedDiagnostics: Set<string>
  openActivity: (id?: number) => void
  clearActivity: () => void
  notice: string | null
  noticeDurationMs: number
  locateId: ComponentId | null
  bulkBusy: boolean
  componentPending: boolean
  setSection: (section: Section) => void
  setSidebar: (...args: ['left', LeftSidebarState] | ['right', SidebarState]) => void
  setSidebarWidth: (side: 'left' | 'right', width: number) => void
  cycleSidebar: (side: 'left' | 'right') => void
  setTab: (tab: InspectorTab) => void
  toggleInspectorPin: (tab: InspectorTab) => void
  showInspector: (tab: InspectorTab) => void
  selectComponent: (id: ComponentId, showDetails?: boolean) => void
  notify: (text: string | null, durationMs?: number) => void
  log: (text: string, tone?: ActivityItem['tone'], source?: ActivitySource, device?: string, deviceName?: string) => void
  updateComponent: (id: ComponentId, patch: Partial<ManagedComponent>) => void
  operate: (id: ComponentId, action: 'detect' | 'install' | 'repair') => Promise<void>
  detectAll: () => Promise<void>
  installAll: () => Promise<void>
  setLocateId: (id: ComponentId | null) => void
  locate: (id: ComponentId, path: string, onError?: (message: string) => void) => Promise<boolean>
  openLocation: (id: ComponentId) => Promise<void>
}

const time = () => new Date().toISOString()
export async function requestComponent(request: BackendRequest, onError?: (message: string) => void) {
  if (useAppStore.getState().componentPending) return false
  useAppStore.setState({ componentPending: true })
  try { return await requestBackend(request, onError) }
  finally { useAppStore.setState({ componentPending: false }) }
}
let sequence = 1
function retainActivity(activity: ActivityItem[], dismissed: Set<string>, diagnostics: Set<string>) {
  const dismissedDiagnostics = new Set(diagnostics)
  const dismissedOperations = new Set(dismissed)
  while (activity.length > 500) {
    // Keep a running operation available for Stop even during a burst of other events.
    let index = activity.length - 1
    while (index >= 0 && activity[index].operation?.status === 'running') index--
    if (index < 0) break
    const [removed] = activity.splice(index, 1)
    if (removed.operation) dismissedOperations.add(removed.operation.key)
    if (removed.diagnostic) dismissedDiagnostics.add(removed.diagnostic.id)
  }
  return { activity, dismissedOperations, dismissedDiagnostics }
}

export const useAppStore = create<AppState>()(persist((set, get) => ({
  settingsTab: 'appearance', stopAdbOnExit: true,
  section: 'components', appsView: 'installed', openLocalApks: () => { get().setSection('apps'); set({ appsView: 'apk' }) }, leftSidebar: 'expanded', rightSidebar: 'expanded', inspectorTab: 'details', selectedId: 'adb',
  workspaceOrder: [...defaultWorkspaceOrder], hiddenWorkspaces: [],
  setWorkspaceOrder: order => set(state => workspacePreferences(order, state.hiddenWorkspaces)),
  setWorkspaceVisible: (id, visible) => set(state => {
    const preferences = workspacePreferences(state.workspaceOrder, visible ? state.hiddenWorkspaces.filter(item => item !== id) : [...state.hiddenWorkspaces, id])
    const section = !visible && state.section === id ? preferences.workspaceOrder.find(item => !preferences.hiddenWorkspaces.includes(item)) ?? 'settings' : state.section
    return { ...preferences, section, ...(section !== state.section ? { inspectorTab: state.inspectorPins[section] ?? state.workspaceTabs[section] ?? 'details' } : {}) }
  }),
  resetWorkspaces: () => set({ workspaceOrder: [...defaultWorkspaceOrder], hiddenWorkspaces: [] }),
  leftWidth: 204, rightWidth: 290,
  inspectorPins: {},
  workspaceTabs: {},
  components: initialComponents.map(component => ({ ...component })),
  activity: [], selectedActivityId: null, lastOperationId: null, dismissedOperations: new Set(), dismissedDiagnostics: new Set(),
  historyManaged: false,
  receiveActivity: items => set(state => {
    const finished = state.historyManaged ? items.find(i => i.operation && i.operation.status !== 'running' && state.activity.find(p => p.id === i.id)?.operation?.status !== i.operation.status) : undefined
    sequence = Math.max(sequence, ...items.map(i => i.id + 1))
    return { historyManaged: true, activity: items, ...(finished ? { lastOperationId: finished.id } : {}), ...(!items.length ? { lastOperationId: null } : {}) }
  }),
  recordDiagnostic: diagnostic => set(state => {
    if (state.historyManaged) return {}
    if (state.dismissedDiagnostics.has(diagnostic.id) || state.dismissedOperations.has(diagnostic.operationId)) return {}
    const previous = state.activity.find(item => item.operation?.key === diagnostic.operationId || item.diagnostic?.id === diagnostic.id)
    if (previous && JSON.stringify(previous.diagnostic) === JSON.stringify(diagnostic)) return {}
    const item: ActivityItem = previous ? { ...previous, diagnostic } : { id: sequence++, time: diagnostic.createdAt, text: diagnostic.title, tone: 'warning', source: 'apps', device: diagnostic.deviceId, deviceName: diagnostic.deviceName, diagnostic }
    return retainActivity(previous ? state.activity.map(entry => entry.id === item.id ? item : entry) : [item, ...state.activity].sort((a, b) => b.time.localeCompare(a.time)), state.dismissedOperations, state.dismissedDiagnostics)
  }),
  recordOperation: incoming => set(state => {
    if (state.historyManaged) return {}
    if (!incoming || state.dismissedOperations.has(incoming.key)) return {}
    let operation: ActivityOperation = incoming
    const previous = state.activity.find(i => i.operation?.key === operation.key || i.diagnostic?.operationId === operation.key)
    if (previous?.operation) operation = { ...operation, deviceName: previous.operation.deviceName, profileName: previous.operation.profileName }
    if (previous && JSON.stringify(previous.operation) === JSON.stringify(operation)) return {}
    const item: ActivityItem = { id: previous?.id ?? sequence++, time: operation.startedAt || previous?.time || time(), text: t("{0} · {1} applications", [operation.title, operation.items.length]), tone: operation.status === 'running' ? 'info' : operation.status === 'success' ? 'success' : 'warning', source: 'apps', device: operation.deviceName, operation,
      diagnostic: previous?.diagnostic, endedAt: operation.status === 'running' ? undefined : previous?.endedAt || time() }
    return { ...retainActivity(previous ? state.activity.map(i => i.id === item.id ? item : i) : [item, ...state.activity], state.dismissedOperations, state.dismissedDiagnostics), ...(operation.status !== 'running' && previous?.operation?.status !== operation.status ? { lastOperationId: item.id } : {}) }
  }),
  openActivity: id => { void useHistoryStore.getState().select('activity', null); set(state => ({ section: 'activity', ...(id !== undefined ? { selectedActivityId: id } : {}), inspectorTab: state.inspectorPins.activity ?? 'details', workspaceTabs: { ...state.workspaceTabs, [state.section]: state.inspectorTab, activity: 'details' } })) },
  clearActivity: () => { if (get().historyManaged) { void requestBackend({ type: 'history.clear' }); return }; set(state => ({ dismissedDiagnostics: new Set([...state.dismissedDiagnostics, ...state.activity.flatMap(i => i.diagnostic ? [i.diagnostic.id] : [])]), activity: [], selectedActivityId: null, lastOperationId: null, dismissedOperations: new Set([...state.dismissedOperations, ...state.activity.flatMap(i => i.operation ? [i.operation.key] : [])]) })) },
  notice: null, noticeDurationMs: 8000, locateId: null, bulkBusy: false, componentPending: false,
  setSection: section => set(state => section === state.section ? {} : ({ section, workspaceTabs: { ...state.workspaceTabs, [state.section]: state.inspectorTab }, inspectorTab: state.inspectorPins[section] ?? state.workspaceTabs[section] ?? 'details' })),
  setSidebar: (...[side, state]) => set(side === 'left' ? { leftSidebar: state } : { rightSidebar: state }),
  setSidebarWidth: (side, width) => {
    const value = clampSidebarWidth(side, width)
    const state = get()
    const other = side === 'left' ? state.rightSidebar === 'expanded' ? state.rightWidth : 0 : state.leftSidebar === 'expanded' ? state.leftWidth : 56
    const fit = fitSidebarWidths(window.innerWidth, side === 'left' ? value : other, side === 'right' ? value : other)
    set(side === 'left' ? { leftWidth: fit.left } : { rightWidth: fit.right })
  },
  cycleSidebar: side => {
    if (side === 'left') { const current = get().leftSidebar; set({ leftSidebar: current === 'expanded' ? 'icons' : 'expanded' }); return }
    const current = get().rightSidebar
    get().setSidebar(side, current === 'expanded' ? 'collapsed' : 'expanded')
  },
  setTab: inspectorTab => set(state => ({ inspectorTab, inspectorPins: { ...state.inspectorPins, [state.section]: state.inspectorPins[state.section] === inspectorTab ? inspectorTab : null } })),
  toggleInspectorPin: inspectorTab => set(state => ({ inspectorTab, inspectorPins: { ...state.inspectorPins, [state.section]: state.inspectorPins[state.section] === inspectorTab ? null : inspectorTab } })),
  showInspector: tab => set(state => ({ inspectorTab: state.inspectorPins[state.section] ?? tab, rightSidebar: 'expanded' })),
  selectComponent: (selectedId, showDetails = false) => set(state => ({ selectedId, ...(showDetails ? { inspectorTab: state.inspectorPins.components ?? 'details', rightSidebar: 'expanded' as const } : {}) })),
  notify: (notice, noticeDurationMs = 8000) => set({ notice, noticeDurationMs }),
  log: (text, tone = 'info', source = 'system', device, deviceName) => set(state => state.historyManaged ? {} : retainActivity([{ id: sequence++, time: time(), text, tone, source, device, deviceName }, ...state.activity], state.dismissedOperations, state.dismissedDiagnostics)),
  updateComponent: (id, patch) => set(state => ({ components: state.components.map(component => component.id === id ? { ...component, ...patch } : component) })),
  operate: async (id, action) => { await requestComponent({ type: 'components.action', id, action }) },
  detectAll: async () => { await requestComponent({ type: 'components.detect' }) },
  installAll: async () => {
    if (get().componentPending) return
    set({ bulkBusy: true })
    try { await requestComponent({ type: 'components.installAll' }) } finally { set({ bulkBusy: false }) }
  },
  setLocateId: locateId => set({ locateId }),
  locate: async (id, path, onError) => {
    const result = await requestComponent({ type: 'components.locate', id, folder: path.trim() }, onError)
    if (result && get().locateId === id) set({ locateId: null })
    return result
  },
  openLocation: async id => { await requestComponent({ type: 'components.open', id }) },
}), {
  name: 'adb-vault-layout', version: 1,
  partialize: state => ({ leftSidebar: state.leftSidebar, rightSidebar: state.rightSidebar, leftWidth: state.leftWidth, rightWidth: state.rightWidth, workspaceOrder: state.workspaceOrder, hiddenWorkspaces: state.hiddenWorkspaces }),
  merge: (saved, current) => {
    const stored = saved as { leftSidebar?: unknown; rightSidebar?: unknown; leftWidth?: unknown; rightWidth?: unknown; workspaceOrder?: unknown; hiddenWorkspaces?: unknown } | undefined
    const preferences = workspacePreferences(stored?.workspaceOrder, stored?.hiddenWorkspaces)
    const normalize = (value: unknown): SidebarState => value === 'collapsed' || value === 'hidden' ? 'collapsed' : 'expanded'
    return { ...current, ...preferences, section: preferences.workspaceOrder.find(id => !preferences.hiddenWorkspaces.includes(id)) ?? 'settings', leftSidebar: ['icons', 'collapsed', 'hidden'].includes(String(stored?.leftSidebar)) ? 'icons' : 'expanded', rightSidebar: normalize(stored?.rightSidebar), leftWidth: clampSidebarWidth('left', stored?.leftWidth), rightWidth: clampSidebarWidth('right', stored?.rightWidth) }
  },
}))
