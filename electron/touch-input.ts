export const textKeys = ['Backspace', 'Delete', 'Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Escape', 'Copy', 'Cut', 'SelectAll'] as const
export type TextKey = typeof textKeys[number]
export type TouchInput = { type: 'text'; text: string } | { type: 'key'; key: TextKey; shift?: boolean; control?: boolean } | { type: 'paste' } | { type: 'scroll'; x: number; y: number; dx: number; dy: number }
export function validateTouchInput(value: unknown): asserts value is TouchInput {
  const v = value as TouchInput
  if (!v || typeof v !== 'object') throw new Error('Invalid window input.')
  if (v.type === 'text') {
    if (typeof v.text !== 'string' || !v.text.length || v.text.length > 8192 || /\u0000/.test(v.text)) throw new Error('Use between 1 and 8192 text characters.')
  } else if (v.type === 'key') {
    if (!textKeys.includes(v.key) || v.shift !== undefined && typeof v.shift !== 'boolean' || v.control !== undefined && typeof v.control !== 'boolean') throw new Error('Invalid editing key.')
  } else if (v.type === 'scroll') {
    if (![v.x, v.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1) || ![v.dx, v.dy].every(n => Number.isFinite(n) && Math.abs(n) <= 10)) throw new Error('Invalid scroll input.')
  } else if (v.type !== 'paste') throw new Error('Invalid window input.')
}
export function editingKey(e: { code: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }): TouchInput | undefined {
  if (e.altKey || e.metaKey) return
  if (e.ctrlKey) {
    if (e.code === 'KeyV') return { type: 'paste' }
    const key = ({ KeyA: 'SelectAll', KeyC: 'Copy', KeyX: 'Cut' } as const)[e.code as 'KeyA' | 'KeyC' | 'KeyX']
    if (key) return { type: 'key', key }
  }
  const key = e.code === 'NumpadEnter' ? 'Enter' : e.code
  if ((textKeys as readonly string[]).includes(key)) return { type: 'key', key: key as TextKey, shift: e.shiftKey, control: e.ctrlKey }
}
