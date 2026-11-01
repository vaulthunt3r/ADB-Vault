import { Activity, Box, Cable, FolderClosed, Gauge, Grid2X2, Terminal } from 'lucide-react'

export const workspaces = [
  { id: 'components', name: "Components", icon: Box },
  { id: 'connection', name: "Connection", icon: Cable },
  { id: 'apps', name: "Apps", icon: Grid2X2 },
  { id: 'files', name: "Files", icon: FolderClosed },
  { id: 'monitor', name: "Monitor", icon: Gauge },
  { id: 'activity', name: "Activity", icon: Activity },
  { id: 'console', name: "Console", icon: Terminal },
] as const
export type WorkspaceId = typeof workspaces[number]['id']
export const defaultWorkspaceOrder: WorkspaceId[] = workspaces.map(item => item.id)
const isWorkspace = (value: unknown): value is WorkspaceId => typeof value === 'string' && defaultWorkspaceOrder.includes(value as WorkspaceId)
export function workspacePreferences(order: unknown, hidden: unknown) {
  const knownOrder = Array.isArray(order) ? order.filter(isWorkspace) : []
  return {
    workspaceOrder: [...new Set([...knownOrder, ...defaultWorkspaceOrder])],
    hiddenWorkspaces: [...new Set(Array.isArray(hidden) ? hidden.filter(isWorkspace) : [])],
  }
}
