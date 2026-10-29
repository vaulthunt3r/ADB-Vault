/** Electron uses its native clipboard; browser previews use the browser API. */
export async function copyText(text: string) {
  if (window.desktop) {
    if (!window.desktop.writeClipboard) throw new Error('Restart ADB Vault to load the updated clipboard bridge.')
    await window.desktop.writeClipboard(text)
  } else {
    await navigator.clipboard.writeText(text)
  }
}
