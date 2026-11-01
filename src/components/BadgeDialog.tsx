import { useEffect, useRef } from 'react'

export function BadgeDialog({ title, close, children, footer, heading, className = '', closeDisabled = false, closeLabel = 'Close' }: { title: string; close: () => void; children: React.ReactNode; footer?: React.ReactNode; heading?: React.ReactNode; className?: string; closeDisabled?: boolean; closeLabel?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const dialog = ref.current; dialog?.showModal()
    return () => { dialog?.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  return <dialog ref={ref} className={`locate-dialog app-badge-dialog ${className}`} aria-labelledby="badge-dialog-title" onCancel={e => { e.preventDefault(); if (!closeDisabled) close() }}>
    {heading ?? <h2 id="badge-dialog-title">{title}</h2>}<div className="app-badge-dialog-content">{children}</div>
    <div className="dialog-footer">{footer}<button autoFocus className="button secondary" disabled={closeDisabled} onClick={close}>{closeLabel}</button></div>
  </dialog>
}
