export { t, message, locale } from '../../electron/i18n'

// Discard the setting from experimental multilingual builds. It must never
// override the English interface in the main, camera, or touch-control window.
if (typeof window !== 'undefined') {
  try { localStorage.removeItem('adb-vault-language') } catch { /* Storage may be unavailable. */ }
}
