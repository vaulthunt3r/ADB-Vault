import { t as translateUi } from '../lib/i18n'
import { locale as uiLocale } from '../lib/i18n'
import { message } from "../lib/i18n"
import { t } from "../lib/i18n"
import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, MonitorSmartphone, AppWindow, X, Square, Keyboard, Circle, Settings2 } from 'lucide-react'
import { screenDefaults, screenLaunch, screenModeLabels, screenSessionMatchesDevice, cameraControlsError, screenInputError, supportsTouchControls, type CameraRotation, type ScreenCapabilities, type ScreenLaunch, type ScreenMode, type ScreenPreferences, type ScreenSession } from '../../electron/screen-protocol'
import { useScreenPreferences, useScreenStore } from '../store/useScreenStore'
import { WindowPinButton } from './WindowPinButton'
import { useAppStore } from '../store/useAppStore'
import { useConnectionStore } from '../store/useConnectionStore'
import { requestBackend } from '../lib/backend'
import { usePowerBlocked } from './DevicePowerActions'
import { ScreenApplicationPicker } from './ScreenApplicationPicker'
import { CameraCaptureOptions } from './CameraCaptureOptions'
import './screen-controls.css'

function useCapabilities() {
  const component = useAppStore(s => s.components.find(c => c.id === 'scrcpy'))
  const [capabilities, setCapabilities] = useState<ScreenCapabilities | null>(null), [error, setError] = useState(''), [revision, retry] = useState(0)
  const ready = !!component?.location && ['Detected', 'Installed', 'Update available'].includes(component.status)
  useEffect(() => {
    let cancelled = false
    setCapabilities(null); setError('')
    if (!ready || !window.desktop) return
    void window.desktop.request({ type: 'connection.screenCapabilities' }).then(reply => {
      if (cancelled) return
      if (reply.ok && reply.screenCapabilities) setCapabilities(reply.screenCapabilities)
      else setError(reply.ok ? "Could not read scrcpy capabilities." : reply.error)
    }).catch(e => { if (!cancelled) setError(String(e)) })
    return () => { cancelled = true }
  }, [ready, component?.location, component?.version, revision])
  return { capabilities, error, ready, retry: () => retry(r => r + 1) }
}

