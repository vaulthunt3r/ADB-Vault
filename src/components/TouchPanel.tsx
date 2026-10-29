import { t as translateUi } from '../lib/i18n'
import { t, message } from "../lib/i18n"
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { TouchEngine } from '../../electron/touch-engine'
import { editingKey, type TouchInput } from '../../electron/touch-input'
import { WindowPinButton } from './WindowPinButton'
import { bindingLabel, reservedKeys, touchTemplate, validBinding, validateProfile, type TouchMark, type TouchProfile, type TouchState, type TouchTemplate } from '../../electron/touch-protocol'
import { hotkeyCode, hotkeyLabel, keyboardHotkey, modifierKey, touchHotkeyActions, touchHotkeyLabels, touchHotkeys, validateTouchHotkeys, type TouchHotkeyAction } from '../../electron/touch-hotkeys'
import './touch-panel.css'

type Mode = 'edit' | 'play' | 'menu'
export function TouchPanel() {
  const [state, setState] = useState<TouchState>({ title: t("Touch controls") })
  const [pinPending, setPinPending] = useState(false), pinSubmitting = useRef(false)
  const [profiles, setProfiles] = useState<TouchProfile[]>([touchTemplate('empty')]), [selected, setSelected] = useState(0)
  const [mode, setMode] = useState<Mode>('menu'), [markId, setMarkId] = useState(''), [properties, setProperties] = useState(true)
  const [loaded, setLoaded] = useState(false), [saved, setSaved] = useState('Loading profile…'), [error, setError] = useState('')
  const [capture, setCapture] = useState<{ id: string; slot: number } | null>(null), [gamepad, setGamepad] = useState('No gamepad detected')
  const [hotkeyCapture, setHotkeyCapture] = useState<TouchHotkeyAction | null>(null), [hotkeysOpen, setHotkeysOpen] = useState(false), [toolbarVisible, setToolbarVisible] = useState(true)
  const [focused, setFocused] = useState(document.hasFocus()), [pointerLocked, setPointerLocked] = useState(false)
  const inputActive = useRef(document.hasFocus()), inputGeneration = useRef(0), requestedMode = useRef<Mode | null>(null)
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight })
  const stage = useRef<HTMLDivElement>(null), engine = useRef(new TouchEngine()), drag = useRef<{ id: string; dx: number; dy: number; startX: number; startY: number; moved: boolean } | null>(null)
  const textField = useRef<HTMLTextAreaElement>(null), composing = useRef(false)
  const profile = profiles[selected] || profiles[0], selectedMark = profile.marks.find(m => m.id === markId)
  const current = useRef({ state, profile, mode, loaded, capture, hotkeyCapture, toolbarVisible }); current.current = { state, profile, mode, loaded, capture, hotkeyCapture, toolbarVisible }
  const hotkeys = touchHotkeys(profile)
  const geometry = state.geometry, orientation = geometry ? geometry.width >= geometry.height ? 'landscape' : 'portrait' : ''
  const scale = geometry ? Math.min(size.width / geometry.width, size.height / geometry.height) : 1
  const videoWidth = geometry ? geometry.width * scale : size.width, videoHeight = geometry ? geometry.height * scale : size.height
  const releaseInputs = () => {
    engine.current.reset(); inputGeneration.current++
    const geo = current.current.state.geometry
    if (geo) window.touchDesk?.frame(geo.epoch, [])
  }
  const focus = (active: boolean) => {
    const next = active && document.hasFocus() && !document.hidden
    if (inputActive.current === next) return
    inputActive.current = next
    setFocused(inputActive.current); releaseInputs()
    if (!active) { setCapture(null); setHotkeyCapture(null); if (document.pointerLockElement) document.exitPointerLock() }
  }
  const pause = (next: Mode = 'menu', remember = true) => {
    if (remember) requestedMode.current = next
    if (remember && next === 'menu' && current.current.loaded) setProfiles(list => list.map((p, i) => i === selected ? { ...p, autoStart: false } : p))
    current.current.mode = next; releaseInputs(); setMode(next); setCapture(null); setHotkeyCapture(null); setToolbarVisible(true)
    if (document.pointerLockElement) document.exitPointerLock()
  }
  const sendInput = (input: TouchInput) => {
    const c = current.current
    if (c.mode !== 'menu' || !c.loaded || c.state.error || !c.state.geometry || !inputActive.current || !document.hasFocus()) return
    void window.touchDesk?.input(c.state.geometry.epoch, input).then(() => setError('')).catch(e => setError((e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '').replace(/^Android input: [\w$]+: /, '')))
  }
  const focusText = () => { if (current.current.mode === 'menu' && inputActive.current) textField.current?.focus({ preventScroll: true }) }
  const commitText = () => {
    const field = textField.current
    if (!field || composing.current || !field.value) return
    const text = field.value; field.value = ''; sendInput({ type: 'text', text })
  }
  useEffect(() => { if (mode === 'menu' && loaded && focused) focusText() }, [mode, loaded, focused])
  const patch = (id: string, change: Partial<TouchMark>) => setProfiles(list => list.map((p, i) => i === selected ? { ...p, marks: p.marks.map(m => m.id === id ? { ...m, ...change } : m) } : p))
  const assign = (key: string) => {
    const target = current.current.capture
    if (!target) return
    if (!validBinding(key)) { setError("This key is reserved for leaving the game or editing."); return }
    if (Object.values(touchHotkeys(current.current.profile)).some(value => value && hotkeyCode(value) === key)) { setError("This key is assigned to a hotkey. Change it in Hotkeys first."); return }
    const mark = current.current.profile.marks.find(m => m.id === target.id)
    if (mark) { const bindings = [...mark.bindings]; bindings[target.slot] = key; patch(mark.id, { bindings }); setError('') }
    setCapture(null)
  }
  const assignHotkey = (action: TouchHotkeyAction, value: string) => {
    const next = { ...profile, hotkeys: { ...hotkeys, [action]: value } }
    try { validateTouchHotkeys(next) } catch (e) { setError((e as Error).message); return }
    setProfiles(list => list.map((p, i) => i === selected ? next : p)); setHotkeyCapture(null); setError('')
  }
  const handlers = useRef({ pause, focus, releaseInputs, assign, assignHotkey, sendInput, focusText, captureMouse: () => {}, hotkey: (_action: TouchHotkeyAction) => {} })
  useLayoutEffect(() => {
    document.documentElement.classList.add('touch-overlay')
    const resize = () => { handlers.current.releaseInputs(); setSize({ width: window.innerWidth, height: window.innerHeight }) }
    window.addEventListener('resize', resize)
    return () => { document.documentElement.classList.remove('touch-overlay'); window.removeEventListener('resize', resize) }
  }, [])
  useEffect(() => {
    let active = true, received = false
    const update = (value: TouchState) => {
      if (!active) return
      const previous = current.current.state.geometry, next = value.geometry
      if (value.error) handlers.current.pause('edit')
      else if (next?.epoch !== previous?.epoch) {
        // Release old contacts, but retain the user's Play/Menu/Edit choice.
        handlers.current.releaseInputs()
        if (document.pointerLockElement) document.exitPointerLock()
      }
      if (!next || !previous || (next.width >= next.height) !== (previous.width >= previous.height)) {
        current.current.loaded = false; setLoaded(false)
        handlers.current.pause('edit', false)
      }
      current.current.state = value; setState(value)
    }
    const off = window.touchDesk?.subscribe(value => { received = true; update(value) })
    const offFocus = window.touchDesk?.onFocus(active => handlers.current.focus(active))
    void window.touchDesk?.state().then(value => { if (!received) update(value) }).catch(e => setError(String(e)))
    return () => { active = false; off?.(); offFocus?.(); engine.current.reset() }
  }, [])
  useEffect(() => {
    if (!orientation) return
    let active = true
    current.current.loaded = false; setLoaded(false); setSaved("Loading profile…"); handlers.current.pause('edit', false)
    void window.touchDesk?.profiles(orientation).then(list => { if (active) {
      const geometry = current.current.state.geometry
      if (!geometry || (geometry.width >= geometry.height ? 'landscape' : 'portrait') !== orientation) return
      if (!list.length) throw new Error('No saved profiles were found.')
      list.forEach(validateProfile)
      if (new Set(list.map(p => p.name)).size !== list.length) throw new Error('Each profile needs a different name.')
      setProfiles(list); setSelected(0); setMarkId(''); setLoaded(true); setSaved("Saved"); setError('')
      const desired = requestedMode.current ?? (current.current.state.autoStart && list[0].autoStart === true ? 'play' : 'menu')
      const next = current.current.state.error ? 'edit' : desired === 'play' && !list[0].marks.length ? 'menu' : desired
      current.current.profile = list[0]; current.current.loaded = true; current.current.mode = next; setMode(next)
    } }).catch(e => { if (active) { handlers.current.pause('edit'); setError(String(e)); setSaved("Could not load profile") } })
    return () => { active = false }
  }, [orientation])
  let validation = ''
  try { profiles.forEach(validateProfile); if (new Set(profiles.map(p => p.name)).size !== profiles.length) validation = 'Each profile needs a different name.' } catch (e) { validation = (e as Error).message }
  useEffect(() => {
    if (!loaded || !orientation || validation) return
    let active = true; setSaved("Saving…")
    const timer = setTimeout(() => { void window.touchDesk?.profiles(orientation, [profiles[selected], ...profiles.filter((_, i) => i !== selected)]).then(() => { if (active) setSaved("Saved") }).catch(e => { if (active) { setSaved("Save failed"); setError(String(e)) } }) }, 350)
    return () => { active = false; clearTimeout(timer) }
  }, [profiles, selected, loaded, orientation, validation])
  useEffect(() => {
    let last = performance.now(), lastPadName = '', previousButtons = new Set<string>(), padIndex = -1, padArmed = false, activePad: Gamepad | null = null
    let modifierTap: { code: string; value: string } | null = null, generation = inputGeneration.current
    const consumedKeys = new Set<string>()
    const editingField = (e: KeyboardEvent) => e.target instanceof HTMLElement && !e.target.classList.contains('touch-text-input') && (e.target.matches('input, textarea, select') || e.target.isContentEditable)
    const send = (now: number, elapsed: number, pad: Gamepad | null) => {
      if (generation !== inputGeneration.current) { generation = inputGeneration.current; padArmed = false }
      const c = current.current
      if (!inputActive.current || !document.hasFocus() || !c.loaded || !c.state.geometry || c.state.error || c.mode === 'edit') return
      const bounds = stage.current?.getBoundingClientRect()
      if (!bounds?.width || !bounds.height) return
      const points = c.mode === 'play' ? engine.current.frame(c.profile, bounds.width, bounds.height, padArmed ? pad : null, !!document.pointerLockElement, now, elapsed) : engine.current.direct ? [engine.current.direct] : []
      window.touchDesk?.frame(c.state.geometry.epoch, points)
    }
    const tick = (now: number) => {
      if (generation !== inputGeneration.current) { generation = inputGeneration.current; padArmed = false }
      const pad = [...navigator.getGamepads()].find(p => p?.connected && p.mapping === 'standard') || null
      activePad = pad
      const name = pad ? translateUi("Gamepad: {0}", [pad.id]) : t("No standard gamepad detected · press a controller button")
      if (name !== lastPadName) { lastPadName = name; setGamepad(name) }
      if (padIndex !== (pad?.index ?? -1)) { if (padIndex >= 0) handlers.current.pause(); padIndex = pad?.index ?? -1; padArmed = false }
      const buttons = new Set((pad?.buttons || []).flatMap((b, i) => b.pressed || b.value > .25 ? [`Pad${i}`] : []))
      if (inputActive.current && document.hasFocus() && !buttons.size && !pad?.axes.some(a => Math.abs(a) > .18)) padArmed = true
      if (!inputActive.current || !document.hasFocus() || current.current.mode !== 'play') padArmed = false
      if (current.current.capture && !current.current.hotkeyCapture) { const next = [...buttons].find(b => !previousButtons.has(b)); if (next) handlers.current.assign(next) }
      previousButtons = buttons
      send(now, now - last, pad); last = now
    }
    const shortcut = (value: string) => {
      const c = current.current
      if (c.hotkeyCapture) { handlers.current.assignHotkey(c.hotkeyCapture, value); return true }
      if (c.capture) return false
      const action = touchHotkeyActions.find(action => touchHotkeys(c.profile)[action] === value)
      if (!action) return false
      handlers.current.hotkey(action); return true
    }
    const keyDown = (e: KeyboardEvent) => {
      if (editingField(e) || e.isComposing || e.keyCode === 229) { modifierTap = null; return }
      if (!inputActive.current || !document.hasFocus()) return
      if (e.code === 'Escape' && current.current.mode === 'menu' && !current.current.toolbarVisible) { e.preventDefault(); setToolbarVisible(true); return }
      if (current.current.mode === 'menu' && !current.current.capture && !current.current.hotkeyCapture && !e.getModifierState('AltGraph')) {
        const input = editingKey(e)
        if (input) { modifierTap = null; e.preventDefault(); handlers.current.sendInput(input); handlers.current.focusText(); return }
      }
      if (e.repeat && current.current.mode !== 'menu') { e.preventDefault(); return }
      modifierTap = null
      if (e.code === 'Escape' && current.current.mode !== 'menu') { e.preventDefault(); handlers.current.pause(current.current.mode === 'edit' ? 'edit' : 'menu'); return }
      // A modifier alone is a shortcut only after release, never at the start of Alt+Shift.
      if (modifierKey(e.code)) modifierTap = { code: e.code, value: keyboardHotkey(e) }
      else if (!e.repeat && (current.current.mode !== 'menu' || current.current.hotkeyCapture || e.ctrlKey || e.altKey || e.metaKey || e.key.length > 1) && shortcut(keyboardHotkey(e))) { consumedKeys.add(e.code); e.preventDefault(); e.stopPropagation(); return }
      if (current.current.hotkeyCapture) return
      if (current.current.capture) { e.preventDefault(); e.stopPropagation(); if (!e.repeat) handlers.current.assign(e.code); return }
      if (current.current.mode === 'menu') {
        if (e.getModifierState('AltGraph')) return
        const input = editingKey(e)
        if (input) { e.preventDefault(); handlers.current.sendInput(input); handlers.current.focusText(); return }
        // Chromium's text events carry the active PC layout, dead keys and IME
        // composition. Do not turn physical KeyA/KeyW codes into Latin letters.
        if (!e.ctrlKey && !e.altKey && !e.metaKey && !modifierKey(e.code)) handlers.current.focusText()
        return
      }
      if (current.current.mode !== 'play') return
      if (modifierKey(e.code) && touchHotkeyActions.some(action => hotkeyCode(touchHotkeys(current.current.profile)[action]) === e.code)) return
      // Alt+Tab / Win switch windows. Release keys without cancelling Play.
      if (reservedKeys.has(e.code)) { handlers.current.releaseInputs(); return }
      if (e.altKey && e.code !== 'AltLeft' && e.code !== 'AltRight') return
      e.preventDefault(); if (!e.repeat) { engine.current.held.add(e.code); send(performance.now(), 0, activePad) }
    }
    const keyUp = (e: KeyboardEvent) => {
      engine.current.held.delete(e.code)
      if (consumedKeys.delete(e.code)) { e.preventDefault(); e.stopPropagation(); return }
      const pending = modifierTap; modifierTap = null
      if (pending?.code === e.code && !editingField(e) && !e.isComposing && shortcut(pending.value)) { e.preventDefault(); e.stopPropagation(); return }
      send(performance.now(), 0, activePad)
    }
    const mouseDown = (e: MouseEvent) => {
      modifierTap = null
      if (current.current.hotkeyCapture) return
      if (current.current.capture) { e.preventDefault(); e.stopPropagation(); handlers.current.assign(`Mouse${e.button}`); return }
      if ((e.target as HTMLElement).closest('.touch-ui')) return
      if (!inputActive.current || !document.hasFocus()) return
      if (current.current.mode === 'play' && !document.pointerLockElement && current.current.profile.marks.some(m => m.kind === 'look')) { e.preventDefault(); handlers.current.captureMouse(); return }
      if (current.current.mode === 'play' && current.current.profile.marks.some(m => m.bindings.includes(`Mouse${e.button}`))) { engine.current.held.add(`Mouse${e.button}`); send(performance.now(), 0, activePad); return }
      if (current.current.mode === 'edit' || document.pointerLockElement || e.button !== 0) return
      const rect = stage.current?.getBoundingClientRect()
      if (rect && e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
        engine.current.direct = { id: 9, x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height }
        send(performance.now(), 0, activePad)
      }
    }
    const mouseUp = (e: MouseEvent) => { engine.current.held.delete(`Mouse${e.button}`); if (e.button === 0) engine.current.direct = undefined; send(performance.now(), 0, activePad); if (!(e.target as HTMLElement).closest('.touch-ui')) handlers.current.focusText() }
    const wheel = (e: WheelEvent) => {
      if (current.current.mode !== 'menu' || (e.target as HTMLElement).closest('.touch-ui')) return
      const rect = stage.current?.getBoundingClientRect()
      if (!rect || e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return
      e.preventDefault()
      const unit = e.deltaMode === 0 ? 100 : e.deltaMode === 1 ? 3 : 1
      handlers.current.sendInput({ type: 'scroll', x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height, dx: Math.max(-10, Math.min(10, -e.deltaX / unit)), dy: Math.max(-10, Math.min(10, -e.deltaY / unit)) })
    }
    const mouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement && current.current.mode === 'play') engine.current.move(e.movementX, e.movementY)
      else if (engine.current.direct) {
        const rect = stage.current?.getBoundingClientRect()
        if (rect) engine.current.direct = { id: 9, x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)) }
      }
    }
    const lockChange = () => { setPointerLocked(!!document.pointerLockElement); if (!document.pointerLockElement) handlers.current.releaseInputs() }
    const blur = () => { modifierTap = null; consumedKeys.clear(); handlers.current.focus(false) }
    const focus = () => { modifierTap = null; handlers.current.focus(true) }
    const visibility = () => { if (document.hidden) blur(); else if (document.hasFocus()) focus() }
    window.addEventListener('keydown', keyDown, true); window.addEventListener('keyup', keyUp)
    window.addEventListener('mousedown', mouseDown, true); window.addEventListener('mouseup', mouseUp); window.addEventListener('mousemove', mouseMove)
    window.addEventListener('wheel', wheel, { passive: false })
    window.addEventListener('blur', blur); window.addEventListener('focus', focus); document.addEventListener('visibilitychange', visibility); document.addEventListener('pointerlockchange', lockChange)
    // Input heartbeat must not depend on Chromium rendering a new video frame.
    const timer = window.setInterval(() => tick(performance.now()), 16)
    return () => {
      clearInterval(timer); engine.current.reset()
      window.removeEventListener('keydown', keyDown, true); window.removeEventListener('keyup', keyUp)
      window.removeEventListener('mousedown', mouseDown, true); window.removeEventListener('mouseup', mouseUp); window.removeEventListener('mousemove', mouseMove)
      window.removeEventListener('wheel', wheel)
      window.removeEventListener('blur', blur); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', visibility); document.removeEventListener('pointerlockchange', lockChange)
    }
  }, [])
  const captureMouse = () => {
    setError('')
    if (!document.pointerLockElement) void stage.current?.requestPointerLock().catch(e => { if (inputActive.current && current.current.mode === 'play') setError(`Mouse capture failed: ${String(e)}. Click the game to try again.`) })
  }
  const play = () => {
    if (!loaded || !geometry || validation || state.error || !profile.marks.length) return
    setProfiles(list => list.map((p, i) => i === selected ? { ...p, autoStart: true } : p))
    requestedMode.current = 'play'; releaseInputs(); current.current.mode = 'play'; setCapture(null); setHotkeyCapture(null); setError(''); setMode('play')
    if (profile.marks.some(m => m.kind === 'look')) captureMouse()
  }
  const openEditor = () => { pause('edit'); setProperties(true) }
  handlers.current = { pause, focus, releaseInputs, captureMouse, assign, assignHotkey, sendInput, focusText, hotkey: action => {
    if (action === 'release') pause(current.current.mode === 'edit' ? 'edit' : 'menu')
    else if (action === 'edit') openEditor()
    else if (action === 'play') { if (current.current.mode === 'play') pause(); else play() }
    else setToolbarVisible(visible => !visible)
  } }
  const addProfile = (template: TouchTemplate, copy = false) => {
    if (profiles.length >= 20) return
    const next = structuredClone(copy ? profile : touchTemplate(template)), base = copy ? `${profile.name} copy`.slice(0, 50) : next.name
    let name = base, count = 2; while (profiles.some(p => p.name === name)) name = `${base} ${count++}`
    next.name = name; setProfiles([...profiles, next]); setSelected(profiles.length); setMarkId(''); pause('edit')
  }
  const addMark = (kind: TouchMark['kind']) => {
    const mark: TouchMark = { id: crypto.randomUUID(), kind, x: .5, y: .5, radius: kind === 'look' ? .2 : .08, bindings: kind === 'button' ? ['', ''] : kind === 'stick' ? ['KeyW', 'KeyA', 'KeyS', 'KeyD'] : [], sensitivity: 1, gamepad: true }
    setProfiles(list => list.map((p, i) => i === selected ? { ...p, marks: [...p.marks, mark] } : p)); setMarkId(mark.id); setProperties(true)
  }
  const close = async () => {
    pause('menu', false)
    try { if (loaded && orientation && !validation) await window.touchDesk?.profiles(orientation, [profiles[selected], ...profiles.filter((_, i) => i !== selected)]); await window.touchDesk?.close() } catch (e) { setError(String(e)) }
  }
  const toggleGame = () => {
    const enabled = mode !== 'play'
    setProfiles(list => list.map((p, i) => i === selected ? { ...p, autoStart: enabled } : p))
    if (enabled) play(); else pause('menu')
  }
  return <main className={`touch-root mode-${mode}`} onContextMenu={e => e.preventDefault()}>
    {mode === 'menu' && <textarea ref={textField} className="touch-text-input" aria-label={t("Type in Android app")} autoComplete="off" autoCapitalize="off" spellCheck={false} onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false; commitText() }} onInput={commitText} onBlur={() => { composing.current = false; if (textField.current) textField.current.value = '' }} />}
    <div className="touch-stage" ref={stage} style={{ width: videoWidth, height: videoHeight, left: (size.width - videoWidth) / 2, top: (size.height - videoHeight) / 2 }}
      onPointerMove={e => {
        const moving = drag.current; if (!moving || mode !== 'edit') return
        if (!moving.moved && Math.hypot(e.clientX - moving.startX, e.clientY - moving.startY) < 4) return
        if (!moving.moved) { moving.moved = true; setProperties(false) }
        const rect = e.currentTarget.getBoundingClientRect()
        patch(moving.id, { x: Math.max(0, Math.min(1, (e.clientX - rect.left - moving.dx) / rect.width)), y: Math.max(0, Math.min(1, (e.clientY - rect.top - moving.dy) / rect.height)) })
      }} onPointerUp={() => { const moving = drag.current; drag.current = null; if (moving && !moving.moved) setProperties(true) }} onLostPointerCapture={() => { drag.current = null }}>
      {mode === 'edit' && profile.marks.map(m => <button key={m.id} aria-label={t("Move {0} {1}", [m.kind, m.id])} className={`touch-mark kind-${m.kind} ${markId === m.id ? 'selected' : ''}`} style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, width: m.kind === 'button' ? 48 : m.radius * Math.min(videoWidth, videoHeight) * 2, height: m.kind === 'button' ? 48 : m.radius * Math.min(videoWidth, videoHeight) * 2 }} onPointerDown={e => {
        if (e.button !== 0) return
        e.preventDefault(); e.stopPropagation(); setMarkId(m.id)
        const rect = stage.current!.getBoundingClientRect(); drag.current = { id: m.id, dx: e.clientX - rect.left - m.x * rect.width, dy: e.clientY - rect.top - m.y * rect.height, startX: e.clientX, startY: e.clientY, moved: false }; stage.current!.setPointerCapture(e.pointerId)
      }}><span>{m.kind === 'stick' ? m.bindings.map(bindingLabel).join(' ') : m.kind === 'look' ? t("Mouse / RS") : bindingLabel(m.bindings[0] || m.bindings[1]) || t("+ Key")}</span><small>{m.kind === 'stick' ? t("Move · LS") : m.kind === 'look' ? t("Look") : m.bindings[0] && m.bindings[1] ? bindingLabel(m.bindings[1]) : t("Touch")}</small></button>)}
    </div>
    {toolbarVisible && <header className="touch-ui touch-toolbar">
      <strong>{mode === 'edit' ? t("Edit layout") : mode === 'play' ? focused ? t("Game controls active") : t("Return to game to resume") : t("Typing · PC layout")}</strong>
      <button aria-pressed={mode === 'play'} className={mode === 'play' ? 'active' : ''} title={t("On: keys press your game's touch buttons. Off: type using your PC layout. This choice is remembered for this app and orientation.")} disabled={!loaded || !!validation || !!state.error || !profile.marks.length} onClick={toggleGame}>{mode === 'play' ? t("Game controls: On") : t("Game controls: Off")}</button>
      {mode === 'edit' && <button onClick={() => pause('menu')}>{t("Done · type in app")}</button>}<button title={t("Arrange touch controls and change their bindings.")} onClick={() => { pause('edit'); setProperties(v => mode !== 'edit' || !v) }}>{t("Edit layout")}{hotkeys.edit && ` · ${hotkeyLabel(hotkeys.edit)}`}</button>
      <button onClick={() => { openEditor(); setHotkeysOpen(true) }}>{t("Hotkeys")}</button>
      {state.canSetAlwaysOnTop && <WindowPinButton compact enabled={state.alwaysOnTop} disabled={pinPending || state.windowBusy} onClick={async () => {
        if (!window.touchDesk || pinSubmitting.current) return
        pinSubmitting.current = true; setPinPending(true); setError('')
        try { await window.touchDesk.setAlwaysOnTop(!state.alwaysOnTop) }
        catch (e) { setError(e instanceof Error ? e.message : String(e)) }
        finally { pinSubmitting.current = false; setPinPending(false) }
      }} />}
      <span className="touch-shortcut" title={mode === 'menu' ? t("Unlock the phone for PC typing. Change the language on your PC; the on-screen keyboard has its own layout. Text uses Android paste, so fields that block paste may reject it.") : undefined}>{mode === 'menu' ? t("Ctrl+C / V · copy / paste") : `${hotkeys.release ? `${hotkeyLabel(hotkeys.release)} / ` : ''}${t("Esc: switch to typing")}`}</span>
      <button aria-label={t("Hide controls")} title={t("Hide controls{0}", [hotkeys.panel ? t(" · {0} shows them again", [hotkeyLabel(hotkeys.panel)]) : t(" · Esc shows them again")])} onClick={() => setToolbarVisible(false)}>−{hotkeys.panel && ` ${hotkeyLabel(hotkeys.panel)}`}</button><button aria-label={t("Close window controls")} title={t("Close PC typing and game controls. The window returns to scrcpy input.")} onClick={() => void close()}>×</button>
    </header>}
    {mode === 'play' && focused && !pointerLocked && profile.marks.some(m => m.kind === 'look') && <div className="touch-ui touch-capture"><button onClick={captureMouse}>{t("Click the game to capture mouse")}</button><small>{t("Esc: menu")}</small></div>}
    {(error || validation || state.error || !geometry) && <div className="touch-ui touch-alert" role="alert">{message(state.error || error || validation) || t("Connecting to the virtual display…")}</div>}
    {toolbarVisible && mode === 'edit' && properties && <aside className="touch-ui touch-inspector">
      <div className="touch-heading"><div><h2>{t("Game layout")}</h2><small title={state.title}>{state.title}</small></div><button aria-label={t("Hide layout settings")} onClick={() => setProperties(false)}>−</button></div>
      <p>{t("Drag markers onto the game's touch buttons. Settings hide while dragging; click a marker to edit it. Radius sets the stick travel or look area.")}</p>
      <fieldset disabled={!loaded}>
        <label>{t("Profile")}<select value={selected} onChange={e => { pause('edit'); setSelected(Number(e.target.value)); setMarkId('') }}>{profiles.map((p, i) => <option key={i} value={i}>{p.name}</option>)}</select></label>
        <label>{t("Profile name")}<input maxLength={60} value={profile.name} onChange={e => setProfiles(list => list.map((p, i) => i === selected ? { ...p, name: e.target.value } : p))} /></label>
        <div className="touch-row"><button disabled={profiles.length >= 20} onClick={() => addProfile('empty', true)}>{t("Duplicate")}</button><button disabled={profiles.length <= 1} onClick={() => { setProfiles(profiles.filter((_, i) => i !== selected)); setSelected(0); setMarkId('') }}>{t("Delete profile")}</button></div>
        <details className="touch-hotkeys" open={hotkeysOpen} onToggle={e => setHotkeysOpen(e.currentTarget.open)}><summary>{t("Hotkeys")}</summary>
          <p>{t("Click an assignment, then press a key or combination. Saved with this profile. Escape cancels assignment and always releases the cursor.")}</p>
          {touchHotkeyActions.map(action => <div className="touch-hotkey" key={action}><span>{t(touchHotkeyLabels[action])}</span><button aria-label={t("Assign {0}", [t(touchHotkeyLabels[action])])} onClick={() => { setCapture(null); setHotkeyCapture(action); setError('') }}>{hotkeyCapture === action ? t("Press keys…") : hotkeyLabel(hotkeys[action])}</button><button aria-label={t("Clear {0}", [t(touchHotkeyLabels[action])])} onClick={() => assignHotkey(action, '')}>×</button></div>)}
        </details>
        <label>{t("New from template")}<select value="" disabled={profiles.length >= 20} onChange={e => { if (e.target.value) addProfile(e.target.value as TouchTemplate) }}><option value="">{t("Choose a template…")}</option><option value="shooter">{t("Shooter · WASD, aim, fire, jump")}</option><option value="racing">{t("Racing · steer, pedals, boost")}</option><option value="platformer">{t("Platformer · move, jump, action")}</option><option value="empty">{t("Empty layout")}</option></select></label>
        <div className="touch-row"><button disabled={profile.marks.length >= 8} onClick={() => addMark('button')}>{t("+ Button")}</button><button disabled={profile.marks.length >= 8 || profile.marks.some(m => m.kind === 'stick')} onClick={() => addMark('stick')}>{t("+ Stick")}</button><button disabled={profile.marks.length >= 8 || profile.marks.some(m => m.kind === 'look')} onClick={() => addMark('look')}>{t("+ Look")}</button></div>
        {selectedMark && <section className="touch-selection"><h3>{selectedMark.kind === 'button' ? t("Touch button") : selectedMark.kind === 'stick' ? t("Movement stick") : t("Look zone")}</h3>
          {selectedMark.bindings.map((key, slot) => <div className="touch-binding" key={slot}><span>{selectedMark.kind === 'stick' ? t(['Up', 'Left', 'Down', 'Right'][slot]) : slot ? t("Alternative") : t("Primary")}</span><button onClick={() => setCapture({ id: selectedMark.id, slot })}>{capture?.id === selectedMark.id && capture.slot === slot ? t("Press a key / button…") : key ? bindingLabel(key) : t("Assign…")}</button><button aria-label={t("Clear binding {0}", [slot + 1])} onClick={() => { const bindings = [...selectedMark.bindings]; bindings[slot] = ''; patch(selectedMark.id, { bindings }) }}>×</button></div>)}
          {selectedMark.kind !== 'button' && <><label>{t("Radius · ")}{Math.round(selectedMark.radius * 100)}%<input type="range" min=".01" max=".4" step=".005" value={selectedMark.radius} onChange={e => patch(selectedMark.id, { radius: Number(e.target.value) })} /></label><label className="touch-check"><input type="checkbox" checked={selectedMark.gamepad} onChange={e => patch(selectedMark.id, { gamepad: e.target.checked })} />{selectedMark.kind === 'stick' ? t("Use left gamepad stick") : t("Use right gamepad stick")}</label></>}
          {selectedMark.kind === 'look' && <label>{t("Sensitivity · ")}{selectedMark.sensitivity.toFixed(1)}<input type="range" min=".1" max="5" step=".1" value={selectedMark.sensitivity} onChange={e => patch(selectedMark.id, { sensitivity: Number(e.target.value) })} /></label>}
          <div className="touch-row">{(['x', 'y'] as const).map(axis => <label key={axis}>{axis.toUpperCase()} %<input type="number" min="0" max="100" step=".1" value={Math.round(selectedMark[axis] * 1000) / 10} onChange={e => patch(selectedMark.id, { [axis]: Math.max(0, Math.min(1, Number(e.target.value) / 100)) })} /></label>)}</div>
          <button className="danger" onClick={() => { setProfiles(list => list.map((p, i) => i === selected ? { ...p, marks: p.marks.filter(m => m.id !== selectedMark.id) } : p)); setMarkId(''); setCapture(null) }}>{t("Remove control")}</button>
        </section>}
      </fieldset>
      <footer><span>{message(saved)} · {t(orientation)}</span><small>{message(gamepad)}</small><small>{t("Templates are starting layouts. Adjust their positions for this game's on-screen controls.")}</small></footer>
    </aside>}
  </main>
}
