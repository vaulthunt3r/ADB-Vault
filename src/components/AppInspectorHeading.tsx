import { AppNotesSummary } from './AppNotes'
import { AppWebServices } from './AppWebServices'
import type { AndroidApp } from '../../electron/apps-protocol'
import { AppIcon } from './AppsTable'

export function AppInspectorHeading({ app }: { app: AndroidApp }) {
  return <header className="app-inspector-heading">
    <div className="app-inspector-summary"><AppIcon app={app} /><div><div className="app-title-line"><h2 title={app.label}>{app.label}</h2><AppNotesSummary app={app} compact /></div><p>{"Version "}{app.versionName || "Unavailable"}</p></div></div>
    <code>{app.packageName}</code><AppWebServices app={app} />
  </header>
}
