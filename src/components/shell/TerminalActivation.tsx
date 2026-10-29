import { t } from "../../lib/i18n"
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { terminalModeName } from '../../lib/themes'

const text = `${terminalModeName.toUpperCase()} ACTIVATED`
const characters = '0123456789ABCDEF'
const stepMs = 40
const hoverRadius = 70
const visibleMs = 4000
const letters = Array.from(text)
const randomGlyph = () => characters[Math.floor(Math.random() * characters.length)]
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

// React Bits' Terminal preset: hex glyphs, random sequential reveal, 40 ms,
// green scrambled letters and local hover. Kept local to this small greeting.
// Reference: https://reactbits.dev/text-animations/decrypted-text
function DecryptedGreeting() {
  const container = useRef<HTMLSpanElement>(null)
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const wake = useRef<() => void>(() => {})
  const [frame, setFrame] = useState(() => letters.map((char, index) => ({
    char: reducedMotion() || char === ' ' ? char : characters[index % characters.length],
    scrambled: !reducedMotion() && char !== ' ',
  })))

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const queue = letters.map((char, index) => char === ' ' ? -1 : index).filter(index => index >= 0)
    for (let i = queue.length - 1; i > 0; i--) {
      const other = Math.floor(Math.random() * (i + 1))
      ;[queue[i], queue[other]] = [queue[other], queue[i]]
    }
    const revealed = letters.map(char => char === ' ')
    const heat = letters.map(() => 0)
    let timer: ReturnType<typeof setInterval> | undefined
    const stop = () => { clearInterval(timer); timer = undefined }
    const finish = () => {
      stop()
      queue.length = 0
      revealed.fill(true)
      heat.fill(0)
      setFrame(letters.map(char => ({ char, scrambled: false })))
    }
    const tick = () => {
      const next = queue.shift()
      if (next !== undefined) revealed[next] = true
      const cells = pointer.current ? container.current?.children : undefined
      let hovering = false
      const nextFrame = letters.map((char, index) => {
        if (char === ' ') return { char, scrambled: false }
        let proximity = 0
        if (pointer.current && cells?.[index]) {
          const box = cells[index].getBoundingClientRect()
          const distance = Math.hypot(box.x + box.width / 2 - pointer.current.x, box.y + box.height / 2 - pointer.current.y)
          proximity = Math.max(0, 1 - distance / hoverRadius)
        }
        heat[index] = Math.max(0, heat[index] - 0.1, proximity)
        hovering ||= heat[index] > 0
        const scrambled = !revealed[index] || heat[index] > 0
        return { char: scrambled ? randomGlyph() : char, scrambled }
      })
      setFrame(nextFrame)
      if (!queue.length && !hovering) stop()
    }
    wake.current = () => {
      if (!preference.matches && timer === undefined) timer = setInterval(tick, stepMs)
    }
    const onPreference = () => { if (preference.matches) finish() }
    preference.addEventListener('change', onPreference)
    if (preference.matches) finish()
    else wake.current()
    return () => {
      stop()
      wake.current = () => {}
      preference.removeEventListener('change', onPreference)
    }
  }, [])

  return <span ref={container} className="terminal-decrypted" aria-hidden="true"
    onPointerMove={event => { pointer.current = { x: event.clientX, y: event.clientY }; wake.current() }}
    onPointerLeave={() => { pointer.current = null }}>
    {frame.map((letter, index) => <span key={index} className={letter.scrambled ? 'scrambled' : undefined}>{letter.char}</span>)}
  </span>
}

export function TerminalActivation() {
  const [visible, setVisible] = useState(true)
  const overlay = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const panel = overlay.current
    // A manual popover sits above the app's stacking contexts without taking focus.
    panel?.showPopover()
    const timer = setTimeout(() => setVisible(false), visibleMs)
    return () => { clearTimeout(timer); if (panel?.isConnected) panel.hidePopover() }
  }, [])
  if (!visible) return null
  return createPortal(<div ref={overlay} popover="manual" className="terminal-activation" role="status" aria-live="polite" aria-atomic="true">
    <span className="terminal-activation__sr">{text}</span>
    <span className="terminal-activation__prompt" aria-hidden="true">{t(">_")}</span>
    <DecryptedGreeting />
  </div>, document.body)
}
