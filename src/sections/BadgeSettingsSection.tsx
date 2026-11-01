import { useState } from 'react'
import { BadgeLegend } from '../components/BadgeLegend'
import { badgeAppearanceVariants, customBadgeStyle, defaultBadgeColor, contrastingBadgeText } from '../lib/badgeAppearance'
import { useBadgeAppearanceStore } from '../store/useBadgeAppearanceStore'
import { useAppearanceStore } from '../store/useAppearanceStore'
import { findTheme } from '../lib/themes'

export function BadgeSettingsSection() {
  const { colors, textColors, setColor, setTextColor, reset } = useBadgeAppearanceStore()
  const neutralColor = useAppearanceStore(s => findTheme(s.themeId).colors['surface-alt'])
  const neutralText = useAppearanceStore(s => findTheme(s.themeId).colors.muted)
  const [legend, setLegend] = useState(false)
  return <section className="section-content" aria-labelledby="badge-settings-title">
    <div className="section-heading"><div><div className="eyebrow section-eyebrow">SETTINGS / BADGES</div><h1 id="badge-settings-title">Badge colors</h1><p>Choose background and text colors for each badge. Auto keeps the default text or selects contrasting text for your custom background.</p></div></div>
    <div className="badge-settings-toolbar"><button className="button secondary" onClick={() => setLegend(true)}>Badge legend</button><button className="button secondary" disabled={!Object.keys(colors).length && !Object.keys(textColors).length} onClick={() => reset()}>Reset all colors</button><span>Saved automatically</span></div>
    <p className="badge-settings-note">Defaults use the original colors, including neutral colors from the current theme. Badge variants can be customized separately. The legend describes unsupported checks.</p>
    <p className="badge-settings-note">General filter choices are included below. Their colors change appearance only; radio buttons and checkboxes indicate selection.</p>
    <div className="badge-color-list">{badgeAppearanceVariants.map(v => <div className="badge-color-row" key={v.id} data-badge-color={v.id}>
      <span className={`app-info-badge ${v.tone}`} style={customBadgeStyle(colors[v.id], textColors[v.id])}>{v.label}</span>
      <label className="badge-color-control"><span>Background</span><input type="color" aria-label={`Color ${v.label}`} value={colors[v.id] || (v.tone === 'neutral' ? neutralColor : defaultBadgeColor(v.tone))} onChange={e => setColor(v.id, e.target.value)} /><span>{colors[v.id] || "Default"}</span></label>
      <div className="badge-text-control"><label><span>Text</span><select aria-label={`Text mode ${v.label}`} value={textColors[v.id] ? 'custom' : 'auto'} onChange={e => setTextColor(v.id, e.target.value === 'auto' ? undefined : '#ffffff')}><option value="auto">Auto</option><option value="custom">Custom</option></select></label><input type="color" aria-label={`Text color ${v.label}`} disabled={!textColors[v.id]} value={textColors[v.id] || (colors[v.id] ? contrastingBadgeText(colors[v.id]) : v.tone === 'neutral' ? neutralText : contrastingBadgeText(defaultBadgeColor(v.tone)))} onChange={e => setTextColor(v.id, e.target.value)} /></div>
      <button className="button secondary" disabled={!colors[v.id] && !textColors[v.id]} aria-label={`Reset ${v.label}`} onClick={() => reset(v.id)}>Reset</button>
    </div>)}</div>
    {legend && <BadgeLegend close={() => setLegend(false)} />}
  </section>
}
