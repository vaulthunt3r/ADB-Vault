import { Palette, RotateCcw } from 'lucide-react'
import { useAppearanceStore } from '../store/useAppearanceStore'
import { getActiveTheme } from '../lib/themes'
import { StatusLegend } from '../sections/AppearanceSection'

export function AppearanceInspector() {
  const { themeId, setTheme, terminalMode, terminalColor, terminalPinned } = useAppearanceStore()
  const theme = getActiveTheme(themeId, terminalMode, terminalColor)
  return <>
    <div className="inspector-section-label"><span className="eyebrow">APPEARANCE</span></div>
    <div className="section-inspector-icon"><Palette size={25} /></div>
    <h2 className="section-inspector-title">{theme.name}</h2><p className="component-description">{theme.description}</p>
    <dl className="metadata"><div><dt>Mode</dt><dd>{theme.mode === 'dark' ? "Dark" : "Light"}</dd></div><div><dt>Saving</dt><dd>{terminalMode ? terminalPinned ? "Pinned across restarts" : "This session only" : "Automatic"}</dd></div></dl>
    <div className="appearance-inspector-swatches">{[['bg', "Workspace"], ['sidebar', "Sidebars"], ['selected', "Selection"], ['accent', "Accent"]].map(([key, label]) => {
      const color = key === 'sidebar' ? theme.navigationBackground ?? theme.colors[key] : theme.colors[key]
      return <div key={key}><i style={{ background: color }} /><span>{label}</span><code>{color}</code></div>
    })}</div>
    <StatusLegend /><div className="recovery-actions"><button className="button secondary" disabled={theme.id === 'sage'} onClick={() => setTheme('sage')}><RotateCcw size={14} />Restore Soft Sage</button></div>
  </>
}