function ScreenOptions({ value: o, change, mode, capabilities, application = false, cameraTarget, stale }: { value: ScreenPreferences; change: (value: ScreenPreferences) => void; mode?: ScreenMode; capabilities: ScreenCapabilities | null; application?: boolean; cameraTarget?: { id: string; serial: string; transportId?: string }; stale?: boolean }) {
  const set = <K extends keyof ScreenPreferences>(key: K, value: ScreenPreferences[K]) => change({ ...o, [key]: value })
  const has = (flag: string) => !capabilities || capabilities.flags.includes(`--${flag}`)
  const inputPreset = o.keyboard === 'sdk' && o.mouse === 'sdk' ? o.gamepad ? 'gamepad' : 'apps' : o.keyboard === 'uhid' && o.mouse === 'uhid' && !o.gamepad ? 'desktop' : 'custom'
  const inputError = capabilities && mode !== 'camera' ? screenInputError(o, capabilities) : null
  const toggle = (key: 'fullscreen' | 'alwaysOnTop' | 'screenOff' | 'stayAwake' | 'control' | 'gamepad' | 'clipboard' | 'flexDisplay' | 'cameraTorch', label: string, hint: string, supported = true, disabled = false) => <label className="screen-check"><input type="checkbox" checked={o[key]} disabled={disabled || !supported && !o[key]} onChange={e => set(key, e.target.checked)} /><span>{t(label)}<small>{!supported ? t("Update scrcpy to use this option.") : t(hint)}</small></span></label>
  return <>
    {mode !== 'camera' && <fieldset className="screen-fields screen-input"><legend>{t("Keyboard, mouse & gamepad")}</legend>
      {toggle('control', translateUi("Control the phone"), application ? t("Required to launch and control the application in this window.") : t("Turn off for view only. Input settings are kept for the next controlled session."), true, application)}
      <div className="screen-grid">
        <label className="screen-wide">{t("Input preset")}<select aria-label={t("Input preset")} disabled={!o.control} value={inputPreset} onChange={e => {
          const preset = e.target.value
          if (preset !== 'custom') change({ ...o, keyboard: preset === 'desktop' ? 'uhid' : 'sdk', mouse: preset === 'desktop' ? 'uhid' : 'sdk', gamepad: preset === 'gamepad' })
        }}><option value="apps">{t("Apps & touch")}</option><option value="desktop" disabled={!has('keyboard') || !has('mouse')}>{t("Keyboard & mouse games")}</option><option value="gamepad" disabled={!has('gamepad')}>{t("Gamepad games")}</option><option value="custom" disabled>{t("Custom")}</option></select><small>{t("Presets change only the input devices. You can combine the options below.")}</small></label>
        <label>{t("Keyboard")}<select aria-label={t("Keyboard")} disabled={!o.control} value={o.keyboard} onChange={e => set('keyboard', e.target.value as ScreenPreferences['keyboard'])}><option value="sdk">{t("Standard input")}</option><option value="uhid" disabled={!has('keyboard')}>{t("Physical keyboard")}</option></select><small>{o.keyboard === 'uhid' ? t("Uses Android's physical keyboard layout. Press left Alt + K in the window to configure languages. Changing the PC layout does not change Android's layout.") : t("In a virtual display, open Window controls to type with your PC layout, including other languages. Without Window controls, standard input supports a limited set of characters.")}</small></label>
        <label>{t("Mouse")}<select aria-label={t("Mouse")} disabled={!o.control} value={o.mouse} onChange={e => set('mouse', e.target.value as ScreenPreferences['mouse'])}><option value="sdk">{t("Touch & pointer")}</option><option value="uhid" disabled={!has('mouse')}>{t("Physical mouse")}</option></select><small>{o.mouse === 'uhid' ? t("Sends relative movement and mouse buttons. Press and release left Alt to capture or release the cursor.") : t("Click, drag and scroll in Android. Right-click goes Back; Shift + right-click sends a right-click to the app.")}</small></label>
      </div>
      {toggle('gamepad', translateUi("Forward PC gamepads"), translateUi("Connect a controller to this PC by USB or Bluetooth, then focus the scrcpy window. The Android game must support controllers."), has('gamepad'), !o.control)}
      <p className="screen-note">{t("Keyboard, mouse and controller support depends on the Android app. For touch-only games, choose Apps & touch. Touch controls opens with the virtual display by default; saved game layouts start automatically. Physical input requires compatible phone firmware.")}</p>
      {inputError && <p className="screen-error" role="alert">{message(inputError)}</p>}
    </fieldset>}
    <fieldset className="screen-fields"><legend>{t("Picture & sound")}</legend><div className="screen-grid">
      <label>{t("Maximum resolution")}<select value={o.maxSize} onChange={e => set('maxSize', Number(e.target.value))}>{[[0, translateUi("Original")], [1280, '1280 px · lighter'], [1920, '1920 px · balanced'], [2560, '2560 px'], [3840, '3840 px']].map(([v, text]) => <option key={v} value={v}>{t(String(text))}</option>)}</select></label>
      {mode !== 'camera' && <label>{t("Frame rate limit")}<select value={o.maxFps} onChange={e => set('maxFps', Number(e.target.value))}>{[[0, 'Automatic'], [30, '30 FPS'], [60, '60 FPS'], [90, '90 FPS'], [120, '120 FPS']].map(([v, text]) => <option key={v} value={v}>{t(String(text))}</option>)}</select></label>}
      <label>{t("Video quality")}<select value={o.bitRate} onChange={e => set('bitRate', Number(e.target.value))}>{[2, 4, 8, 16, 32].map(v => <option key={v} value={v}>{v}{t(" Mbps")}{v === 8 ? t(" · default") : ''}</option>)}</select></label>
      <label>{t("Video codec")}<select value={o.codec} onChange={e => set('codec', e.target.value as ScreenPreferences['codec'])}><option value="h264">{t("H.264 · compatible")}</option><option value="h265" disabled={!has('video-codec')}>{t("H.265 · efficient")}</option><option value="av1" disabled={!has('video-codec')}>{t("AV1 · requires phone encoder")}</option></select></label>
      <label className="screen-wide">{t("Sound source")}<select value={o.audio} onChange={e => set('audio', e.target.value as ScreenPreferences['audio'])}><option value="off">{t("No sound")}</option><option value="device">{t("Device audio → computer")}</option><option value="duplicate" disabled={!has('audio-dup')}>{t("Device audio → phone + computer · Android 13+")}</option><option value="mic" disabled={!has('audio-source')}>{t("Phone microphone")}</option></select><small>{t("Device audio requires Android 11+. Unlock Android 11 before starting. Some apps prevent audio capture.")}</small></label>
    </div></fieldset>
    {(mode === 'virtual' || !mode) && <fieldset className="screen-fields"><legend>{t("Virtual display")}</legend><div className="screen-grid">
      <label>{t("Display size")}<select value={o.virtualSize} onChange={e => set('virtualSize', e.target.value)}><option value="">{t("Same as phone")}</option>{['1280x720', '1920x1080', '2560x1440', '1080x1920'].map(v => <option key={v}>{v}</option>)}</select></label>
      <label>{t("Display density")}<select value={o.virtualDpi} onChange={e => set('virtualDpi', Number(e.target.value))}>{[[0, 'Same as phone'], [160, '160 DPI · more space'], [240, '240 DPI'], [320, '320 DPI'], [420, '420 DPI · larger UI']].map(([v, text]) => <option key={v} value={v}>{text}</option>)}</select></label>
      <label className="screen-wide">{t("On-screen keyboard")}<select aria-label={t("On-screen keyboard")} disabled={!o.control} value={o.displayImePolicy} onChange={e => set('displayImePolicy', e.target.value as ScreenPreferences['displayImePolicy'])}><option value="local" disabled={!has('display-ime-policy')}>{t("In the virtual window")}</option><option value="fallback">{t("On the phone")}</option></select><small>{!has('display-ime-policy') ? t("Update scrcpy to show the keyboard in a virtual window, or choose On the phone.") : t("Where Android shows its touch keyboard when you select a text field. Applies to new virtual windows.")}</small></label>
    </div>{toggle('flexDisplay', translateUi("Resize Android display with the window"), translateUi("Requires phone controls. Apps may relayout when you resize."), has('flex-display'), !o.control)}
      <p className="screen-note">{t("Choose the starting application in Screen & recording, or use Apps → Actions → Virtual display. Closing the window ends the virtual display.")}</p>
    </fieldset>}
    {(mode === 'camera' || !mode) && <fieldset className="screen-fields"><legend>{t("Phone camera · Android 12+")}</legend><div className="screen-grid">
      <CameraCaptureOptions value={o} change={change} capabilities={capabilities} target={cameraTarget} stale={stale} />
      <label className="screen-wide">{t("Initial zoom")}<select aria-label={t("Initial zoom")} value={o.cameraZoom} onChange={e => set('cameraZoom', Number(e.target.value))}>{[0.5, 1, 1.5, 2, 3, 5, 10].map(zoom => <option key={zoom} value={zoom} disabled={zoom !== 1 && !has('camera-zoom')}>{zoom}×{zoom === 1 ? t(" · default") : ''}</option>)}</select><small>{has('camera-zoom') ? t("Available zoom range depends on the selected camera. Use left Alt + ↑ / ↓ in the camera window to adjust it while shooting.") : t("Update scrcpy to set the camera zoom.")}</small></label>
      <label>{t("Preview rotation")}<select aria-label={t("Preview rotation")} value={o.cameraPreviewRotation} onChange={e => set('cameraPreviewRotation', Number(e.target.value) as CameraRotation)}>{[0, 90, 180, 270].map(angle => <option key={angle} value={angle} disabled={angle !== 0 && !has('display-orientation')}>{angle}°{angle === 0 ? t(" · original") : t(" clockwise")}</option>)}</select></label>
      <label>{t("Recording rotation")}<select aria-label={t("Recording rotation")} value={o.cameraRecordRotation} onChange={e => set('cameraRecordRotation', e.target.value === 'preview' ? 'preview' : Number(e.target.value) as CameraRotation)}><option value="preview" disabled={o.cameraPreviewRotation !== 0 && !has('record-orientation')}>{t("Same as preview at start")}</option>{[0, 90, 180, 270].map(angle => <option key={angle} value={angle} disabled={angle !== 0 && !has('record-orientation')}>{angle}°{angle === 0 ? t(" · original") : t(" clockwise")}</option>)}</select></label>
    </div><p className="screen-note">{t("Recording rotation is used only when recording. Left Alt + ← / → rotates the preview without changing the saved video's orientation.")}</p>
      {toggle('cameraTorch', translateUi("Start with torch on"), translateUi("Requires a camera with a flash. In the camera window: left Alt + T turns it on, left Alt + Shift + T turns it off."), has('camera-torch'))}
      <p className="screen-note">{t("These settings apply at launch. Preview or record the camera on this PC; this does not register a Windows webcam. Camera sizes and frame rates depend on the phone.")}</p></fieldset>}
    <details className="screen-advanced"><summary><Settings2 size={15} />{t("Window & controls")}</summary><div className="screen-check-grid">
      {toggle('fullscreen', translateUi("Start fullscreen"), translateUi("Alt + F toggles fullscreen."), has('fullscreen'))}
      {toggle('alwaysOnTop', translateUi("Keep window on top"), translateUi("Keep scrcpy above other windows."), has('always-on-top'))}
      {mode !== 'camera' && <>
        {mode !== 'virtual' && toggle('screenOff', translateUi("Turn off the phone display"), translateUi("The PC preview stays visible."), has('turn-screen-off'), !o.control)}
        {toggle('stayAwake', translateUi("Keep awake while charging"), translateUi("Applies while USB or a charger is connected."), has('stay-awake'), !o.control)}
        {mode === 'virtual' && supportsTouchControls(o) ? <p className="screen-note">{t("Window controls use Ctrl+C / V for explicit copy and paste. Automatic clipboard sharing is off while using this input mode.")}</p> : toggle('clipboard', translateUi("Automatic clipboard sharing"), translateUi("Sync clipboard between the phone and PC."), has('no-clipboard-autosync'), !o.control)}
      </>}
    </div></details>
  </>
}

