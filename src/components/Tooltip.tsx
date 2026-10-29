import { useId, useLayoutEffect, useRef, useSyncExternalStore, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './tooltip.css'

let activeHint: string | null = null
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
function showHint(id: string | null) {
  if (activeHint === id) return
  activeHint = id
  listeners.forEach(listener => listener())
}

export function Tooltip({ text, children, className = '', disabled = false, side = 'bottom' }: {
  text: string; children: (descriptionId: string) => ReactNode; className?: string; disabled?: boolean; side?: 'bottom' | 'right'
}) {
  const id = useId(), anchor = useRef<HTMLSpanElement>(null), bubble = useRef<HTMLSpanElement>(null)
  const open = useSyncExternalStore(subscribe, () => activeHint, () => null) === id
  const hide = () => { if (activeHint === id) showHint(null) }
  useLayoutEffect(() => () => { if (activeHint === id) showHint(null) }, [id])
  useLayoutEffect(() => {
    if (!open) return
    const position = () => {
      if (!anchor.current || !bubble.current) return
      const a = anchor.current.getBoundingClientRect(), b = bubble.current.getBoundingClientRect(), margin = 8, gap = 7
      const x = side === 'right' ? a.right + gap : a.left
      const below = a.bottom + gap, above = a.top - b.height - gap
      const y = side === 'right' ? a.top : below + b.height <= innerHeight - margin || above < margin ? below : above
      Object.assign(bubble.current.style, { left: `${Math.max(margin, Math.min(x, innerWidth - b.width - margin))}px`, top: `${Math.max(margin, Math.min(y, innerHeight - b.height - margin))}px`, visibility: 'visible' })
    }
    position()
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') hide() }
    const leave = (event: PointerEvent) => { if (event.target instanceof Node && !anchor.current?.contains(event.target)) hide() }
    const observer = new ResizeObserver(position); if (bubble.current) observer.observe(bubble.current)
    window.addEventListener('resize', hide); window.addEventListener('scroll', hide, true); window.addEventListener('keydown', escape)
    window.addEventListener('blur', hide); window.addEventListener('pointerdown', hide, true); window.addEventListener('pointermove', leave, true)
    return () => { observer.disconnect(); window.removeEventListener('resize', hide); window.removeEventListener('scroll', hide, true); window.removeEventListener('keydown', escape); window.removeEventListener('blur', hide); window.removeEventListener('pointerdown', hide, true); window.removeEventListener('pointermove', leave, true) }
  }, [open, text, side])
  return <span ref={anchor} className={`hint-anchor ${className}`} tabIndex={disabled ? 0 : undefined} aria-describedby={disabled && open ? id : undefined}
    onMouseEnter={() => showHint(id)} onMouseLeave={hide} onFocus={() => showHint(id)}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) hide() }} onClickCapture={hide}>
    {children(id)}
    {open && createPortal(<span ref={bubble} id={id} role="tooltip" className="viewport-tooltip" style={{ visibility: 'hidden' }}>{text}</span>, document.body)}
  </span>
}

export function HintButton({ hint, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { hint: string }) {
  return <Tooltip text={hint} disabled={props.disabled}>{id => <button {...props} aria-describedby={id} />}</Tooltip>
}
