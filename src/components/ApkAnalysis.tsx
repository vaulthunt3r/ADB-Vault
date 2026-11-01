import { useState } from 'react'
import type { ApkAnalysis as Analysis, ScanMatch } from '../../electron/database-protocol'
import { BadgeDialog } from './BadgeDialog'
import { ApkAddresses } from './ApkAddresses'
import { ApkComposition } from './ApkComposition'

function Matches({ title, matches, open }: { title: string; matches: ScanMatch[]; open: (match: ScanMatch) => void }) {
  return <div className="apk-analysis-results"><h3>{title} <span>{matches.length}</span></h3>{matches.length ? <div className="apk-analysis-list">{matches.map((match, i) => <button key={`${match.signature}-${i}`} className="apk-analysis-match" onClick={() => open(match)}><span><strong>{match.name}</strong>{match.kind && <small>{match.kind}</small>}{match.tracker && <small className="apk-tracker-label">Tracker signature</small>}</span><span>{match.count.toLocaleString('en-US')}</span></button>)}</div> : <p>No matches in the inspected files.</p>}</div>
}
export function ApkAnalysis({ analysis, local = false }: { analysis?: Analysis; local?: boolean }) {
  const [selected, setSelected] = useState<ScanMatch | null>(null)
  const running = analysis?.status === 'running'
  const result = analysis && ['complete', 'partial'].includes(analysis.status)
  return <section className="app-details-wide apk-analysis" aria-label="APK analysis">
    <h2>APK analysis</h2>
    <p>{local ? "APK size, trackers, libraries, domains and URLs in the selected local file. Analysis runs locally; application code is never executed." : "Analyze APK size, trackers, libraries, domains and URLs in the base APK and installed splits. Analysis runs locally; application code is never executed."}</p>
    {!analysis && <p>{local ? "Analysis unavailable. Review the inspection warnings and reopen the APK to retry." : "APK contents have not been scanned. Use Actions → Scan APKs."}</p>}
    {analysis?.status === 'error' && <p role="alert" className="app-details-warning">{"Scan unavailable: "}{analysis.error || ''}</p>}
    {running && <p role="status">{local ? "Reading the local APK and matching signatures…" : "Reading APK files on the device and matching signatures…"}</p>}
    {result && <>
      <p><strong>{analysis.status === 'partial' ? "Partial scan" : "Scan complete"}</strong> · {analysis.classes.toLocaleString('en-US')}{" unique classes · "}{analysis.artifacts.length}{" APK files · Database "}{analysis.revision.slice(0, 12)}</p>
      <ApkComposition artifacts={analysis.artifacts} local={local} />
      <ApkAddresses addresses={analysis.addresses} local={local} />
      <p>{local ? "Counts below are class or file matches per signature. The tracker badge counts distinct DEX signatures. " : "Counts below are matches per signature. They differ from the manifest-component badge. "}² denotes ETIP-only entries. Presence of a library does not prove active tracking.</p>
      {analysis.issues.map((issue, i) => <p className="app-details-warning" key={i}>{issue}</p>)}
      <div className="apk-analysis-columns"><Matches title="Tracker signatures · DEX" matches={analysis.trackers} open={setSelected} /><Matches title="Library signatures · DEX" matches={analysis.libraries} open={setSelected} /><Matches title="Native library signatures" matches={analysis.native} open={setSelected} /></div>
      <h3>Inspected files</h3><div className="apk-artifacts">{analysis.artifacts.map(a => <div key={a.path}><code>{a.path}</code><span>{a.dexFiles}{" DEX · "}{a.classes.toLocaleString('en-US')}{" additional classes · "}{a.complete ? "Complete" : "Partial"}</span></div>)}</div>
      {!!analysis.unidentifiedNative.length && <><h3>{"Unidentified native libraries · "}{analysis.unidentifiedNative.length}</h3><div className="app-flag-list">{analysis.unidentifiedNative.map(name => <code key={name}>{name}</code>)}</div></>}
      <p>Files loaded dynamically from outside these APKs and encrypted or obfuscated code may not be recognised. Database files, sources and licences are available in Components.</p>
    </>}
    {selected && <BadgeDialog title={selected.name} close={() => setSelected(null)}><p>{"Signature: "}<code>{selected.signature}</code></p>{selected.website && <p>{selected.website}</p>}<p>{selected.count.toLocaleString('en-US')} {selected.tracker !== undefined ? "unique filenames" : "class matches"}{selected.count > selected.items.length ? ` · first ${selected.items.length.toLocaleString('en-US')} shown` : ''}</p><div className="apk-match-items">{selected.items.map((item, i) => <code key={i}>{item}</code>)}</div></BadgeDialog>}
  </section>
}
