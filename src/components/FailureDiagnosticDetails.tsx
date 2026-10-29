import { t as translateUi } from '../lib/i18n'
import { message } from "../lib/i18n"
import { t } from "../lib/i18n"
import { useEffect, useState } from 'react'
import type { FailureDiagnostic, FailureDiagnosticReport } from '../../electron/failure-diagnostics-protocol'

export function FailureDiagnosticDetails({ diagnostic }: { diagnostic: FailureDiagnostic }) {
  const [expanded, setExpanded] = useState(false)
  const [report, setReport] = useState<FailureDiagnosticReport | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!expanded || !diagnostic.saved) return
    let active = true
    setReport(null); setError('')
    void (async () => {
      try {
        if (!window.desktop) throw new Error(translateUi("Diagnostic reports are available in the desktop application."))
        const reply = await window.desktop.request({ type: 'diagnostics.read', id: diagnostic.id })
        if (!reply.ok) throw new Error(reply.error)
        if (!reply.diagnosticReport) throw new Error(translateUi("The diagnostic report is unavailable."))
        if (active) setReport(reply.diagnosticReport)
      } catch (failure) { if (active) setError(failure instanceof Error ? failure.message : String(failure)) }
    })()
    return () => { active = false }
  }, [expanded, diagnostic.id, diagnostic.updatedAt, diagnostic.saved])
  return <section className="failure-diagnostic" aria-label={t("Failure diagnostics")}>
    <p>{diagnostic.cause}</p>
    {diagnostic.packageName && <p><strong>{diagnostic.appLabel || diagnostic.packageName}</strong><code>{diagnostic.packageName}</code></p>}
    <p><strong>{t("Stage")}</strong><br />{diagnostic.stage}</p>
    <p className="component-description">{diagnostic.saved ? t("Diagnostics saved automatically. Save a copy from Actions → Save diagnostics…") : t("Diagnostics could not be saved: {0}", [diagnostic.saveError || t("Storage unavailable.")])}</p>
    {diagnostic.saved && diagnostic.saveError && <p role="alert">{t("The initial report is available, but could not be updated: ")}{diagnostic.saveError}</p>}
    <details onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary>{t("Technical details")}</summary>
      {expanded && !diagnostic.saved ? <p role="alert">{diagnostic.saveError}</p> : error ? <p role="alert">{message(error)}</p> : !report ? <p role="status">{t("Loading diagnostics…")}</p> : <div className="diagnostic-technical">
        <p>{report.environment.platform} · {report.environment.arch}{t(" · Zstd ")}{report.environment.zstd ? t("on") : t("off")}</p>
        <strong>{t("Recorded commands")}</strong>
        {report.commands.map((command, index) => <pre key={index}>{[command.startedAt, command.stage, [command.executable, ...command.args].join(' '), command.code !== undefined ? translateUi("Exit code: {0}", [command.code]) : t("Exit code unavailable"), command.error, command.stderr, command.stdout].filter(Boolean).join('\n')}</pre>)}
        <strong>{t("Connection and ADB processes")}</strong><pre>{JSON.stringify(report.observations, null, 2)}</pre>
        <strong>{t("ADB log excerpt")}</strong><pre>{report.adbLog.tail || report.adbLog.error || t("Unavailable")}</pre>
      </div>}
    </details>
  </section>
}
