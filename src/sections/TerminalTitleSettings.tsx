import { useAppearanceStore } from '../store/useAppearanceStore'
import { isTerminalTitlePreset, terminalTitlePresets } from '../lib/terminalTitle'

export function TerminalTitleSettings() {
  const { terminalTitleAnimated, terminalTitlePreset, terminalTitleRepeat, terminalQuotesAnimated, terminalTextSpeed,
    setTerminalTitleAnimated, setTerminalTitlePreset, setTerminalTitleRepeat, setTerminalQuotesAnimated, setTerminalTextSpeed } = useAppearanceStore()
  const disabled = !terminalTitleAnimated && !terminalQuotesAnimated
  return <fieldset className="workspace-density-settings zero-cool-title-settings">
    <legend>Zero Cool text animations</legend>
    <label><input type="checkbox" checked={terminalTitleAnimated} onChange={event => setTerminalTitleAnimated(event.target.checked)} aria-label="Animate ADB Vault" />
      <span><strong>Animate ADB Vault</strong><small>Decrypt the name in the title bar.</small></span></label>
    <label><input type="checkbox" checked={terminalTitleRepeat} disabled={!terminalTitleAnimated} onChange={event => setTerminalTitleRepeat(event.target.checked)} aria-label="Repeat title animation" />
      <span><strong>Repeat animation</strong><small>Replay after a short pause with the name readable.</small></span></label>
    <label><input type="checkbox" checked={terminalQuotesAnimated} onChange={event => setTerminalQuotesAnimated(event.target.checked)} aria-label="Animate movie quotes" />
      <span><strong>Animate movie quotes</strong><small>Decode each Hackers quote once, then leave it readable.</small></span></label>
    <label className="zero-cool-title-preset"><span>Animation preset</span>
      <select value={terminalTitlePreset} disabled={disabled} aria-describedby="zero-cool-title-description" onChange={event => {
        if (isTerminalTitlePreset(event.target.value)) setTerminalTitlePreset(event.target.value)
      }}>{Object.entries(terminalTitlePresets).map(([id, preset]) => <option key={id} value={id}>{preset.label}</option>)}<option value="random">Random</option></select>
    </label>
    <label className="zero-cool-text-speed"><span>Animation speed <output>{terminalTextSpeed}×</output></span>
      <input type="range" min="0.5" max="2" step="0.25" value={terminalTextSpeed} disabled={disabled} aria-label="Animation speed" aria-valuetext={`${terminalTextSpeed}x`} onChange={event => setTerminalTextSpeed(Number(event.target.value))} />
      <small>0.5× slower · 1× original · 2× faster</small>
    </label>
    <p id="zero-cool-title-description">{terminalTitlePreset === 'random'
      ? 'A new effect for each title cycle and quote. Consecutive title cycles use different effects.'
      : terminalTitlePresets[terminalTitlePreset].description} The preset and speed apply to the title and movie quotes. Only active in Zero Cool; your choices are saved. Pauses while minimized and respects reduced motion.</p>
  </fieldset>
}
