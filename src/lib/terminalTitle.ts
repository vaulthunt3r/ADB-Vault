// React Bits Decrypted Text demo presets, adapted to the active phosphor color.
// https://reactbits.dev/text-animations/decrypted-text
// See third-party-notices/react-bits.txt.
const classic = {
  effect: 'scramble', animateOn: 'inViewHover', speed: 60, maxIterations: 10,
  sequential: true, revealDirection: 'start', hoverRadius: 100, loopDelay: 2000,
  characters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!@#$%^&*()_+',
} as const

export const terminalTitlePresets = {
  classic: { label: 'Classic', description: 'Letters and symbols resolve from left to right.', props: classic },
  terminal: {
    label: 'Terminal', description: 'Hexadecimal characters reveal letters in random order.',
    props: { ...classic, scrambleColor: 'var(--terminal-scramble, #2bb673)', revealDirection: 'random', speed: 40, hoverRadius: 70, characters: '0123456789ABCDEF' },
  },
  flip: {
    label: 'Flip', description: 'Letters roll into place from the center outward.',
    props: { ...classic, effect: 'flip', revealDirection: 'center', speed: 70, hoverRadius: 0 },
  },
  loop: {
    label: 'Loop', description: 'Faint symbols brighten as the title is decoded.',
    props: { ...classic, effect: 'fade', animateOn: 'view', speed: 45, hoverRadius: 0, loopDelay: 1800, characters: '!<>-_/[]{}=+*^?#' },
  },
} as const

export type TerminalTitleEffect = keyof typeof terminalTitlePresets
export type TerminalTitlePreset = TerminalTitleEffect | 'random'
export const isTerminalTitlePreset = (value: unknown): value is TerminalTitlePreset =>
  value === 'random' || (typeof value === 'string' && Object.hasOwn(terminalTitlePresets, value))

export function pickTerminalTitleEffect(previous?: TerminalTitleEffect): TerminalTitleEffect {
  const choices = (Object.keys(terminalTitlePresets) as TerminalTitleEffect[]).filter(preset => preset !== previous)
  return choices[Math.floor(Math.random() * choices.length)]
}

export function normalizeTerminalTextSpeed(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.max(0.5, Math.min(2, value)) * 4) / 4 : 1
}
