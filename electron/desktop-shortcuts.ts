import { globalShortcut } from 'electron'

// Named actions keep shortcut ownership separate from individual windows.
export class DesktopShortcuts {
  private actions = new Map<string, string>()
  set(action: string, shortcut: string, callback: () => void) {
    if (!/^Ctrl\+(Alt|Shift)\+([A-Z0-9]|F([1-9]|1[0-2]))$/.test(shortcut)) throw new Error('Use Ctrl + Alt or Ctrl + Shift with a letter, number or F1–F12.')
    const previous = this.actions.get(action)
    if (previous === shortcut) return true
    if (!globalShortcut.register(shortcut, callback)) return false
    if (previous) globalShortcut.unregister(previous)
    this.actions.set(action, shortcut)
    return true
  }
  remove(action: string) { const shortcut = this.actions.get(action); if (shortcut) globalShortcut.unregister(shortcut); this.actions.delete(action) }
  shutdown() { for (const action of this.actions.keys()) this.remove(action) }
}
