import { dialog as nativeDialog } from 'electron'
import { message } from './i18n.js'

/** Localize presentation options only; paths, extensions and button indices stay unchanged. */
export function localizeDialogOptions(options: Record<string, unknown>) {
  const result = { ...options }
  for (const key of ['title', 'message', 'detail', 'buttonLabel']) {
    if (typeof result[key] === 'string') result[key] = message(result[key])
  }
  if (Array.isArray(result.buttons)) result.buttons = result.buttons.map(value => typeof value === 'string' ? message(value) : value)
  if (Array.isArray(result.filters)) result.filters = result.filters.map(filter => ({ ...filter, name: message(filter.name) }))
  return result
}

export const dialog: typeof nativeDialog = new Proxy(nativeDialog, {
  get(target, property) {
    const value = Reflect.get(target, property)
    if (!['showOpenDialog', 'showSaveDialog', 'showMessageBox'].includes(String(property))) return value
    return (...args: unknown[]) => {
      const index = args.length - 1
      args[index] = localizeDialogOptions(args[index] as Record<string, unknown>)
      return Reflect.apply(value, target, args)
    }
  },
})
