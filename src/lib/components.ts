import { componentCatalog, databaseCatalog } from '../../electron/catalog'
import { geoipComponent } from '../../electron/network-protocol'
import type { ComponentRecord } from '../../electron/contracts'
export const statuses = ['Not installed', 'Detected', 'Installed', 'Package ready', 'Update available', 'Downloading', 'Installing', 'Checking', 'Repair needed', 'Not detected', 'Version mismatch', 'Download failed', 'Install failed', 'Blocked', 'Manual action required'] as const
export type ComponentStatus = typeof statuses[number]
export type { ComponentId } from '../../electron/contracts'
export type ManagedComponent = ComponentRecord & { statusBeforeCheck?: ComponentStatus }
export const settledStatus = (component: ManagedComponent) => component.status === 'Checking' ? component.statusBeforeCheck || component.status : component.status
export function retainCheckingStatus(next: ManagedComponent[], previous: ManagedComponent[]): ManagedComponent[] {
  return next.map(component => {
    const old = previous.find(item => item.id === component.id)
    return component.status === 'Checking' ? { ...component, statusBeforeCheck: old ? settledStatus(old) : undefined } : component
  })
}
// A check starts only when the desktop backend reports it, including database loading.
export const initialComponents = [...componentCatalog, ...databaseCatalog.map(component => ({ ...component, status: 'Not detected' as const })), geoipComponent]

export const isReady = (status: ComponentStatus) => status === 'Installed' || status === 'Detected'
export const isNotInstalled = (status: ComponentStatus) => status === 'Not installed' || status === 'Package ready'
export const statusLabel = (status: ComponentStatus) => status === 'Detected' ? "Installed" : status
export const isBusy = (status: ComponentStatus) => ['Checking', 'Downloading', 'Installing'].includes(status)
export const needsAttention = (status: ComponentStatus) => !isReady(status) && !isNotInstalled(status) && !isBusy(status)
export const isManual = (status: ComponentStatus) => status === 'Blocked' || status === 'Manual action required'
export function statusTone(status: ComponentStatus): 'success' | 'warning' | 'error' | 'neutral' | 'active' | 'info' | 'violet' {
  if (status === 'Package ready') return 'info'
  if (status === 'Update available') return 'violet'
  if (isReady(status)) return 'success'
  if (isBusy(status)) return 'active'
  if (['Download failed', 'Install failed', 'Blocked'].includes(status)) return 'error'
  if (status === 'Not installed') return 'neutral'
  return 'warning'
}

export function recoveryMessage(status: ComponentStatus) {
  const messages: Partial<Record<ComponentStatus, { title: string; body: string }>> = {
    "Not detected": { title: "Not found in standard locations", body: "Already installed? Locate the component manually, or download a fresh copy." },
    "Version mismatch": { title: "A different version was found", body: "The detected version does not match the required version. Repair it or locate a compatible copy." },
    "Download failed": { title: "The download was interrupted", body: "Your existing files are unchanged. Retry the download or locate a copy you already have." },
    "Install failed": { title: "Installation could not finish", body: "The component is not ready. Retry the repair or choose an existing installation manually." },
    "Repair needed": { title: "Some files need attention", body: "Repair the component to restore missing files, or locate a complete installation." },
    "Blocked": { title: "Automatic installation is blocked", body: "Installation was blocked. Use a manually prepared copy, then detect again." },
    "Manual action required": { title: "A manual step is required", body: "Follow the component instructions below, then check again. Bulk repair will skip this item." },
    "Update available": { title: "An update is available", body: "Download the latest available version to bring this component up to date." },
  }
  return messages[status]
}
