import test from 'node:test'
import assert from 'node:assert/strict'
import { installViewerPermissions } from '../dist-electron/viewer-permissions.js'

test('fullscreen permission is restricted to the trusted main document', () => {
  let request, check, destroyed = false
  const url = 'file:///D:/app/index.html'
  const contents = { getURL: () => url, isDestroyed: () => destroyed, session: {
    setPermissionRequestHandler: handler => { request = handler },
    setPermissionCheckHandler: handler => { check = handler },
  } }
  installViewerPermissions(contents)
  const verify = (sender, permission, details, expected) => {
    let actual; request(sender, permission, granted => { actual = granted }, details)
    assert.equal(actual, expected); assert.equal(check(sender, permission, 'file://', details), expected)
  }
  const details = { isMainFrame: true, requestingUrl: url }
  verify(contents, 'fullscreen', details, true)
  for (const permission of ['media', 'camera', 'microphone', 'automatic-fullscreen', 'clipboard-read', 'notifications']) verify(contents, permission, details, false)
  verify(contents, 'fullscreen', { ...details, isMainFrame: false }, false)
  verify(contents, 'fullscreen', { ...details, requestingUrl: 'https://untrusted.example/' }, false)
  verify(contents, 'fullscreen', { isMainFrame: true }, false)
  verify(null, 'fullscreen', details, false)
  verify({}, 'fullscreen', details, false)
  destroyed = true; verify(contents, 'fullscreen', details, false)
})
