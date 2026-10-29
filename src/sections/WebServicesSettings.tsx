import { message } from "../lib/i18n"
import { t } from "../lib/i18n"
import { useState } from 'react'
import { GripVertical, Plus, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { useWebServicesStore } from '../store/useWebServicesStore'
import { defaultWebServices, webServiceUrl, type WebService } from '../../electron/web-services'
export function WebServicesSettings() {
  const { services, toggle, remove, reset, save, move, moveTo } = useWebServicesStore()
  const [editing, setEditing] = useState<WebService | null>(null), [error, setError] = useState('')
  const [dragged, setDragged] = useState<WebService | null>(null), [dropTarget, setDropTarget] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const endDrag = () => { setDragged(null); setDropTarget(null) }
  const announce = (service: WebService) => {
    const group = useWebServicesStore.getState().services.filter(item => item.kind === service.kind)
    setAnnouncement(`${service.name}: position ${group.findIndex(item => item.id === service.id) + 1} of ${group.length}.`)
  }
  const edit = (service: WebService) => { setEditing({ ...service }); setError('') }
  let preview = ''
  if (editing) { try { preview = webServiceUrl(editing, { label: t("Example App"), packageName: 'org.example.app' }, 'package') } catch { /* Form shows validation on save. */ } }
  return <section className="section-content web-services-settings" aria-labelledby="web-services-heading">
    <div className="section-heading"><div><div className="eyebrow section-eyebrow">{t("SETTINGS / WEB SERVICES")}</div><h1 id="web-services-heading">{t("Search & scanners")}</h1><p>{t("Choose the services shown in Find online for an application.")}</p></div><button className="button secondary" disabled={!!editing || services.length >= 100} onClick={() => edit({ id: crypto.randomUUID(), name: '', kind: 'search', url: 'https://', enabled: true })}><Plus size={15} />{t("Add service")}</button></div>
    {editing && <form className="web-service-editor" onSubmit={e => { e.preventDefault(); try { save(editing); setEditing(null); setError('') } catch (e) { setError(e instanceof Error ? e.message : String(e)) } }}>
      <h2>{services.some(s => s.id === editing.id) ? t("Edit service") : t("New service")}</h2>
      <div className="web-service-fields"><label>{t("Name")}<input autoFocus required maxLength={80} value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></label><label>{t("Category")}<select value={editing.kind} onChange={e => setEditing({ ...editing, kind: e.target.value as WebService['kind'] })}><option value="search">{t("Search")}</option><option value="scanner">{t("Scanner")}</option></select></label></div>
      <label>{t("HTTPS URL template")}<input required maxLength={2048} value={editing.url} onChange={e => setEditing({ ...editing, url: e.target.value })} /></label>
      <p className="apps-settings-note"><code>{t("{query}")}</code>{t(" — chosen search text; ")}<code>{t("{name}")}</code>{t(" — app name; ")}<code>{t("{package}")}</code>{t(" — package name. A scanner can use a plain upload-page URL.")}</p>
      {preview && <div className="web-service-preview"><span>{t("Example URL")}</span><code>{preview}</code></div>}
      {error && <p className="operation-error" role="alert">{message(error)}</p>}
      <div className="web-service-editor-actions"><button className="button secondary" type="button" onClick={() => setEditing(null)}>{t("Cancel")}</button><button className="button primary" type="submit">{t("Save service")}</button></div>
    </form>}
    <p className="apps-settings-note">{t("Drag a handle to reorder services within each category. With keyboard: focus a handle and press ↑ or ↓. Find online uses the same order.")}</p>
    {(['search', 'scanner'] as const).map(kind => <section key={kind} aria-label={kind === 'search' ? t("Search websites") : t("File scanners")}>
      <h2>{kind === 'search' ? t("Search websites") : t("File scanners")}</h2>
      <div className="web-services-list" onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null) }}>{services.filter(s => s.kind === kind).map(s => <div className={`web-service-row ${s.enabled ? '' : 'disabled'}${dragged?.id === s.id ? " dragging" : ''}${dropTarget === s.id && dragged?.id !== s.id ? " drop-target" : ''}`} key={s.id}
        onDragOver={event => { if (dragged?.kind === kind && !editing) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(s.id) } else setDropTarget(null) }}
        onDrop={event => { if (dragged?.kind === kind && !editing) { event.preventDefault(); moveTo(dragged.id, s.id); announce(dragged) }; endDrag() }}>
        <button className="icon-button web-service-grip" title={t("Drag to reorder; arrow keys move up/down")} aria-label={t("Reorder {0}", [s.name])} disabled={!!editing} draggable={!editing}
          onDragStart={event => { if (editing) { event.preventDefault(); return }; setDragged(s); event.dataTransfer.setData('text/plain', s.id); event.dataTransfer.effectAllowed = 'move' }}
          onDragEnd={endDrag}
          onKeyDown={event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); move(s.id, event.key === 'ArrowUp' ? -1 : 1); announce(s) } }}><GripVertical size={15} /></button>
        <label><input type="checkbox" aria-label={t("Enable {0}", [s.name])} checked={s.enabled} onChange={() => toggle(s.id)} /><strong>{s.name}</strong></label>
        <div className="web-service-url"><code title={s.url}>{s.url}</code>{s.note && <small>{t(s.note)}</small>}</div>
        <button className="icon-button" aria-label={t("Edit {0}", [s.name])} disabled={!!editing} onClick={() => edit(s)}><Pencil size={14} /></button>
        {defaultWebServices.some(d => d.id === s.id) ? <button className="icon-button" title={t("Restore this service's default URL and enable it")} aria-label={t("Reset {0}", [s.name])} disabled={!!editing} onClick={() => reset(s.id)}><RotateCcw size={14} /></button> : <button className="icon-button" aria-label={t("Delete {0}", [s.name])} disabled={!!editing} onClick={() => remove(s.id)}><Trash2 size={14} /></button>}
      </div>)}</div>
    </section>)}
    <span className="visually-hidden" role="status">{announcement}</span>
    <p className="apps-settings-note">{t("Changes are saved automatically. Links open in your browser. Scanner files are prepared locally; you choose and submit them on the website.")}</p>
  </section>
}
