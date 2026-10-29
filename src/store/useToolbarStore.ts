import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { defaultToolbarActions, normalizeToolbarActions, toolbarConfig, toolbarWorkspaces, type ToolbarActionId, type ToolbarConfig, type ToolbarScope, type ToolbarWorkspace } from '../lib/toolbar'

interface ToolbarState extends ToolbarConfig {
  overrides: Partial<Record<ToolbarWorkspace, ToolbarConfig>>
  setShowDevice: (show: boolean, scope?: ToolbarScope) => void
  setPinned: (pinned: ToolbarActionId[], scope?: ToolbarScope) => void
  setOperationPosition: (position: 'start' | 'end', scope?: ToolbarScope) => void
  setCustom: (scope: ToolbarWorkspace, enabled: boolean) => void
  reset: () => void
}
const defaults = (): ToolbarConfig => ({ pinned: [...defaultToolbarActions], operationPosition: 'end', showDevice: true })
function copyConfig(value: ToolbarConfig): ToolbarConfig {
  return { pinned: [...value.pinned], operationPosition: value.operationPosition, showDevice: value.showDevice }
}
function change(state: ToolbarState, scope: ToolbarScope, patch: Partial<ToolbarConfig>) {
  return scope === 'shared' ? patch : { overrides: { ...state.overrides, [scope]: { ...copyConfig(toolbarConfig(state, scope)), ...patch } } }
}
function normalizeConfig(value: Partial<ToolbarConfig> | undefined): ToolbarConfig {
  return { pinned: normalizeToolbarActions(value?.pinned), operationPosition: value?.operationPosition === 'start' ? 'start' : 'end', showDevice: value?.showDevice !== false }
}
export const useToolbarStore = create<ToolbarState>()(persist(set => ({
  ...defaults(), overrides: {},
  setShowDevice: (showDevice, scope = 'shared') => set(state => change(state, scope, { showDevice })),
  setPinned: (pinned, scope = 'shared') => set(state => change(state, scope, { pinned: normalizeToolbarActions(pinned) })),
  setOperationPosition: (operationPosition, scope = 'shared') => set(state => change(state, scope, { operationPosition })),
  setCustom: (scope, enabled) => set(state => {
    const overrides = { ...state.overrides }
    if (enabled) overrides[scope] = copyConfig(toolbarConfig(state, scope))
    else delete overrides[scope]
    return { overrides }
  }),
  // Reset shared settings without erasing deliberately customized workspaces.
  reset: () => set(defaults()),
}), {
  name: 'adb-vault-toolbar', version: 1,
  partialize: state => ({ ...copyConfig(state), overrides: state.overrides }),
  merge: (saved, current) => {
    const value = saved as Partial<ToolbarState> | undefined
    const overrides: ToolbarState['overrides'] = {}
    for (const { id } of toolbarWorkspaces) {
      const item = value?.overrides?.[id]
      if (item && typeof item === 'object' && !Array.isArray(item)) overrides[id] = normalizeConfig(item)
    }
    return { ...current, ...normalizeConfig(value), overrides }
  },
}))
