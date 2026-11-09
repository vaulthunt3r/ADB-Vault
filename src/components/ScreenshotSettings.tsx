import { useRef, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { useScreenshotSettings } from '../store/useScreenStore'
import { requestBackend } from '../lib/backend'
import type { BackendRequest } from '../../electron/contracts'

export function ScreenshotSettings() {
  const settings = useScreenshotSettings()
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), submitting = useRef(false)
  const send = async (request: BackendRequest) => {
    if (submitting.current) return
    submitting.current = true; setBusy(true); setError('')
    try { await requestBackend(request, setError) } finally { submitting.current = false; setBusy(false) }
  }
  const change = (key: 'saveToFile' | 'copyToClipboard' | 'askWhereToSave', enabled: boolean) => {
    const { saveToFile, copyToClipboard, askWhereToSave } = settings
    void send({ type: 'settings.screenshots', options: { saveToFile, copyToClipboard, askWhereToSave, [key]: enabled } })
  }
  return <fieldset className="screenshot-settings" disabled={busy || !window.desktop}>
    <legend>Screenshots</legend>
    <p className="screen-note">Capture the selected phone screen. Images use PNG format; the frame is captured before any save dialog opens.</p>
    <label className="screen-check"><input type="checkbox" checked={settings.saveToFile} disabled={!settings.copyToClipboard} onChange={e => change('saveToFile', e.target.checked)} /><span>Save screenshots to a folder<small>Save automatically with the device name and capture time.</small></span></label>
    <label className="screen-check"><input type="checkbox" checked={settings.copyToClipboard} disabled={!settings.saveToFile} onChange={e => change('copyToClipboard', e.target.checked)} /><span>Copy screenshots to clipboard<small>Copy the image to the Windows clipboard, ready to paste into another app.</small></span></label>
    <p className="screen-note">Keep at least one destination enabled: a file, the clipboard, or both.</p>
    <div className="screenshot-folder"><span>Screenshot folder</span><code>{settings.folder || 'Pictures / ADB Vault / Screenshots'}</code><div><button className="button secondary" onClick={() => void send({ type: 'settings.screenshotFolder' })}>Change folder…</button><button className="button secondary" onClick={() => void send({ type: 'settings.openScreenshotFolder' })}><FolderOpen size={15} />Open folder</button></div></div>
    <label className="screen-check"><input type="checkbox" checked={settings.askWhereToSave} disabled={!settings.saveToFile} onChange={e => change('askWhereToSave', e.target.checked)} /><span>Ask where to save each screenshot<small>Choose a name and location instead of saving automatically.</small></span></label>
    {error && <p className="screen-error" role="alert">{error}</p>}
    <p className="screen-note">{busy ? 'Saving…' : 'Your choices are saved automatically.'}</p>
  </fieldset>
}
