import { message } from "../lib/i18n"
import { t } from "../lib/i18n"
import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { IconButton } from './ui'

export interface ActionPrompt { title: string; description: string; label?: string; initialValue?: string; confirm: string; action: (value: string) => Promise<boolean> }
export function ActionDialog({ prompt, close }: { prompt: ActionPrompt | null; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!prompt) return
    const previous = document.activeElement as HTMLElement | null
    setValue(prompt.initialValue ?? ''); setError(''); setBusy(false); dialog.current?.showModal()
    return () => { dialog.current?.close(); previous?.focus() }
  }, [prompt])
  return <dialog ref={dialog} className="locate-dialog" aria-labelledby="action-title" onCancel={event => { if (busy) event.preventDefault(); else close() }}><form onSubmit={async event => {
    event.preventDefault()
    if (!prompt || busy) return
    setBusy(true); setError('')
    try { if (await prompt.action(value)) close(); else setError("The action was not completed. Check the name, demo result, or device connection, then try again.") }
    finally { setBusy(false) }
  }}><div className="dialog-heading"><span className="eyebrow">{t("SIMULATED ACTION")}</span><IconButton label={t("Close action dialog")} disabled={busy} onClick={close}><X size={16} /></IconButton></div><h2 id="action-title">{prompt?.title}</h2><p>{message(prompt?.description)}</p>{prompt?.label && <><label htmlFor="action-value">{prompt.label}</label><div className="path-input-row"><input id="action-value" autoFocus value={value} maxLength={128} disabled={busy} onChange={event => setValue(event.target.value)} required /></div></>}{error && <p className="field-error" role="alert">{message(error)}</p>}<div className="dialog-footer action-dialog-footer"><button type="button" className="button secondary" disabled={busy} onClick={close}>{t("Cancel")}</button><button type="submit" className="button primary" disabled={busy || !!prompt?.label && !value.trim()}>{busy ? t("Working…") : prompt?.confirm}</button></div></form></dialog>
}
