import { locale as uiLocale } from '../lib/i18n'
import { message } from "../lib/i18n"
import { t } from "../lib/i18n"
import { ActionIndicator } from './ui'
import { HintButton } from './Tooltip'
import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, RefreshCw, RotateCw, Usb } from 'lucide-react'
import { fastbootFields, fastbootModes, fastbootModeLabels, type FastbootDevice, type FastbootMode } from '../../electron/fastboot-protocol'
import { useFastbootStore } from '../store/useFastbootStore'
import { useAppStore } from '../store/useAppStore'
import { requestBackend } from '../lib/backend'
import { usePowerBlocked } from './DevicePowerActions'

export function FastbootInspector() {
  const state = useFastbootStore(), tab = useAppStore(s => s.inspectorTab)
  const device = state.devices.find(d => d.serial === state.selectedSerial)
  const blocked = usePowerBlocked(false)
  const [dialog, setDialog] = useState<FastbootDevice | null>(null)
  return <>
    <div className="inspector-section-label"><span className="eyebrow">{t("FASTBOOT ")}{tab === 'details' ? t("DETAILS") : t("ACTIONS")}</span></div>
    <div className="section-inspector-icon"><Usb size={25} /></div>
    <h2 className="section-inspector-title">{device?.fields.product || state.selectedSerial}</h2>
    <p className="component-description">{device ? t("Detected over USB at the last search. Fastboot is separate from Android ADB.") : t("This Fastboot selection is no longer available. Search again, or select an ADB device after Android starts.")}</p>
    {device && (tab === 'details' ? <>
      <dl className="metadata"><div><dt>{t("Serial")}</dt><dd>{device.serial}</dd></div>{Object.entries(fastbootFields).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{device.fields[key as keyof typeof fastbootFields] || t("Unavailable")}</dd></div>)}</dl>
      {state.busy && <p role="status">{t("Reading Fastboot information…")}</p>}
      {device.inspectedAt && <p className="component-description">{t("Read ")}{new Date(device.inspectedAt).toLocaleString(uiLocale())}</p>}
      {!!device.issues.length && <details><summary>{t("Unavailable fields (")}{device.issues.length})</summary>{device.issues.map(issue => <p className="component-description" key={issue}>{issue}</p>)}</details>}
    </> : <div className="recovery-actions"><HintButton hint={t("Choose Android, Bootloader, Recovery or Fastbootd, then confirm the restart from Fastboot.")} className="button secondary" disabled={blocked} onClick={() => setDialog(structuredClone(device))}><RotateCw size={14} />{t("Restart")}<ActionIndicator /></HintButton><HintButton hint={t("Read available Fastboot properties again for this USB device.")} className="button secondary" disabled={blocked} onClick={() => void requestBackend({ type: 'connection.fastboot.inspect', serial: device.serial, token: device.token })}><RefreshCw size={14} />{t("Refresh Fastboot information")}</HintButton></div>)}
    {state.error && <p className="field-error" role="alert">{message(state.error)}</p>}
    {dialog && <FastbootRestartDialog device={dialog} close={() => setDialog(null)} />}
  </>
}

function FastbootRestartDialog({ device, close }: { device: FastbootDevice; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null), cancel = useRef<HTMLButtonElement>(null), submitting = useRef(false)
  const [mode, setMode] = useState<FastbootMode>('android'), [pending, setPending] = useState(false), [error, setError] = useState('')
  const available = useFastbootStore(s => s.devices.some(d => d.serial === device.serial && d.token === device.token))
  const blocked = usePowerBlocked(false)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const dialog = ref.current; dialog?.showModal(); cancel.current?.focus()
    return () => { dialog?.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  return <dialog ref={ref} className="locate-dialog" aria-labelledby="fastboot-restart-title" onCancel={event => { event.preventDefault(); if (!submitting.current) close() }}><form onSubmit={async event => {
    event.preventDefault()
    if (submitting.current || blocked || !available) return
    submitting.current = true; setPending(true); setError('')
    try { if (await requestBackend({ type: 'connection.fastboot.reboot', serial: device.serial, token: device.token, mode, confirmed: true }, setError)) close() }
    finally { submitting.current = false; setPending(false) }
  }}>
    <h2 id="fastboot-restart-title">{t("Restart from Fastboot")}</h2><p><strong>{device.fields.product || device.serial}</strong><br />{t("USB · ")}{device.serial}</p>
    <fieldset className="device-power-options" disabled={pending}><legend>{t("Restart to")}</legend>{fastbootModes.map(value => <label key={value}><input type="radio" name="fastboot-mode" checked={mode === value} onChange={() => setMode(value)} />{fastbootModeLabels[value]}</label>)}</fieldset>
    <p>{mode === 'android' ? t("The phone will leave Fastboot and start Android. Wait for startup, then unlock it and reconnect ADB if needed.") : t("The phone will restart into {0}. Support depends on the phone. If unavailable, use its hardware buttons to return to Android.", [fastbootModeLabels[mode]])}</p>
    {!available && !pending && <p className="field-error">{t("The Fastboot selection changed. Close this dialog and search again.")}</p>}
    {error && <p className="field-error" role="alert">{message(error)}</p>}
    <div className="dialog-footer"><button ref={cancel} type="button" className="button secondary" disabled={pending} onClick={close}>{t("Cancel")}</button><button type="submit" className="button primary" disabled={pending || blocked || !available}>{pending && <LoaderCircle size={14} className="spin" />}{pending ? t("Sending command…") : t("Restart phone")}</button></div>
  </form></dialog>
}
