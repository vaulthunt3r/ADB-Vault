import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowRight, BookOpen, Check, X } from 'lucide-react'
import { useTourStore } from '../store/useTourStore'
import './interface-tour.css'

const topics = [
  { title: 'Your workspace', target: '#main-sidebar', text: 'The left sidebar opens each workspace. The top toolbar follows the current workspace, and the right panel contains details and actions.', hint: 'This tour points out controls without switching workspaces, connecting to a device or running operations.' },
  { title: 'Components', target: '[data-tour="components"]', text: 'Start here to find tools already on your PC or download missing components. ADB and Fastboot come together; scrcpy adds screen, camera and audio features.', hint: 'Google USB drivers and Visual C++ are optional system components. Install them only when needed.' },
  { title: 'Connection', target: '[data-tour="connection"]', text: 'Connect a phone over USB or Wi-Fi, choose the active device and manage known connections. Enable USB debugging on the phone and accept its authorization prompt.', hint: 'The selected phone is shared across workspaces. Some features also depend on the selected Android user profile.' },
  { title: 'Apps and APK files', target: '[data-tour="apps"]', text: 'Search installed apps, paste a list of package IDs, inspect badges and components, and export APKs or backups. Local APK inspection also works without a connected phone.', hint: 'Personal notes follow the package across phones. Available actions include disabling, freezing and restoring supported removed system packages.' },
  { title: 'Details and actions', target: '#context-sidebar', text: 'Select an item to see its details on the right. Switch to Actions for operations available for that item and device.', hint: 'Badges describe what was detected. Their legends explain the meaning and limits of each result; a bloatware label is not an instruction to delete an app.' },
  { title: 'Screen, camera and input', target: '.topbar', text: 'Open Connection → Actions → Screen & recording for the phone screen, a virtual app window or a camera. You can also launch a virtual display from an app’s Actions.', hint: 'Window controls provide Typing with the PC layout and optional game controls. Touch mappings, presets and hotkeys can be edited; screen windows can stay on top.' },
  { title: 'Files', target: '[data-tour="files"]', text: 'Browse the PC and connected phone, transfer files, search folders and preview supported media. The two panels can show different sources.', hint: 'Operation progress remains available while you browse. Review the destination before copying, moving or deleting files.' },
  { title: 'Monitor', target: '[data-tour="monitor"]', text: 'Inspect available device, battery, memory and network information from the connected phone.', hint: 'What Android exposes varies by device, firmware and permissions. Unavailable readings are shown as unavailable.' },
  { title: 'Console', target: '[data-tour="console"]', text: 'Use the ADB console or Android shell for commands on the selected device. Output and command status stay visible in the workspace.', hint: 'This is the advanced workspace: commands run against your selected phone.' },
  { title: 'Activity', target: '[data-tour="activity"]', text: 'Follow current operations and review their results, failures and diagnostic details. Progress can also remain visible in the top toolbar while you use another workspace.', hint: 'Open an operation to see its details and available controls.' },
  { title: 'Make it yours', target: '[data-tour="settings"]', text: 'Settings contains themes, density, corners, workspace order, badges, search websites, notifications and screen defaults.', hint: 'You can replay this tour at any time using the question-mark button in the title bar. Your current workspace and preferences stay unchanged.' },
] as const

export function TourWelcome() {
  const { welcome, start, dismiss } = useTourStore()
  if (!welcome) return null
  return <aside className="tour-welcome" aria-label="Welcome to ADB Vault"><BookOpen size={23} aria-hidden="true" /><div><strong>Welcome to ADB Vault</strong><p>Take a quick tour of the interface and what you can do with it.</p></div><button className="button secondary" onClick={dismiss}>Not now</button><button className="button primary" onClick={start}>Start tour</button></aside>
}

function TourSession() {
  const close = useTourStore(state => state.close)
  const [step, setStep] = useState(0)
  const dialog = useRef<HTMLDialogElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const origin = useRef(document.activeElement as HTMLElement | null)
  const [placement, setPlacement] = useState({ x: 240, y: 100, left: 12, top: 50, width: 180, height: 300, found: true })
  const topic = topics[step]
  useEffect(() => {
    const node = dialog.current!
    node.showModal()
    return () => {
      node.close()
      const previous = origin.current?.isConnected ? origin.current : document.querySelector<HTMLElement>('[data-tour="help"]')
      previous?.focus({ preventScroll: true })
    }
  }, [])
  useLayoutEffect(() => {
    const target = document.querySelector<HTMLElement>(topic.target)
    const position = () => {
      const box = target?.getBoundingClientRect()
      const found = !!box && box.width > 0 && box.height > 0
      const width = Math.min(390, window.innerWidth - 32)
      const height = card.current?.getBoundingClientRect().height || 330
      const x = found ? Math.min(box!.right + 18, window.innerWidth - width - 16) : (window.innerWidth - width) / 2
      const y = found ? Math.min(Math.max(56, box!.top), window.innerHeight - height - 16) : (window.innerHeight - height) / 2
      setPlacement({ x: Math.max(16, x), y: Math.max(16, y), left: (box?.left ?? 0) - 4, top: (box?.top ?? 0) - 4, width: (box?.width ?? 0) + 8, height: (box?.height ?? 0) + 8, found })
    }
    position()
    const observer = new ResizeObserver(position)
    if (target) observer.observe(target)
    if (card.current) observer.observe(card.current)
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    return () => { observer.disconnect(); window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true) }
  }, [topic])
  return createPortal(<dialog ref={dialog} className="interface-tour" aria-labelledby="interface-tour-title" onCancel={event => { event.preventDefault(); close() }} onKeyDown={event => {
    if (event.key !== 'Tab') return
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), select')]
    const first = controls[0], last = controls.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }}>
    {placement.found ? <div className="tour-spotlight" aria-hidden="true" style={{ left: placement.left, top: placement.top, width: placement.width, height: placement.height }} /> : <div className="tour-shade" aria-hidden="true" />}
    <div ref={card} className="tour-card" style={{ left: placement.x, top: placement.y }}>
      <div className="tour-heading"><span className="eyebrow">QUICK TOUR · {step + 1} / {topics.length}</span><button className="icon-button" aria-label="Close tour" title="Close tour" onClick={close}><X size={17} /></button></div>
      <h2 id="interface-tour-title">{topic.title}</h2>
      <p>{topic.text}</p><p className="tour-hint">{topic.hint}</p>
      {!placement.found && <p className="tour-hint">This area is hidden in your current layout. The tour keeps your layout unchanged.</p>}
      <label className="tour-topics">Jump to a topic<select value={step} onChange={event => setStep(Number(event.target.value))}>{topics.map((item, index) => <option value={index} key={item.title}>{index + 1}. {item.title}</option>)}</select></label>
      <div className="tour-controls"><button className="button secondary" onClick={close}>Skip tour</button><div><button className="button secondary" disabled={step === 0} onClick={() => setStep(value => value - 1)}><ArrowLeft size={15} />Back</button><button className="button primary" onClick={() => step === topics.length - 1 ? close() : setStep(value => value + 1)}>{step === topics.length - 1 ? <>Done<Check size={15} /></> : <>Next<ArrowRight size={15} /></>}</button></div></div>
    </div>
  </dialog>, document.body)
}

export function InterfaceTour() {
  const open = useTourStore(state => state.open)
  return open ? <TourSession /> : null
}
