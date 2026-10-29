import { t as translateUi } from '../lib/i18n'
import { message } from "../lib/i18n"
import { t } from "../lib/i18n"
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { X, ZoomIn, ZoomOut, Flashlight, FlashlightOff, RotateCcw, RotateCw, Circle, Square, PanelRightOpen, PanelRightClose, RefreshCw, Keyboard, ChevronsRight, ChevronsLeft, SlidersHorizontal } from 'lucide-react'
import { WindowPinButton } from './WindowPinButton'
import type { CameraCommand, CameraPanelLayout, CameraPanelRequest, CameraUpdate, ScreenPreferences, ScreenSession } from '../../electron/screen-protocol'
import { cameraZoomSteps, closestZoomIndex } from '../../electron/camera-zoom'
import { useAppearanceStore } from '../store/useAppearanceStore'
import { applyCornerStyle, applyTheme, getActiveTheme } from '../lib/themes'
import './camera-panel.css'

export function CameraPanel() {
  const [session, setSession] = useState<ScreenSession | null>(null)
  const [pending, setPending] = useState(false), [error, setError] = useState('')
  const [layout, setLayout] = useState<CameraPanelLayout>({ docked: true, collapsed: false, shortcut: 'Ctrl+Alt+C', shortcutAvailable: true })
  const [tab, setTab] = useState<'live' | 'stream' | 'panel'>('live')
  const [draftZoom, setDraftZoom] = useState<number | null>(null)
  const [editingShortcut, setEditingShortcut] = useState(false)
  const [confirm, setConfirm] = useState<{ update: CameraUpdate; recording: string } | null>(null)
  const submitting = useRef(false), confirmation = useRef<HTMLElement>(null)
  const appearance = useAppearanceStore()
  useLayoutEffect(() => { applyTheme(getActiveTheme(appearance.themeId, appearance.terminalMode)); applyCornerStyle(appearance.cornerStyle) }, [appearance.themeId, appearance.terminalMode, appearance.cornerStyle])
  useEffect(() => {
    if (!window.cameraDesk) return
    let active = true, received = false, receivedLayout = false
    const off = window.cameraDesk.subscribe(value => { received = true; if (active) setSession(value) })
    const offLayout = window.cameraDesk.onLayout(value => { receivedLayout = true; if (active) setLayout(value) })
    void window.cameraDesk.layout().then(value => { if (active && !receivedLayout) setLayout(value) }).catch(e => { if (active) setError(String(e)) })
    void window.cameraDesk.state().then(value => { if (active && !received) setSession(value) }).catch(e => { if (active) setError(String(e)) })
    const storage = (e: StorageEvent) => { if (e.key === 'adb-vault-appearance') void useAppearanceStore.persist.rehydrate() }
    window.addEventListener('storage', storage)
    return () => { active = false; off(); offLayout(); window.removeEventListener('storage', storage) }
  }, [])
  useEffect(() => { if (confirm && (session?.recording !== confirm.recording || session?.restarting || session?.stopping)) setConfirm(null) }, [session, confirm])
  useEffect(() => { if (confirm) confirmation.current?.querySelector('button')?.focus() }, [confirm])
  useEffect(() => { setDraftZoom(null) }, [session?.camera?.id, session?.restarting])
  const busy = pending || !!session?.controlling || !!session?.restarting || !!session?.stopping
  const changeLayout = async (value: { docked?: boolean; collapsed?: boolean; shortcut?: string }) => {
    setError('')
    try { if (window.cameraDesk) setLayout(await window.cameraDesk.layout(value)) } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  const send = async (request: CameraPanelRequest) => {
    if (!window.cameraDesk || submitting.current || busy || !session) return
    submitting.current = true; setPending(true); setError('')
    try { const result = await window.cameraDesk.request(request); if (!result.ok) setError(result.error || "Camera control failed.") }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { submitting.current = false; setPending(false); setDraftZoom(null) }
  }
  const change = (update: CameraUpdate) => {
    if (session?.recording && update.kind !== 'record' && update.kind !== 'refresh') setConfirm({ update, recording: session.recording })
    else void send({ kind: 'update', update })
  }
  useEffect(() => { if ((error || confirm) && layout.collapsed) void window.cameraDesk?.layout({ collapsed: false }).then(setLayout).catch(() => {}) }, [error, confirm, layout.collapsed])
  const zoom = session?.cameraZoom, steps = cameraZoomSteps(zoom?.min, zoom?.max)
  const atMin = zoom?.current !== undefined && zoom.min !== undefined && zoom.current <= zoom.min + 0.0001
  const atMax = zoom?.current !== undefined && zoom.max !== undefined && zoom.current >= zoom.max - 0.0001
  const factor = (value?: number) => value === undefined ? '—' : `${Number(value.toFixed(2))}×`
  const zoomIndex = draftZoom ?? closestZoomIndex(steps, zoom?.current || 1)
  const commitZoom = (index: number) => { if (steps[index] !== undefined) void send({ kind: 'zoom', value: steps[index] }) }
  const command = (id: CameraCommand, label: string, Icon: typeof ZoomIn, shortcut: string) => <button className="button secondary" aria-label={t(label)} disabled={busy || !!confirm || !session?.cameraControls?.includes(id) || id === 'zoom-in' && atMax || id === 'zoom-out' && atMin} title={`${t(label)} · ${shortcut}`} onClick={() => void send({ kind: 'control', command: id })}><Icon size={18} />{!layout.collapsed && t(label)}</button>
  const record = <button className={`button ${session?.recording ? 'camera-recording' : 'primary'}`} disabled={busy || !!confirm || !session?.camera} title={session?.recording ? t("Stop recording · {0}", [session.recording]) : t("Start recording")} aria-label={session?.recording ? t("Stop recording · keep preview") : t("Start recording · {0}", [session?.camera?.recordFormat.toUpperCase() || t("MKV")])} onClick={() => change({ kind: 'record', enabled: !session?.recording })}>{session?.recording ? <Square size={16} /> : <Circle size={16} />}{!layout.collapsed && (session?.recording ? t("Stop recording") : t("Record"))}</button>
  const expand = (page: typeof tab) => { setTab(page); void changeLayout({ collapsed: false }) }
  const pin = session?.canSetAlwaysOnTop && <WindowPinButton enabled={session.alwaysOnTop} disabled={busy || !!confirm} compact onClick={() => void send({ kind: 'always-on-top', enabled: !session.alwaysOnTop })} />
  return <main className={`camera-panel${layout.collapsed ? " camera-panel-collapsed" : ''}`} aria-label={t("Live camera controls")}>
    <header><button className="button secondary icon-button camera-panel-toggle" aria-label={layout.collapsed ? t("Expand camera controls") : t("Collapse camera controls")} title={layout.collapsed ? t("Expand camera controls") : t("Collapse to side toolbar")} onClick={() => void changeLayout({ collapsed: !layout.collapsed })}>{layout.collapsed ? <ChevronsLeft size={19} /> : <ChevronsRight size={19} />}</button>{!layout.collapsed && <div><strong>{t("Camera controls")}</strong><small title={session?.deviceName}>{session?.deviceName || t("Connecting…")}</small></div>}
      {!layout.collapsed && <>{pin}<button className="button secondary icon-button" aria-label={layout.docked ? t("Detach camera controls") : t("Attach camera controls")} aria-pressed={layout.docked} title={layout.docked ? t("Attached · click or drag header to detach") : t("Attach to camera window")} onClick={() => void changeLayout({ docked: !layout.docked })}>{layout.docked ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}</button><button className="button secondary icon-button" title={t("Hide panel · {0}", [layout.shortcut])} aria-label={t("Hide camera controls")} onClick={() => void window.cameraDesk?.hide()}><X size={16} /></button></>}
    </header>
    {layout.collapsed ? <div className="camera-toolstrip" role="toolbar" aria-label={t("Camera toolbar")}>
      <button className="button secondary" aria-label={t("Zoom controls")} title={t("Zoom controls")} onClick={() => expand('live')}><ZoomIn size={19} /><small>{factor(zoom?.current)}</small></button>
      <button className="button secondary" aria-label={t("Camera and sound settings")} title={t("Camera and sound")} onClick={() => expand('stream')}><SlidersHorizontal size={19} /></button>
      {command('torch-on', translateUi("Torch on"), Flashlight, 'Alt + T')}{command('torch-off', translateUi("Torch off"), FlashlightOff, 'Alt + Shift + T')}
      {command('rotate-left', translateUi("Rotate left"), RotateCcw, 'Alt + ←')}{command('rotate-right', translateUi("Rotate right"), RotateCw, 'Alt + →')}
      {record}{pin}
      <button className="button secondary" aria-label={t("Expand panel settings")} title={t("Panel settings")} onClick={() => expand('panel')}><Keyboard size={18} /></button>
      <button className="button secondary" aria-label={t("Hide camera controls")} title={t("Hide panel · {0}", [layout.shortcut])} onClick={() => void window.cameraDesk?.hide()}><X size={18} /></button>
    </div> : <>
      <nav className="camera-panel-tabs" aria-label={t("Camera control pages")}>{(['live', 'stream', 'panel'] as const).map(page => <button key={page} aria-pressed={tab === page} className={tab === page ? 'active' : ''} onClick={() => setTab(page)}>{page === 'live' ? t("Controls") : page === 'stream' ? t("Camera & sound") : t("Panel")}</button>)}</nav>
      <div className="camera-panel-body">
        <div className="camera-live-status" role="status"><span className={session?.recording ? 'camera-record-dot' : ''}>{session?.restarting ? t("Restarting stream…") : session?.stopping ? t("Finishing…") : session?.recording ? t("Recording") : t("Live preview")}</span><small title={session?.title}>{session?.title}</small></div>
        {tab === 'live' && <>
          <section className="camera-zoom" aria-label={t("Camera zoom")}>
            <div><span>{t("Zoom")}</span><strong aria-label={t("Current zoom")}>{factor(zoom?.current)}</strong></div>
            <input type="range" aria-label={t("Camera zoom")} aria-valuetext={factor(steps[zoomIndex])} min={0} max={Math.max(1, steps.length - 1)} step={1} value={zoomIndex} disabled={busy || !!confirm || steps.length < 2 || !session?.cameraControls?.includes('zoom-in') || !session.cameraControls.includes('zoom-out')} onChange={e => setDraftZoom(Number(e.target.value))} onPointerUp={e => commitZoom(Number(e.currentTarget.value))} onPointerCancel={() => setDraftZoom(null)} onKeyUp={e => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) commitZoom(Number(e.currentTarget.value)) }} onBlur={() => setDraftZoom(null)} />
            <div className="camera-zoom-scale">{[0, .25, .5, .75, 1].map((fraction, index) => <span key={index}>{factor(steps[Math.round(fraction * (steps.length - 1))])}</span>)}</div>
            <small>{draftZoom !== null ? t("Selected {0} · release to apply", [factor(steps[draftZoom])]) : zoom?.current === undefined ? t("Choose zoom · current value not yet reported") : atMin && atMax ? t("Fixed zoom") : atMin ? t("Minimum zoom") : atMax ? t("Maximum zoom") : t("Camera feedback · stepped zoom")}</small>
          </section>
          {!steps.length && <div className="camera-live-buttons">{command('zoom-out', translateUi("Zoom out"), ZoomOut, 'Alt + ↓')}{command('zoom-in', translateUi("Zoom in"), ZoomIn, 'Alt + ↑')}</div>}
          <div className="camera-live-buttons" role="group" aria-label={t("Live adjustments")}>{command('torch-on', translateUi("Torch on"), Flashlight, 'Alt + T')}{command('torch-off', translateUi("Torch off"), FlashlightOff, 'Alt + Shift + T')}{command('rotate-left', translateUi("Rotate left"), RotateCcw, 'Alt + ←')}{command('rotate-right', translateUi("Rotate right"), RotateCw, 'Alt + →')}</div>
          <p className="camera-panel-hint">{t("Rotation changes the preview only.")}</p>
        </>}
        {tab === 'stream' && <>
          <div className="camera-live-selects">
            <label>{t("Camera")}<select aria-label={t("Live camera")} value={session?.camera?.facing || 'back'} disabled={busy || !!confirm || !session?.camera} onChange={e => change({ kind: 'camera', facing: e.target.value as 'back' | 'front' | 'external' })}>{(['back', 'front', 'external'] as const).map(facing => { const missing = session?.cameras && !session.cameras.some(c => c.facing === facing); return <option key={facing} value={facing} disabled={missing}>{facing[0].toUpperCase() + facing.slice(1)}{missing ? t(" · not detected") : ''}</option> })}</select></label>
            <label>{t("Sound")}<select aria-label={t("Live sound")} value={session?.camera?.audio || 'off'} disabled={busy || !!confirm || !session?.camera} onChange={e => change({ kind: 'audio', audio: e.target.value as ScreenPreferences['audio'] })}><option value="off">{t("No sound")}</option><option value="mic">{t("Phone microphone")}</option><option value="device">{t("Device audio → PC")}</option><option value="duplicate">{t("Device audio → phone + PC")}</option></select></label>
          </div>
          <div className="camera-source-footer"><small>{t("Camera ID: ")}{session?.camera?.id || '—'}</small><button className="button secondary" disabled={busy || !!confirm} onClick={() => change({ kind: 'refresh' })}><RefreshCw size={14} />{t("Refresh cameras")}</button></div>
          <p className="camera-panel-hint">{t("Changing camera, sound or recording briefly restarts the stream. Live adjustments may reset.")}</p>
          {session?.recording && <p className="camera-record-path" title={session.recording}>{session.recording}</p>}
        </>}
        {tab === 'panel' && <>
          <p className="camera-panel-hint">{layout.docked ? t("Attached to the camera edge. Drag the header to detach.") : t("Floating panel. Attach it using the dock button in the header.")}{t(" Hide keeps the camera running.")}</p>
          <label className="camera-shortcut"><span><Keyboard size={15} />{t("Show / hide shortcut")}</span><button className="button secondary" aria-label={t("Change camera controls shortcut")} title={t("Press Ctrl + Alt or Ctrl + Shift and a key. Escape cancels.")} onClick={() => setEditingShortcut(true)} onBlur={() => setEditingShortcut(false)} onKeyDown={e => {
            if (!editingShortcut) return
            e.preventDefault(); e.stopPropagation()
            if (e.key === 'Escape') { setEditingShortcut(false); return }
            const key = /^(Key|Digit)/.test(e.code) ? e.code.replace(/^(Key|Digit)/, '') : /^F([1-9]|1[0-2])$/.test(e.key) ? e.key : ''
            if (key && e.ctrlKey && (e.altKey !== e.shiftKey) && !e.metaKey) { setEditingShortcut(false); void changeLayout({ shortcut: `Ctrl+${e.altKey ? "Alt" : "Shift"}+${key}` }) }
          }}>{editingShortcut ? t("Press shortcut…") : layout.shortcut.replaceAll('+', ' + ')}</button>{!layout.shortcutAvailable && <small role="status">{t("Shortcut in use · choose another")}</small>}</label>
        </>}
      </div>
      <footer>{record}<button className="button secondary" disabled={busy || !session || !!confirm} onClick={() => void send({ kind: 'stop' })}>{session?.recording ? t("Save & close") : t("Close camera")}</button></footer>
      {confirm && <div className="camera-panel-overlay"><section ref={confirmation} className="camera-switch-confirm" role="alertdialog" aria-modal="true" aria-label={t("Continue recording in a new file?")}>
        <strong>{t("Continue recording in a new file?")}</strong><p>{t("The current file will be saved. Choose a new file for the next part; the stream will briefly pause. Cancelling the file picker keeps this recording running.")}</p>
        <div><button className="button secondary" disabled={busy} onClick={() => setConfirm(null)}>{t("Cancel")}</button><button className="button primary" disabled={busy} onClick={() => { const update = confirm.update; setConfirm(null); void send({ kind: 'update', update, confirmedSplit: true }) }}>{t("Save and switch…")}</button></div>
      </section></div>}
      {error && <div className="camera-panel-overlay"><section className="camera-panel-error" role="alert"><strong>{t("Camera control failed")}</strong><p>{message(error)}</p><button className="button secondary" onClick={() => setError('')}><ChevronsLeft size={15} />{t("Back to controls")}</button></section></div>}
    </>}
  </main>
}
