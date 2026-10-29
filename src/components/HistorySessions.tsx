import { locale as uiLocale } from '../lib/i18n'
import { t } from "../lib/i18n"
import { useEffect } from 'react'
import { CircleAlert, RefreshCw, X } from 'lucide-react'
import { historySessionLabel } from '../../electron/history-protocol'
import { useHistoryStore } from '../store/useHistoryStore'
import { useAppStore } from '../store/useAppStore'
import { useFilesStore } from '../store/useFilesStore'

export function HistorySessions({ view }: { view: 'activity' | 'files' }) {
  const h = useHistoryStore(), id = view === 'activity' ? h.activitySession : h.filesSession
  if (!h.overview) return null
  const session = id ? h.archives[id]?.session || h.overview.sessions.find(s => s.id === id) : h.overview.current
  return <div className="history-session-bar">
    <div><label>{t("Session ")}<select aria-label={t("{0} session", [view === 'activity' ? t("Activity") : t("File tasks")])} value={id || ''} onChange={e => void h.select(view, e.target.value || null)}>
      <option value="">{t("Current session · ")}{new Date(h.overview.current.startedAt).toLocaleString(uiLocale())}</option>
      {h.overview.sessions.map(s => <option key={s.id} value={s.id}>{historySessionLabel(s)}</option>)}
    </select></label><button className="text-button" aria-label={t("Refresh saved sessions")} onClick={() => void h.refresh()}><RefreshCw size={14} /></button>{view === 'activity' && id && !!h.archives[id]?.tasks.length && <button className="button secondary" onClick={() => { void h.select('files', id); useFilesStore.setState({ taskPanel: true }) }}>{t("Saved file tasks (")}{h.archives[id].tasks.length})</button>}</div>
    <small>{id ? t("Previous session · {0} · Read-only history", [session ? historySessionLabel(session) : t("Loading…")]) : t("Current session only · Previous sessions are kept separately")}</small>
    {id && session && <small>{t("Last saved: ")}{new Date(session.updatedAt).toLocaleString(uiLocale())}{session.endedAt && t(" · Closed: {0}", [new Date(session.endedAt).toLocaleString(uiLocale())])}</small>}
    {id && session?.status === 'interrupted' && <p className="warning-text">{t("This session did not close normally. Unfinished results need verification; nothing has been resumed.")}</p>}
    {(h.error || h.overview.error) && <p role="alert" className="file-error">{h.error || h.overview.error}</p>}
    {id && h.loading.includes(id) && <p role="status">{t("Loading saved session…")}</p>}
  </div>
}

export function HistoryRecoveryNotice() {
  const h = useHistoryStore()
  const sessions = h.overview?.sessions.filter(s => s.status === 'interrupted' && s.unfinished > 0) || []
  const first = sessions[0]
  useEffect(() => {
    if (!first || h.dismissedRecovery) return
    const timer = setTimeout(() => useHistoryStore.setState({ dismissedRecovery: true }), 15000)
    return () => clearTimeout(timer)
  }, [first?.id, h.dismissedRecovery])
  if (!first || h.dismissedRecovery) return null
  return <div className="history-recovery" role="status"><CircleAlert size={18} /><span>{t("Unfinished operations in a previous session.")}<small>{new Date(first.startedAt).toLocaleString(uiLocale())}</small></span>
    <button className="button secondary" onClick={() => { useHistoryStore.setState({ dismissedRecovery: true }); useAppStore.getState().setSection('activity'); void h.select('activity', first.id) }}>{t("View session")}</button>
    <button className="text-button" aria-label={t("Dismiss recovered session notice")} onClick={() => useHistoryStore.setState({ dismissedRecovery: true })}><X size={16} /></button></div>
}
