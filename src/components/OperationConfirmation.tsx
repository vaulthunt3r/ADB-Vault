import { useEffect, useRef, useState } from 'react'
import { AppWindow, ArrowDownToLine, CircleAlert, Eraser, ExternalLink, Power, ShieldAlert, Square, Trash2, X } from 'lucide-react'
import type { ConfirmationPrompt } from '../../electron/confirmation-protocol'
import { useConfirmationStore } from '../store/useConfirmationStore'
import { requestBackend } from '../lib/backend'
import './operation-confirmation.css'

export function OperationConfirmation() {
  const prompt = useConfirmationStore(s => s.prompt)
  return prompt ? <Confirmation key={prompt.id} prompt={prompt} /> : null
}
function Confirmation({ prompt }: { prompt: ConfirmationPrompt }) {
  const ref = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const answering = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null, dialog = ref.current
    dialog?.showModal(); cancelRef.current?.focus({ preventScroll: true })
    return () => { dialog?.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  async function answer(accepted: boolean) {
    if (answering.current) return
    answering.current = true; setBusy(true); setError('')
    const ok = await requestBackend({ type: 'confirmation.answer', id: prompt.id, accepted }, setError)
    if (!ok) { answering.current = false; setBusy(false) }
  }
  const Icon = /uninstall/i.test(prompt.title) ? Trash2 : /clear|delete/i.test(prompt.title) ? Eraser : /disable|enable/i.test(prompt.title) ? Power : /stop/i.test(prompt.title) ? Square : /open/i.test(prompt.title) ? ExternalLink : ArrowDownToLine
  return <dialog ref={ref} className="operation-confirmation" data-tone={prompt.tone} aria-labelledby="operation-confirmation-title" aria-describedby="operation-confirmation-description" onCancel={event => { event.preventDefault(); void answer(false) }} onKeyDown={event => {
    if (event.key !== 'Tab') return
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), summary, [tabindex="0"]')].filter(el => el.getClientRects().length)
    const first = controls[0], last = controls.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }}>
    <header className="confirmation-header">
      <span className="confirmation-symbol"><Icon size={23} strokeWidth={1.7} /></span>
      <div><h2 id="operation-confirmation-title">{prompt.title}</h2><p id="operation-confirmation-description">{prompt.description}</p></div>
      <button className="confirmation-close" aria-label="Cancel action" disabled={busy} onClick={() => void answer(false)}><X size={18} /></button>
    </header>
    <div className="confirmation-body">
      {!!prompt.context?.length && <dl className="confirmation-context">{prompt.context.map(c => <div key={c.label}><dt>{c.label}</dt><dd>{c.value}</dd></div>)}</dl>}
      {!!prompt.applications?.length && <section className="confirmation-targets" aria-label="Selected applications">
        {prompt.applications.length > 1 && <div className="confirmation-selection"><strong>{prompt.applications.length}{" applications"}</strong>{prompt.selection && <span>{prompt.selection.affected}{" will run"}{prompt.selection.skipped ? ` · ${prompt.selection.skipped} skipped` : ''}</span>}</div>}
        <ul tabIndex={prompt.applications.length > 3 ? 0 : undefined} aria-label="Applications">{prompt.applications.map(a => <li key={a.packageName} data-skipped={a.skipped || undefined}>
          <span className="confirmation-app-icon">{a.iconPng ? <img alt="" src={`data:image/png;base64,${a.iconPng}`} /> : <AppWindow size={24} strokeWidth={1.5} />}</span>
          <div className="confirmation-app-name"><strong>{a.label}</strong><span>{a.packageName}</span>{a.note && <small>{a.note}</small>}</div>
          {a.system && <span className="confirmation-app-tag">System</span>}
        </li>)}</ul>
      </section>}
      <section className="confirmation-effects"><h3>What will happen</h3><ul>{prompt.effects.map(effect => <li key={effect}>{effect}</li>)}</ul></section>
      {!!prompt.warnings?.length && <aside className="confirmation-warning"><ShieldAlert size={18} /><div>{prompt.warnings.map(w => <p key={w}>{w}</p>)}</div></aside>}
      {!!prompt.details?.length && <details className="confirmation-details"><summary>Additional details</summary>{prompt.details.map(d => <p key={d}>{d}</p>)}</details>}
      {prompt.termsUrl && <button className="confirmation-terms" onClick={() => void requestBackend({ type: 'web.open', url: prompt.termsUrl! })}>View license terms ↗</button>}
      {error && <p className="confirmation-error" role="alert"><CircleAlert size={16} />{error}</p>}
    </div>
    <footer className="confirmation-footer"><button ref={cancelRef} className="button secondary" disabled={busy} onClick={() => void answer(false)}>Cancel</button><button className="button confirmation-submit" disabled={busy} onClick={() => void answer(true)}>{prompt.confirmLabel}</button></footer>
  </dialog>
}