function Shortcuts({ mode, capabilities }: { mode?: ScreenMode; capabilities: ScreenCapabilities | null }) {
  const has = (flag: string) => !!capabilities?.flags.includes(`--${flag}`)
  const cameraKeys = [
    ...(has('camera-zoom') ? [['Alt + ↑ / ↓', translateUi("Camera: zoom in / out")]] : []),
    ...(has('camera-torch') ? [['Alt + T / Alt + Shift + T', translateUi("Camera: torch on / off")]] : []),
  ]
  const screenKeys = [[translateUi("Press and release left Alt"), translateUi("Capture / release the physical mouse")], ['Alt + K', translateUi("Physical keyboard layout settings")], ['Alt + H / B / S', translateUi("Home / Back / recent apps")], ['Alt + ↑ / ↓', translateUi("Phone screen: volume up / down")], ['Alt + O / Alt + Shift + O', translateUi("Phone display off / on")], ['Alt + N', translateUi("Notification panel")], ['Alt + R', translateUi("Rotate phone screen")], ['Ctrl + C / V', translateUi("Copy / paste in the Android app")]]
  const keys = [['Alt + F', translateUi("Toggle fullscreen")], ['Alt + ← / →', translateUi("Rotate preview only; recording is unchanged")], ...(!mode || mode === 'camera' ? cameraKeys : []), ...(mode !== 'camera' ? screenKeys : []), [translateUi("Close scrcpy window"), translateUi("Stop the session and finish the recording")]]
  return <details className="screen-advanced"><summary><Keyboard size={15} />{t("Controls & shortcuts")}</summary><dl className="screen-shortcuts">
    {keys.map(([shortcut, text]) => <div key={text}><dt>{t(shortcut)}</dt><dd>{t(text)}</dd></div>)}
  </dl><p className="screen-note">{t("Use the left Alt key while the scrcpy window is focused.")}{mode !== 'camera' && t(" Gamepads need firmware support for UHID.")}{t(" No root access is requested.")}</p></details>
}

