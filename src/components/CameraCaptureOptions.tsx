import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { CameraInfo, ScreenCapabilities, ScreenPreferences } from '../../electron/screen-protocol'

type CameraTarget = { id: string; serial: string; transportId?: string }
const defaultSizes = ['640x480', '1280x720', '1920x1080', '3840x2160']

export function CameraCaptureOptions({ value: o, change, capabilities, target, stale = false }: {
  value: ScreenPreferences; change: (value: ScreenPreferences) => void; capabilities: ScreenCapabilities | null; target?: CameraTarget; stale?: boolean
}) {
  const key = target ? JSON.stringify([target.id, target.serial, target.transportId]) : ''
  const [catalog, setCatalog] = useState<{ key: string; cameras: CameraInfo[] } | null>(null)
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [revision, refresh] = useState(0)
  const [manualId, setManualId] = useState(false), [manualSize, setManualSize] = useState(false), [manualFps, setManualFps] = useState(false)
  const [sizeDraft, setSizeDraft] = useState(o.cameraSize), [fpsDraft, setFpsDraft] = useState(String(o.cameraFps))
  const [sizeError, setSizeError] = useState(''), [fpsError, setFpsError] = useState('')
  const canRead = !!capabilities?.flags.includes('--list-camera-sizes')
  const canHighSpeed = !!capabilities?.flags.includes('--camera-high-speed')
  useEffect(() => {
    let cancelled = false
    setCatalog(null); setError(''); setLoading(false)
    if (!target || stale || !canRead || !window.desktop) return
    setLoading(true)
    void window.desktop.request({ type: 'connection.cameraModes', ...target }).then(reply => {
      if (cancelled) return
      if (reply.ok && reply.cameraModes) setCatalog({ key, cameras: reply.cameraModes })
      else setError(reply.ok ? "Could not read camera modes." : reply.error)
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [key, stale, canRead, capabilities?.version, revision])
  const cameras = !stale && catalog?.key === key ? catalog.cameras : undefined
  const camera = o.cameraId ? cameras?.find(c => c.id === o.cameraId) : cameras?.find(c => c.facing === o.cameraFacing)
  const highSpeed = !!o.cameraHighSpeed
  const sizes = highSpeed ? camera?.highSpeedModes?.map(m => m.size) || [] : camera?.sizes?.length ? camera.sizes : defaultSizes
  const fps = highSpeed ? camera?.highSpeedModes?.find(m => m.size === o.cameraSize)?.fps || [] : camera?.fps?.length ? camera.fps : [30, 60]
  const set = <K extends keyof ScreenPreferences>(name: K, value: ScreenPreferences[K]) => change({ ...o, [name]: value })
  const lens = (id: string, facing = o.cameraFacing) => {
    const selected = cameras?.find(c => c.id === id)
    change({ ...o, cameraId: id, cameraFacing: selected && selected.facing !== 'unknown' ? selected.facing : facing,
      ...(highSpeed ? { cameraHighSpeed: false, cameraSize: '', cameraFps: 30 } : {}) })
  }
  return <>
    {target && <div className="screen-wide">
      <p className="screen-note" role="status">{stale ? "Reconnect this phone to read its camera modes." : loading ? "Reading this phone’s camera modes…" : cameras ? `${cameras.length} cameras reported by this phone. Choose a camera ID to select a specific lens.` : !capabilities ? "Checking camera mode support…" : !canRead ? "Update scrcpy to read this phone’s camera modes. Manual settings are available." : "Manual settings are available while camera modes are unavailable."}</p>
      {canRead && <button type="button" className="button secondary" disabled={loading || stale} onClick={() => refresh(r => r + 1)}><RefreshCw size={14} />Refresh camera modes</button>}
      {error && <p className="screen-note" role="status">{error}{" Your capture settings were kept."}</p>}
    </div>}
    <label>Camera<select aria-label="Camera" disabled={!!o.cameraId} value={o.cameraFacing} onChange={e => lens('', e.target.value as ScreenPreferences['cameraFacing'])}><option value="back">Back</option><option value="front">Front</option><option value="external">External · connected to phone</option></select></label>
    {cameras?.length ? <label>Camera ID · optional<select aria-label="Camera ID" value={manualId ? 'manual' : o.cameraId} onChange={e => { setManualId(e.target.value === 'manual'); if (e.target.value !== 'manual') lens(e.target.value) }}>
      <option value="">{"Automatic · first "}{o.cameraFacing}{" camera"}</option>
      {cameras.map(c => <option key={c.id} value={c.id}>{"ID "}{c.id} · {c.facing}</option>)}
      {o.cameraId && !cameras.some(c => c.id === o.cameraId) && <option value={o.cameraId}>{"ID "}{o.cameraId}{" · current, not reported"}</option>}
      <option value="manual">Enter camera ID…</option>
    </select></label> : <label>Camera ID · optional<input value={o.cameraId} placeholder="Automatic" maxLength={64} onChange={e => lens(e.target.value)} /></label>}
    {!!cameras?.length && manualId && <label className="screen-wide">Manual camera ID<input value={o.cameraId} placeholder="Automatic" maxLength={64} onChange={e => lens(e.target.value)} /></label>}
    <label>Capture size<select aria-label="Capture size" value={manualSize ? 'manual' : o.cameraSize} onChange={e => {
      const size = e.target.value; setManualSize(size === 'manual')
      if (size === 'manual') { setSizeDraft(o.cameraSize); setSizeError(''); return }
      const rates = highSpeed ? camera?.highSpeedModes?.find(m => m.size === size)?.fps : undefined
      change({ ...o, cameraSize: size, ...(rates?.length && !rates.includes(o.cameraFps) ? { cameraFps: rates[0] } : {}) })
    }}><option value="" disabled={highSpeed}>Automatic · use maximum resolution</option>{sizes.map(size => <option key={size} value={size}>{size}</option>)}
      {o.cameraSize && !sizes.includes(o.cameraSize) && <option value={o.cameraSize}>{o.cameraSize}{" · current, not listed"}</option>}<option value="manual">Custom size…</option>
    </select></label>
    <label>Camera frame rate<select aria-label="Camera frame rate" value={manualFps ? 'manual' : o.cameraFps} onChange={e => { setManualFps(e.target.value === 'manual'); if (e.target.value !== 'manual') set('cameraFps', Number(e.target.value)); else { setFpsDraft(String(o.cameraFps)); setFpsError('') } }}>
      {fps.map(rate => <option key={rate} value={rate}>{rate}{" FPS"}{!camera?.fps?.length && !highSpeed && rate === 60 ? " · if supported" : ''}</option>)}
      {!fps.includes(o.cameraFps) && <option value={o.cameraFps}>{o.cameraFps}{" FPS · current, not listed"}</option>}<option value="manual">Custom frame rate…</option>
    </select></label>
    {manualSize && <label>Custom capture size<input aria-label="Custom capture size" aria-invalid={!!sizeError} placeholder="1920x1080" value={sizeDraft} maxLength={9} onChange={e => setSizeDraft(e.target.value)} onBlur={() => {
      const size = sizeDraft.trim().toLowerCase().replace('×', 'x')
      if (!/^\d{2,4}x\d{2,4}$/.test(size) || size.split('x').some(v => Number(v) < 64 || Number(v) > 8192)) { setSizeError("Use width × height, from 64 to 8192 pixels. The previous size is kept."); return }
      setSizeError(''); setSizeDraft(size); set('cameraSize', size)
    }} />{sizeError && <small role="alert">{sizeError}</small>}</label>}
    {manualFps && <label>Custom camera frame rate<input aria-label="Custom camera frame rate" aria-invalid={!!fpsError} type="number" min={1} max={1000} value={fpsDraft} onChange={e => setFpsDraft(e.target.value)} onBlur={() => {
      const rate = Number(fpsDraft)
      if (!Number.isInteger(rate) || rate < 1 || rate > 1000) { setFpsError("Use a whole number from 1 to 1000. The previous frame rate is kept."); return }
      setFpsError(''); set('cameraFps', rate)
    }} />{fpsError && <small role="alert">{fpsError}</small>}</label>}
    {(canHighSpeed || highSpeed) && <label className="screen-check screen-wide camera-mode-toggle"><input type="checkbox" checked={highSpeed} disabled={!canHighSpeed && !highSpeed} onChange={e => {
      const enabled = e.target.checked
      const mode = camera?.highSpeedModes?.find(m => m.size === o.cameraSize) || camera?.highSpeedModes?.[0]
      setManualSize(false); setManualFps(false)
      change({ ...o, cameraHighSpeed: enabled, cameraSize: enabled ? mode?.size || o.cameraSize : camera?.sizes?.includes(o.cameraSize) ? o.cameraSize : '', cameraFps: enabled ? mode?.fps.find(rate => rate >= 120) || mode?.fps[0] || 120 : 30 })
    }} /><span>High-speed capture<small>{!canHighSpeed ? "Update scrcpy or turn this option off." : camera?.highSpeedModes?.length ? "Uses the high-speed sizes and frame rates reported by this camera." : "Requires a compatible camera and an explicit size. No high-speed modes have been reported here."}</small></span></label>}
    {camera && <p className="screen-note screen-wide">Modes are reported by the phone; firmware and the video encoder can still reject a combination. If capture fails, turn off high-speed capture and choose Automatic size with 30 FPS, or enter a custom mode.</p>}
    {cameras && !camera && <p className="screen-note screen-wide">The selected camera was not reported. Refresh the list or choose another camera; your current settings are kept.</p>}
  </>
}
