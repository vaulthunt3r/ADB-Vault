import { AlertCircle, Check, Circle, Download, FolderOpen, PackageCheck, PanelTopOpen, ShieldAlert } from 'lucide-react'
import { LatticeLoader } from './operation-chip/OperationChip'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { isBusy, isReady, statusLabel, statusTone, type ComponentStatus } from '../lib/components'

export function IconButton({ label, children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return <button type="button" className={`icon-button ${className}`} title={label} aria-label={label} {...props}>{children}</button>
}
export function ActionIndicator({ picker = false }: { picker?: boolean }) {
  const Icon = picker ? FolderOpen : PanelTopOpen
  return <Icon size={14} className="action-indicator" aria-hidden="true" />
}
export function StatusBadge({ status }: { status: ComponentStatus }) {
  const Icon = isReady(status) ? Check : status === 'Package ready' ? PackageCheck : status === 'Blocked' ? ShieldAlert : status === 'Not installed' ? Circle : status === 'Update available' ? Download : AlertCircle
  return <span className={`status-badge ${statusTone(status)}`} title={status === 'Detected' ? "Already installed on this computer; installation verified." : undefined}>{isBusy(status) ? <LatticeLoader /> : <Icon size={12} />}{statusLabel(status)}</span>
}
