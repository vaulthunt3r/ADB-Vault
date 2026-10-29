import type { WebContents } from 'electron'

// Only the trusted application's main document can enter HTML fullscreen.
// Media files are served as data; previews never gain camera/microphone access.
export function installViewerPermissions(contents: WebContents) {
  const allowed = (sender: WebContents | null, permission: string, details: { isMainFrame: boolean; requestingUrl?: string }) =>
    sender === contents && !contents.isDestroyed() && permission === 'fullscreen' && details.isMainFrame && !!details.requestingUrl && details.requestingUrl === contents.getURL()
  contents.session.setPermissionRequestHandler((sender, permission, callback, details) => callback(allowed(sender, permission, details)))
  contents.session.setPermissionCheckHandler((sender, permission, _origin, details) => allowed(sender, permission, details))
}
