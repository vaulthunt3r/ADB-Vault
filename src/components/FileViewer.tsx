import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, ExternalLink, Image as ImageIcon, Maximize2, Minimize2, X } from 'lucide-react'
import type { FileEntry, FileLocation } from '../../electron/files-protocol'
import { previewType, type FilePreview } from '../../electron/file-preview-protocol'
import { filesRequest } from '../store/useFilesStore'
import { useConnectionStore } from '../store/useConnectionStore'
import { resolveFileReadLocation } from '../../electron/file-places'
import { useAppStore } from '../store/useAppStore'
import { IconButton } from './ui'

export interface ViewerSelection { source: FileLocation; entries: FileEntry[]; path: string }
function playbackError(media: HTMLMediaElement, kind: 'audio' | 'video') {
  switch (media.error?.code) {
    case 1: return `Playback was interrupted. Reopen the ${kind} to try again.`
    case 2: return `The ${kind} could not be read. Reopen the file to try again, or choose Open with…`
    case 3: return `The ${kind} could not be decoded. The file may be damaged or use an unsupported codec. Choose Open with…`
    case 4: return `The ${kind} could not be loaded. Its format may be unsupported. Try reopening it or choose Open with…`
    default: return `Playback failed. Reopen the ${kind} to try again, or choose Open with…`
  }
}
export function FileViewer({ selection, close }: { selection: ViewerSelection; close: () => void }) {
  const [index, setIndex] = useState(Math.max(0, selection.entries.findIndex(e => e.path === selection.path)))
  const [attempt, setAttempt] = useState(0), source = useRef(selection.source)
  const [minimized, setMinimized] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const [fullscreen, setFullscreen] = useState(false), [fullscreenError, setFullscreenError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null), media = useRef<HTMLAudioElement>(null), previousFocus = useRef<HTMLElement | null>(null), titleId = useId()
  const [preview, setPreview] = useState<FilePreview>(), [error, setError] = useState(''), [busy, setBusy] = useState(true), [actualSize, setActualSize] = useState(false)
  const entry = selection.entries[index], location = { ...selection.source, path: entry.path }
  const audio = previewType(entry.name)?.[0] === 'audio', inline = audio && minimized
  useLayoutEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null
    const element = dialog.current
    return () => { element?.close(); if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true }) }
  }, [])
  useLayoutEffect(() => {
    const element = dialog.current!
    // Keep the same media element/session when moving out of the modal layer.
    element.close()
    if (inline) { element.show(); if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true }) }
    else { element.showModal(); element.querySelector<HTMLButtonElement>('.file-viewer-close')?.focus({ preventScroll: true }) }
  }, [inline])
  useLayoutEffect(() => {
    const element = media.current
    return () => { element?.pause() }
  }, [preview, busy, error])
  useEffect(() => {
    if (inline) return
    const keyboard = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || (e.target as HTMLElement).matches('input,textarea,video,audio') || window.getSelection()?.toString()) return
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setIndex(i => Math.max(0, Math.min(selection.entries.length - 1, i + (e.key === 'ArrowLeft' ? -1 : 1)))) }
    }
    document.addEventListener('keydown', keyboard)
    return () => document.removeEventListener('keydown', keyboard)
  }, [selection.entries.length, inline])
  useEffect(() => {
    const requestId = crypto.randomUUID(); let live = true, started = false
    setBusy(true); setPreview(undefined); setError(''); setActualSize(false)
    if (!previewType(entry.name)) { setBusy(false); return }
    const timer = setTimeout(() => { void Promise.resolve().then(() => {
      const resolved = resolveFileReadLocation({ ...source.current, path: entry.path }, useConnectionStore.getState().devices)
      source.current = resolved; started = true
      return filesRequest({ type: 'files.preview', location: resolved, fingerprint: entry.fingerprint, requestId })
    }).then(r => {
      if (live) { setPreview(r.filePreview); if (!r.filePreview) setError("Preview unavailable. Choose Open with…") }
    }).catch(e => { if (live) { const message = e instanceof Error ? e.message : String(e); setError(message.includes('phone connection changed') ? "The phone connection changed while opening this file. Retry preview to read it again from the same phone." : message) } }).finally(() => { if (live) setBusy(false) }) }, 0)
    return () => { live = false; clearTimeout(timer); if (started) void filesRequest({ type: 'files.preview.close', requestId }).catch(() => {}) }
  }, [entry.path, attempt])
  useEffect(() => {
    const element = dialog.current
    const changed = () => { setFullscreen(!!document.fullscreenElement); setFullscreenError('') }
    document.addEventListener('fullscreenchange', changed)
    return () => { document.removeEventListener('fullscreenchange', changed); if (document.fullscreenElement && element?.contains(document.fullscreenElement)) void document.exitFullscreen().catch(() => {}) }
  }, [])
  async function toggleFullscreen() {
    setFullscreenError('')
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await video.current?.requestFullscreen() }
    catch { setFullscreenError("Could not enter fullscreen. Try the player’s fullscreen button or reopen the video.") }
  }
  const change = (delta: number) => setIndex(i => Math.max(0, Math.min(selection.entries.length - 1, i + delta)))
  async function external(withApp: boolean) {
    try { const resolved = resolveFileReadLocation({ ...source.current, path: entry.path }, useConnectionStore.getState().devices); source.current = resolved; const reply = await filesRequest({ type: 'files.open', location: resolved, withApp }); if (reply.notice) useAppStore.getState().notify(reply.notice) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  return <dialog ref={dialog} aria-labelledby={titleId} aria-modal={inline ? undefined : true} className={`locate-dialog app-badge-dialog file-viewer${audio ? " file-viewer-audio" : ''}${inline ? " file-viewer-mini" : ''}`} onCancel={e => { e.preventDefault(); if (document.fullscreenElement) void document.exitFullscreen(); else close() }}>
    <header className="file-viewer-heading">
      <h2 id={titleId} title={entry.name}>{entry.name}</h2>
      {audio && <div className="file-viewer-window-actions"><IconButton label={inline ? "Expand audio player" : "Minimize audio player"} onClick={() => setMinimized(!inline)}>{inline ? <Maximize2 size={16} /> : <Minimize2 size={16} />}</IconButton>{inline && <IconButton label="Close audio player" onClick={close}><X size={16} /></IconButton>}</div>}
    </header>
    <div className="app-badge-dialog-content">
      <div className="file-viewer-toolbar"><IconButton label="Previous file" disabled={index === 0} onClick={() => change(-1)}><ChevronLeft size={18} /></IconButton><span>{index + 1} / {selection.entries.length}</span><IconButton label="Next file" disabled={index === selection.entries.length - 1} onClick={() => change(1)}><ChevronRight size={18} /></IconButton><small title={entry.path}>{entry.path}</small>{preview?.kind === 'video' && !busy && !error && <IconButton label={fullscreen ? "Exit video fullscreen" : "Video fullscreen"} onClick={() => void toggleFullscreen()}><Maximize2 size={16} /></IconButton>}{preview?.kind === 'image' && <button className="button secondary" aria-pressed={actualSize} onClick={() => setActualSize(!actualSize)}>{actualSize ? "Fit to window" : "Actual size"}</button>}</div>
      <div className={`file-viewer-content${actualSize ? " actual-size" : ''}`} tabIndex={0}>
        {busy ? <p role="status">{location.kind === 'device' ? "Downloading the complete file to a temporary folder before playback or preview…" : "Opening file…"}</p> : error ? <div className="file-viewer-error"><p role="alert" className="file-error">{error}</p>{inline && <button className="button secondary" onClick={() => setAttempt(n => n + 1)}>Retry preview</button>}</div> : preview?.kind === 'image' ? <img src={preview.url} alt={entry.name} onError={() => setError("This image could not be decoded. Choose Open with…")} /> : preview?.kind === 'video' ? <video ref={video} aria-label={`Video: ${entry.name}`} key={entry.path} src={preview.url} controls onError={e => setError(playbackError(e.currentTarget, 'video'))} /> : preview?.kind === 'audio' ? <audio ref={media} key={entry.path} src={preview.url} controls autoPlay aria-label={`Audio: ${entry.name}`} onError={e => setError(playbackError(e.currentTarget, 'audio'))} /> : preview?.kind === 'text' ? <pre>{preview.text}</pre> : <div className="file-empty"><ImageIcon size={36} /><p>No built-in viewer for this format.</p><button className="button secondary" onClick={() => void external(true)}>Open with…</button></div>}
      </div>
    </div>
    {fullscreenError && <p role="alert" className="file-error">{fullscreenError}</p>}
    <div className="dialog-footer">{error && <button className="button secondary" disabled={busy} onClick={() => setAttempt(n => n + 1)}>Retry preview</button>}<button className="button secondary" onClick={() => void external(false)}><ExternalLink size={14} />External viewer</button><button className="button secondary" onClick={() => void external(true)}>Open with…</button><button className="button secondary file-viewer-close" onClick={close}>Close</button></div>
  </dialog>
}
