export const touchHotkeyActions = ['release', 'edit', 'play', 'panel'] as const
export type TouchHotkeyAction = typeof touchHotkeyActions[number]
export type TouchHotkeys = Record<TouchHotkeyAction, string>
export const touchHotkeyLabels: Record<TouchHotkeyAction, string> = { release: 'Switch to typing / release cursor', edit: 'Edit layout', play: 'Game controls on / off', panel: 'Show / hide controls' }
export const defaultTouchHotkeys: TouchHotkeys = { release: 'AltLeft', edit: 'F8', play: 'F9', panel: 'F10' }
type ProfileKeys = { hotkeys?: TouchHotkeys; marks: { bindings: string[] }[] }
export const modifierKey = (code: string) => /^(Control|Alt|Shift|Meta)(Left|Right)$/.test(code)
const modifiers = ['Control', 'Alt', 'Shift', 'Meta'] as const
const codePattern = /^(Key[A-Z]|Digit[0-9]|Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter|Equal|Comma)|F(?:[1-9]|1[0-9]|2[0-4])|Arrow(?:Up|Down|Left|Right)|(?:Control|Alt|Shift|Meta)(?:Left|Right)|Space|Enter|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|CapsLock|NumLock|ScrollLock|Pause|PrintScreen|ContextMenu|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|IntlBackslash|IntlRo|IntlYen|Semicolon|Quote|Comma|Period|Slash)$/
export function validTouchHotkey(value: unknown): value is string {
  if (value === '') return true
  if (typeof value !== 'string' || value.length > 80) return false
  const parts = value.split('+'), code = parts.pop()!
  return codePattern.test(code) && parts.every(p => modifiers.includes(p as typeof modifiers[number])) && new Set(parts).size === parts.length && parts.join('+') === modifiers.filter(m => parts.includes(m)).join('+') && !parts.some(m => code.startsWith(m))
}
export function keyboardHotkey(e: { code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }) {
  return [...modifiers.filter((m, i) => [e.ctrlKey, e.altKey, e.shiftKey, e.metaKey][i] && !e.code.startsWith(m)), e.code].join('+')
}
export function touchHotkeys(profile: ProfileKeys): TouchHotkeys {
  if (profile.hotkeys !== undefined) return profile.hotkeys
  // Existing profiles may already use the newly introduced F9/F10 shortcuts in a game.
  const assigned = new Set(profile.marks.flatMap(m => m.bindings))
  return Object.fromEntries(touchHotkeyActions.map(action => [action, (action === 'play' || action === 'panel') && assigned.has(defaultTouchHotkeys[action]) ? '' : defaultTouchHotkeys[action]])) as TouchHotkeys
}
export function hotkeyCode(value: string) { return value.split('+').at(-1)! }
export function hotkeyLabel(value: string) {
  if (!value) return 'Not assigned'
  return value.split('+').map(code => code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^(Control|Alt|Shift|Meta)(Left|Right)$/, (_match, mod: string, side: string) => `${mod === 'Control' ? 'Ctrl' : mod} (${side.toLowerCase()})`).replace(/^Control$/, 'Ctrl')).join(' + ')
}
export function validateTouchHotkeys(profile: ProfileKeys) {
  const keys = touchHotkeys(profile), seen = new Set<string>()
  if (!keys || typeof keys !== 'object' || Array.isArray(keys) || Object.keys(keys).some(k => !touchHotkeyActions.includes(k as TouchHotkeyAction))) throw new Error('Invalid hotkey settings.')
  for (const action of touchHotkeyActions) {
    const key = keys[action]
    if (!validTouchHotkey(key)) throw new Error('Choose a keyboard key or combination. Escape is reserved for releasing the cursor.')
    if (!key) continue
    if (seen.has(key)) throw new Error(`${hotkeyLabel(key)} is already assigned to another hotkey.`)
    if (profile.marks.some(m => m.bindings.includes(hotkeyCode(key)))) throw new Error(`${hotkeyLabel(key)} conflicts with a game control. Choose another key or change that control.`)
    seen.add(key)
  }
}