export function ScreenSessions({ deviceId, heading = true }: { deviceId?: string; heading?: boolean }) {
  const sessions = useScreenStore(s => s.sessions)
  const device = useConnectionStore(s => s.devices.find(d => d.id === deviceId))
  const shown = sessions.filter(s => !deviceId || (device ? screenSessionMatchesDevice(s, device) : s.deviceId === deviceId))
  if (!shown.length) return null
  return <section className="screen-sessions" aria-label={t("Active scrcpy sessions")}>{heading && <h3>{t("Open windows · ")}{shown.length}</h3>}{shown.map(s => <ScreenSessionRow key={s.id} session={s} />)}</section>
}

export function ScreenSessionsDialog({ close }: { close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null), sessions = useScreenStore(s => s.sessions)
  useEffect(() => { const previous = document.activeElement as HTMLElement | null, dialog = ref.current; dialog?.showModal(); return () => { dialog?.close(); if (previous?.isConnected) previous.focus() } }, [])
  return <dialog className="screen-dialog" ref={ref} aria-labelledby="screen-windows-title" onCancel={e => { e.preventDefault(); close() }}>
    <header><AppWindow size={23} /><div><h2 id="screen-windows-title">{t("Open windows")}</h2><p>{t("Touch controls, camera controls and recordings.")}</p></div><button className="button secondary icon-button" aria-label={t("Close open windows")} onClick={close}><X size={18} /></button></header>
    <div className="screen-dialog-body"><p className="screen-note">{t("To map keys or gamepad buttons onto the screen, start a Virtual display with the Apps & touch preset, then choose Touch controls next to that window.")}</p>{sessions.length ? <ScreenSessions heading={false} /> : <p role="status">{t("No windows are open. Use Virtual display in the toolbar or in an application's Actions, then press Start.")}</p>}</div>
  </dialog>
}

