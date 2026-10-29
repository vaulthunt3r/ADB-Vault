import { validateTouchHotkeys, type TouchHotkeys } from './touch-hotkeys.js'
import type { TouchInput } from './touch-input.js'
export type TouchPoint = { id: number; x: number; y: number }
export type TouchMark = { id: string; kind: 'button' | 'stick' | 'look'; x: number; y: number; radius: number; bindings: string[]; sensitivity: number; gamepad: boolean }
export type TouchProfile = { version: 1; name: string; marks: TouchMark[]; hotkeys?: TouchHotkeys; autoStart?: boolean }
export type TouchTemplate = 'empty' | 'shooter' | 'racing' | 'platformer'
export type TouchGeometry = { width: number; height: number; rotation: number; epoch: number; displayId: number; uniqueId: string; message: string }
export type TouchState = { title: string; geometry?: TouchGeometry; error?: string; autoStart?: boolean; alwaysOnTop?: boolean; canSetAlwaysOnTop?: boolean; windowBusy?: boolean }
export interface TouchBridge {
  state(): Promise<TouchState>
  setAlwaysOnTop(enabled: boolean): Promise<void>
  profiles(orientation: string, profiles?: TouchProfile[]): Promise<TouchProfile[]>
  frame(epoch: number, points: TouchPoint[]): void
  input(epoch: number, input: TouchInput): Promise<void>
  close(): Promise<void>
  subscribe(listener: (state: TouchState) => void): () => void
  onFocus(listener: (focused: boolean) => void): () => void
}
export const reservedKeys = new Set(['Escape', 'MetaLeft', 'MetaRight', 'Tab'])
export function validBinding(key: unknown): key is string {
  return typeof key === 'string' && !reservedKeys.has(key) && /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|Arrow(Up|Down|Left|Right)|Space|Shift(Left|Right)|Control(Left|Right)|Enter|Backspace|CapsLock|Key[A-Z]|[A-Za-z]{2,20}|F([1-7]|9|1[0-2])|Mouse[0-4]|Pad([0-9]|1[0-6]))$/.test(key)
}
export function bindingLabel(key: string) {
  const pad = /^Pad(\d+)$/.exec(key)
  if (pad) return ['A / ×', 'B / ○', 'X / □', 'Y / △', 'LB / L1', 'RB / R1', 'LT / L2', 'RT / R2', 'Back / Share', 'Start / Options', 'LS / L3', 'RS / R3', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'Home'][Number(pad[1])] || key
  return key.replace(/^Key/, '').replace(/^Digit/, '').replace('Mouse0', 'LMB').replace('Mouse1', 'MMB').replace('Mouse2', 'RMB')
}
export function validateProfile(input: unknown): asserts input is TouchProfile {
  const p = input as TouchProfile
  if (!p || p.version !== 1 || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 60 || !Array.isArray(p.marks) || p.marks.length > 8) throw new Error('Use a profile name and up to 8 controls.')
  if (p.autoStart !== undefined && typeof p.autoStart !== 'boolean') throw new Error('Invalid game controls startup setting.')
  const ids = new Set<string>(), bindings = new Set<string>()
  for (const m of p.marks) {
    if (!m || !/^[a-zA-Z0-9_-]{1,50}$/.test(m.id) || ids.has(m.id) || !['button', 'stick', 'look'].includes(m.kind) || ![m.x, m.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1) || !Number.isFinite(m.radius) || m.radius < 0.01 || m.radius > 0.4 || !Number.isFinite(m.sensitivity) || m.sensitivity < 0.1 || m.sensitivity > 5 || typeof m.gamepad !== 'boolean' || !Array.isArray(m.bindings) || m.bindings.length !== (m.kind === 'stick' ? 4 : m.kind === 'button' ? 2 : 0)) throw new Error('Invalid control configuration.')
    ids.add(m.id)
    for (const key of m.bindings) {
      if (!key) continue
      if (!validBinding(key) || bindings.has(key)) throw new Error(`Binding ${bindingLabel(key)} is reserved or already assigned.`)
      bindings.add(key)
    }
  }
  if (p.marks.filter(m => m.kind === 'stick').length > 1 || p.marks.filter(m => m.kind === 'look').length > 1) throw new Error('Use one movement stick and one look zone.')
  validateTouchHotkeys(p)
}
export function touchTemplate(kind: TouchTemplate): TouchProfile {
  const mark = (id: string, type: TouchMark['kind'], x: number, y: number, bindings: string[], radius = .08): TouchMark => ({ id, kind: type, x, y, bindings, radius, sensitivity: 1, gamepad: true })
  const stick = mark('move', 'stick', .18, .76, ['KeyW', 'KeyA', 'KeyS', 'KeyD'])
  const marks = kind === 'shooter' ? [stick, mark('look', 'look', .68, .45, [], .22), mark('fire', 'button', .88, .7, ['Mouse0', 'Pad7']), mark('aim', 'button', .89, .46, ['Mouse2', 'Pad6']), mark('jump', 'button', .76, .8, ['Space', 'Pad0']), mark('reload', 'button', .81, .58, ['KeyR', 'Pad2'])]
    : kind === 'racing' ? [mark('left', 'button', .12, .78, ['KeyA', 'Pad14']), mark('right', 'button', .3, .78, ['KeyD', 'Pad15']), mark('accelerate', 'button', .88, .77, ['KeyW', 'Pad7']), mark('brake', 'button', .7, .77, ['KeyS', 'Pad6']), mark('boost', 'button', .88, .53, ['Space', 'Pad0'])]
    : kind === 'platformer' ? [stick, mark('jump', 'button', .88, .77, ['Space', 'Pad0']), mark('action', 'button', .72, .77, ['KeyJ', 'Pad2'])] : []
  return { version: 1, name: { empty: 'Custom', shooter: 'Shooter', racing: 'Racing', platformer: 'Platformer' }[kind], marks }
}
export function validatePoints(points: unknown): asserts points is TouchPoint[] {
  if (!Array.isArray(points) || points.length > 10 || new Set(points.map(p => p?.id)).size !== points.length || points.some(p => !p || !Number.isInteger(p.id) || p.id < 0 || p.id > 9 || ![p.x, p.y].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1))) throw new Error('Invalid touch frame.')
}
