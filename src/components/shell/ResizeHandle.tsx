import { useRef } from 'react'
import { sidebarLimits } from '../../lib/layout'
import { useAppStore } from '../../store/useAppStore'

export function ResizeHandle({ side, width }: { side: 'left' | 'right'; width: number }) {
  const start = useRef({ x: 0, width: 0 })
  const setSidebarWidth = useAppStore(state => state.setSidebarWidth)
  const limits = sidebarLimits[side]
  return <div role="separator" tabIndex={0} aria-label={`Resize ${side} sidebar`} aria-orientation="vertical" aria-valuemin={limits.min} aria-valuemax={limits.max} aria-valuenow={width} className={`sidebar-resize ${side}`} title="Drag to resize · Double-click to reset" onPointerDown={event => {
    if (event.button !== 0) return
    event.preventDefault()
    start.current = { x: event.clientX, width }
    event.currentTarget.setPointerCapture(event.pointerId)
  }} onPointerMove={event => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) setSidebarWidth(side, start.current.width + (event.clientX - start.current.x) * (side === 'left' ? 1 : -1))
  }} onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }} onDoubleClick={() => setSidebarWidth(side, limits.initial)} onKeyDown={event => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      setSidebarWidth(side, event.key === 'Home' ? limits.min : event.key === 'End' ? limits.max : width + (event.key === 'ArrowRight' ? 16 : -16) * (side === 'left' ? 1 : -1))
    }
  }} />
}