function ScreenSessionRow({ session: s }: { session: ScreenSession }) {
  const [pending, setPending] = useState<'pin' | 'stop' | null>(null), [error, setError] = useState(''), submitting = useRef(false)
  const title = s.title || `${t(screenModeLabels[s.mode])} · ${s.applicationLabel || s.application || s.deviceName}`
  return <div className="screen-session" role="group" aria-label={title}>
    <div><strong>{title}</strong><small>{s.deviceName} · {t(screenModeLabels[s.mode])}</small>{s.application && <small>{s.application}</small>}{s.input && <small>{s.input.control ? t("Keyboard: {0} · Mouse: {1}{2}", [s.input.keyboard === 'uhid' ? t("physical") : t("standard"), s.input.mouse === 'uhid' ? t("physical (left Alt releases)") : t("touch / pointer"), s.input.gamepad ? t(" · PC gamepad forwarding on") : '']) : t("View only")}</small>}<small>{s.recording ? t("Recording · {0}", [s.recording]) : t("Preview running")} · {new Date(s.startedAt).toLocaleTimeString(uiLocale(), { hour: '2-digit', minute: '2-digit' })}</small></div>
    {s.mode === 'camera' && <button className="button secondary" title={t("Open zoom, torch and rotation controls for this running camera session.")} onClick={() => void requestBackend({ type: 'connection.cameraPanel', sessionId: s.id }, setError)}><Camera size={15} />{t("Live controls")}</button>}
    {s.mode === 'virtual' && <button className="button secondary" disabled={!s.virtualDisplayId || s.stopping} title={t("Type with your PC layout or configure game bindings. Use the Apps & touch input preset.")} onClick={() => void requestBackend({ type: 'connection.touchControls', sessionId: s.id }, setError)}><Keyboard size={15} />{t("Window controls")}</button>}
    {s.canSetAlwaysOnTop && <WindowPinButton enabled={s.alwaysOnTop} disabled={!!pending || s.stopping || s.restarting || s.controlling} onClick={async () => {
      if (submitting.current) return
      submitting.current = true; setPending('pin'); setError('')
      try { await requestBackend({ type: 'connection.screenOnTop', sessionId: s.id, enabled: !s.alwaysOnTop }, setError) }
      finally { submitting.current = false; setPending(null) }
    }} />}
    <button className="button secondary" disabled={!!pending || s.stopping || s.restarting || s.controlling} title={`${s.recording ? t("Finish recording and close") : t("Close")} ${title}`} onClick={async () => {
      if (submitting.current) return
      submitting.current = true; setPending('stop'); setError('')
      try { await requestBackend({ type: 'connection.screenStop', sessionId: s.id }, setError) }
      finally { submitting.current = false; setPending(null) }
    }}><Square size={14} />{pending === 'stop' || s.stopping ? t("Finishing…") : s.recording ? t("Finish recording") : t("Close session")}</button>
    {error && <p className="screen-error screen-session-error" role="alert">{message(error)}</p>}
  </div>
}

