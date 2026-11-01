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
        if (!window.desktop) throw new Error("Diagnostic reports are available in the desktop application.")
        const reply = await window.desktop.request({ type: 'diagnostics.read', id: diagnostic.id })
        if (!reply.ok) throw new Error(reply.error)
        if (!reply.diagnosticReport) throw new Error("The diagnostic report is unavailable.")
        if (active) setReport(reply.diagnosticReport)
      } catch (failure) { if (active) setError(failure instanceof Error ? failure.message : String(failure)) }
    })()
    return () => { active = false }
  }, [expanded, diagnostic.id, diagnostic.updatedAt, diagnostic.saved])
  return <section className="failure-diagnostic" aria-label="Failure diagnostics">
    <p>{diagnostic.cause}</p>
    {diagnostic.packageName && <p><strong>{diagnostic.appLabel || diagnostic.packageName}</strong><code>{diagnostic.packageName}</code></p>}
    <p><strong>Stage</strong><br />{diagnostic.stage}</p>
    <p className="component-description">{diagnostic.saved ? "Diagnostics saved automatically. Save a copy from Actions → Save diagnostics…" : `Diagnostics could not be saved: ${diagnostic.saveError || "Storage unavailable."}`}</p>
    {diagnostic.saved && diagnostic.saveError && <p role="alert">{"The initial report is available, but could not be updated: "}{diagnostic.saveError}</p>}
    <details onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary>Technical details</summary>
      {expanded && !diagnostic.saved ? <p role="alert">{diagnostic.saveError}</p> : error ? <p role="alert">{error}</p> : !report ? <p role="status">Loading diagnostics…</p> : <div className="diagnostic-technical">
        <p>{report.environment.platform} · {report.environment.arch}{" · Zstd "}{report.environment.zstd ? "on" : "off"}</p>
        <strong>Recorded commands</strong>
        {report.commands.map((command, index) => <pre key={index}>{[command.startedAt, command.stage, [command.executable, ...command.args].join(' '), command.code !== undefined ? `Exit code: ${command.code}` : "Exit code unavailable", command.error, command.stderr, command.stdout].filter(Boolean).join('\n')}</pre>)}
        <strong>Connection and ADB processes</strong><pre>{JSON.stringify(report.observations, null, 2)}</pre>
        <strong>ADB log excerpt</strong><pre>{report.adbLog.tail || report.adbLog.error || "Unavailable"}</pre>
      </div>}
    </details>
  </section>
}
