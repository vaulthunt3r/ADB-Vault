import { t } from "./i18n"
import { Activity, Box, Cable, FolderClosed, Gauge, Grid2X2, Terminal } from 'lucide-react'

export const workspaces = [
  { id: 'components', get name() { return t("Components") }, icon: Box },
  { id: 'connection', get name() { return t("Connection") }, icon: Cable },
  { id: 'apps', get name() { return t("Apps") }, icon: Grid2X2 },
  { id: 'files', get name() { return t("Files") }, icon: FolderClosed },
  { id: 'monitor', get name() { return t("Monitor") }, icon: Gauge },
  { id: 'activity', get name() { return t("Activity") }, icon: Activity },
  { id: 'console', get name() { return t("Console") }, icon: Terminal },
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