export function ScreenSettings() {
  const { preferences, set } = useScreenPreferences(), { capabilities, error, ready, retry } = useCapabilities()
  return <section className="section-content screen-settings" aria-labelledby="screen-settings-title"><div className="section-heading"><div><div className="eyebrow section-eyebrow">{t("SETTINGS / SCREEN & AUDIO")}</div><h1 id="screen-settings-title">{t("Screen & audio")}</h1><p>{t("Defaults for scrcpy windows. Changes apply to the next launch and are saved automatically.")}</p></div></div>
    <p className="screen-note">{capabilities ? t("scrcpy {0} · installed options detected", [capabilities.version]) : !ready ? t("Install or locate scrcpy in Components to start mirroring.") : error || t("Checking installed scrcpy…")}{error && <button className="button secondary" onClick={retry}>{t("Retry check")}</button>}</p>
    <ScreenOptions value={preferences} change={set} capabilities={capabilities} />
    <Shortcuts capabilities={capabilities} /><ScreenSessions /><button className="button secondary" onClick={() => set({ ...screenDefaults })}>{t("Reset screen defaults")}</button>
  </section>
}

export function ScreenDialog() {
  const context = useScreenStore(s => s.context)
  return context ? <ScreenLaunchDialog key={`${context.device.id}:${context.application?.packageName || ''}:${context.mode || 'display'}`} /> : null
}
function ScreenLaunchDialog() {
  const context = useScreenStore(s => s.context)!, close = useScreenStore(s => s.close)
  const ref = useRef<HTMLDialogElement>(null), submitting = useRef(false)
  const [options, setOptions] = useState<ScreenLaunch>(() => ({ ...screenLaunch(useScreenPreferences.getState().preferences), ...(context.mode ? { mode: context.mode, ...(context.mode === 'virtual' ? { control: true } : {}) } : {}), ...(context.application ? { mode: 'virtual', control: true, application: { packageName: context.application.packageName, userId: context.application.userId } } : {}) }))
  const [pending, setPending] = useState(false), [error, setError] = useState('')
  const { capabilities, error: capabilityError, ready, retry } = useCapabilities()
  const chooseApplication = useCallback((application: ScreenLaunch['application']) => setOptions(o => ({ ...o, application, control: true })), [])
  const blocked = usePowerBlocked()
  const live = useConnectionStore(s => s.devices.find(d => d.id === context.device.id))
  const stale = live?.status !== 'connected' || live.serial !== context.device.serial || live.transportId !== context.device.transportId
  const sessions = useScreenStore(s => s.sessions)
  const activeSessions = sessions.filter(s => screenSessionMatchesDevice(s, context.device))
  const conflict = options.mode !== 'virtual' && activeSessions.find(s => s.mode === options.mode)
  const existingApp = options.application && activeSessions.find(s => s.application === options.application?.packageName)
  const sdk = Number(live?.info?.fields.sdk) || undefined
  const has = (flag: string) => !!capabilities?.flags.includes(`--${flag}`)
  const imeUnsupported = !!capabilities && options.mode === 'virtual' && options.control && options.displayImePolicy === 'local' && !has('display-ime-policy')
  const cameraError = capabilities && options.mode === 'camera' ? cameraControlsError(options, capabilities, options.record) : null
  const inputError = capabilities && options.mode !== 'camera' ? screenInputError(options, capabilities) : null
  useEffect(() => { const previous = document.activeElement as HTMLElement | null, dialog = ref.current; dialog?.showModal(); return () => { dialog?.close(); if (previous?.isConnected) previous.focus() } }, [])
  return <dialog className="screen-dialog" ref={ref} aria-labelledby="screen-dialog-title" onCancel={e => { e.preventDefault(); if (!pending) close() }}>
    <header><MonitorSmartphone size={23} /><div><h2 id="screen-dialog-title">{t("Screen & recording")}</h2><p>{context.device.name}{context.application ? t(" · {0} · Profile ID {1}", [context.application.label, context.application.userId]) : ''}</p></div><button className="button secondary icon-button" aria-label={t("Close screen options")} disabled={pending} onClick={close}><X size={18} /></button></header>
    <div className="screen-dialog-body"><ScreenSessions deviceId={context.device.id} /><fieldset disabled={pending} className="screen-launch-fields">
      <div className="screen-modes" role="group" aria-label={t("Capture mode")}>{([{ id: 'display', label: t("Phone screen"), icon: MonitorSmartphone }, { id: 'virtual', label: t("Virtual display"), icon: AppWindow }, { id: 'camera', label: t("Camera"), icon: Camera }] as const).map(({ id, label, icon: Icon }) => <button className="button secondary" key={id} aria-pressed={options.mode === id} disabled={!!context.application && id !== 'virtual' || id === 'virtual' && !has('new-display') || id === 'camera' && (!has('video-source') || !!sdk && sdk < 31)} title={id === 'virtual' && !has('new-display') ? t("Update scrcpy for virtual displays.") : id === 'camera' ? t("Requires Android 12+ and a compatible scrcpy version.") : undefined} onClick={() => setOptions(o => ({ ...o, mode: id, application: context.application ? o.application : undefined, control: id === 'virtual' ? true : o.control }))}><Icon size={17} />{label}</button>)}</div>
      {options.mode === 'virtual' && !context.application && <ScreenApplicationPicker device={context.device} stale={stale} application={options.application} suggestedApplication={context.suggestedApplication} change={chooseApplication} />}
      <ScreenOptions value={options} change={value => setOptions(o => ({ ...o, ...value }))} mode={options.mode} capabilities={capabilities} application={options.mode === 'virtual'} cameraTarget={{ id: context.device.id, serial: context.device.serial, transportId: context.device.transportId }} stale={stale} />
      {options.mode === 'virtual' && <label className="screen-check"><input type="checkbox" checked={options.touchControls !== false && supportsTouchControls(options)} disabled={!supportsTouchControls(options)} onChange={e => setOptions(o => ({ ...o, touchControls: e.target.checked }))} /><span>{t("Open window controls automatically")}<small>{supportsTouchControls(options) ? t("Starts in Typing mode for ordinary apps. Game controls start only after you enable them for this app.") : t("Choose Apps & touch for PC text entry and game mappings.")}</small></span></label>}
      {options.mode === 'virtual' && sdk && sdk < 35 && (options.keyboard === 'uhid' || options.mouse === 'uhid' || options.gamepad) && <p className="screen-note">{t("On Android 14 and older, physical input routing between displays depends on firmware and focus. If input reaches the phone instead, use Standard input and Touch & pointer.")}</p>}
      {options.mode === 'virtual' && <p className="screen-note">{t("Each launch creates a separate window. The number of windows your phone can run depends on its hardware and firmware.")}</p>}
      {activeSessions.length > 0 && (options.audio === 'device' || options.audio === 'duplicate') && <p className="screen-note">{t("Device audio includes the whole phone. Choose No sound for additional windows to avoid playing the same audio more than once.")}</p>}
      {existingApp && <p className="screen-note">{t("This app is already open in ")}{existingApp.title || t("another window")}{t(". Android may move the existing app instead of opening another instance.")}</p>}
      <fieldset className="screen-fields"><legend>{t("Recording")}</legend><label className="screen-check"><input type="checkbox" checked={options.record} disabled={!has('record')} onChange={e => setOptions(o => ({ ...o, record: e.target.checked }))} /><span>{t("Record this session")}<small>{t("Choose a new file after Start. Close the scrcpy window or use Finish recording to save it.")}</small></span></label>
        {options.record && <div className="screen-grid"><label>{t("File format")}<select value={options.recordFormat} onChange={e => setOptions(o => ({ ...o, recordFormat: e.target.value as 'mkv' | 'mp4' }))}><option value="mkv">{t("MKV · resilient recording")}</option><option value="mp4">{t("MP4")}</option></select></label><label>{t("Stop automatically")}<select value={options.timeLimit} disabled={!has('time-limit')} onChange={e => setOptions(o => ({ ...o, timeLimit: Number(e.target.value) }))}>{[[0, translateUi("When I close the window")], [60, translateUi("After 1 minute")], [300, translateUi("After 5 minutes")], [900, translateUi("After 15 minutes")], [3600, translateUi("After 1 hour")]].map(([v, text]) => <option key={v} value={v}>{text}</option>)}</select></label></div>}
      </fieldset><Shortcuts mode={options.mode} capabilities={capabilities} />
    </fieldset>
      {(!ready || capabilityError || stale || error || cameraError) && <p className="screen-error" role="alert">{error || (stale ? t("This phone connection changed. Close this dialog and select the phone again.") : !ready ? t("Install or locate scrcpy in Components first.") : capabilityError || cameraError)}{capabilityError && <button className="button secondary" onClick={retry}>{t("Retry check")}</button>}</p>}
    </div>
    <footer><span>{conflict ? t("{0} is already open. Close that window or choose Virtual display.", [t(screenModeLabels[options.mode])]) : imeUnsupported ? t("Choose On the phone or update scrcpy to continue.") : cameraError ? t("Review the unsupported camera option.") : inputError ? t("Review the unsupported input option.") : capabilities ? t("{0} open · scrcpy {1} · settings for this launch", [activeSessions.length, capabilities.version]) : t("Checking scrcpy…")}</span><button className="button secondary" disabled={pending} onClick={close}>{t("Cancel")}</button><button className="button primary" disabled={pending || stale || blocked || !capabilities || !!conflict || imeUnsupported || !!cameraError || !!inputError || options.mode === 'virtual' && !options.application} onClick={async () => {
      if (submitting.current) return
      submitting.current = true; setPending(true); setError('')
      try { const ok = await requestBackend({ type: 'connection.screen', id: context.device.id, serial: context.device.serial, transportId: context.device.transportId, action: 'open', options: { ...options, timeLimit: options.record ? options.timeLimit : 0 } }, setError); if (ok) close() }
      finally { submitting.current = false; setPending(false) }
    }}>{options.record && <Circle size={13} />}{pending ? t("Starting…") : options.record ? t("Start recording…") : t("Start")}</button></footer>
  </dialog>
}
