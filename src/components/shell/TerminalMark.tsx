import { useEffect, useId, useState } from 'react'
import { Command, Terminal } from 'lucide-react'
import { nextTerminalQuote } from '../../lib/terminalQuotes'
import { useAppearanceStore } from '../../store/useAppearanceStore'
import { TerminalText } from './TerminalText'

export function TerminalMark() {
  const { terminalMode, toggleTerminalMode, toggleTerminalPin } = useAppearanceStore()
  const [hovered, setHovered] = useState(false)
  const [keyboardFocused, setKeyboardFocused] = useState(false)
  const [quote, setQuote] = useState<string | null>(null)
  const tooltipId = useId()
  const engaged = hovered || keyboardFocused
  useEffect(() => {
    setQuote(terminalMode && engaged ? nextTerminalQuote() : null)
  }, [terminalMode, engaged])
  const toggle = () => { setQuote(null); toggleTerminalMode() }
  return <span className="app-mark-wrap" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
    <button type="button" className="app-mark" aria-label="Terminal mode" aria-pressed={terminalMode}
      aria-describedby={terminalMode && quote ? tooltipId : undefined}
      onDoubleClick={event => { event.stopPropagation(); toggle() }}
      onContextMenu={event => {
        if (!terminalMode) return
        event.preventDefault(); event.stopPropagation(); toggleTerminalPin()
      }}
      onClick={event => { if (event.detail === 0) toggle() }}
      onMouseDown={() => setKeyboardFocused(false)}
      onFocus={event => setKeyboardFocused(event.currentTarget.matches(':focus-visible'))}
      onBlur={() => setKeyboardFocused(false)}
      onKeyDown={event => {
        if (event.key === 'Escape') { setQuote(null); event.stopPropagation() }
        if (terminalMode && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
          event.preventDefault(); event.stopPropagation(); toggleTerminalPin()
        }
      }}>
      {terminalMode ? <Terminal size={14} strokeWidth={2.3} /> : <Command size={14} strokeWidth={2.3} />}
    </button>
    {terminalMode && quote && <span className="terminal-quote" id={tooltipId} role="tooltip" aria-label={`${quote} — Hackers · 1995`}><TerminalText text={quote} kind="quote" /><small>Hackers · 1995</small></span>}
  </span>
}
