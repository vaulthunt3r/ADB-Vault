import { useEffect, useRef, useState } from 'react'
import DecryptedText from '../DecryptedText'
import { useAppearanceStore } from '../../store/useAppearanceStore'
import { pickTerminalTitleEffect, terminalTitlePresets, type TerminalTitlePreset } from '../../lib/terminalTitle'

const canAnimate = () => !document.hidden && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
type Kind = 'title' | 'quote'

function AnimatedText({ text, kind, preset, repeat, speed }: {
  text: string; kind: Kind; preset: TerminalTitlePreset; repeat: boolean; speed: number
}) {
  const [randomPreset, setRandomPreset] = useState(pickTerminalTitleEffect)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const effect = preset === 'random' ? randomPreset : preset
  const props = terminalTitlePresets[effect].props
  const nextCycle = () => {
    if (preset !== 'random' || !repeat) return
    clearTimeout(timer.current)
    // Pick after the text resolves and remains readable. A slow reveal cannot
    // be cut short by a fixed-duration cycle timer.
    timer.current = setTimeout(() => setRandomPreset(previous => pickTerminalTitleEffect(previous)), props.loopDelay)
  }
  return <DecryptedText key={effect} text={text} {...props}
    speed={props.speed / speed}
    animateOn={kind === 'quote' || preset === 'random' ? 'view' : props.animateOn}
    loop={repeat && preset !== 'random'} onRevealComplete={nextCycle}
    parentClassName={`zero-cool-${kind}`} encryptedClassName={`zero-cool-${kind}-scrambled`}
    data-preset={preset} data-effect={effect} data-repeat={repeat} data-speed={speed} />
}

// Used only in Zero Cool. Unmounting stops both the glyph engine and Random's
// pending cycle while hidden, disabled or under a reduced-motion preference.
export function TerminalText({ text, kind }: { text: string; kind: Kind }) {
  const enabled = useAppearanceStore(state => kind === 'title' ? state.terminalTitleAnimated : state.terminalQuotesAnimated)
  const preset = useAppearanceStore(state => state.terminalTitlePreset)
  const titleRepeat = useAppearanceStore(state => state.terminalTitleRepeat)
  const speed = useAppearanceStore(state => state.terminalTextSpeed)
  const [active, setActive] = useState(canAnimate)
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const refresh = () => setActive(canAnimate())
    document.addEventListener('visibilitychange', refresh)
    preference.addEventListener('change', refresh)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      preference.removeEventListener('change', refresh)
    }
  }, [])
  if (!enabled || !active) return <span className={`zero-cool-${kind}-static`}>{text}</span>
  const repeat = kind === 'title' && titleRepeat
  return <AnimatedText key={`${text}-${preset}-${repeat}-${speed}`} text={text} kind={kind} preset={preset} repeat={repeat} speed={speed} />
}
