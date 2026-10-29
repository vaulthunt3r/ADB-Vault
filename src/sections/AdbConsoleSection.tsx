import { message } from "../lib/i18n"
import { t } from "../lib/i18n"
import { useEffect, useRef, useState } from 'react'
import { ArrowDown, BookOpen, Copy, Info, Play, Square, Terminal, Trash2 } from 'lucide-react'
import { useAdbConsoleStore } from '../store/useAdbConsoleStore'
import { useConnectionStore } from '../store/useConnectionStore'
import { useAppStore } from '../store/useAppStore'
import { usePowerBlocked } from '../components/DevicePowerActions'
import { copyText } from '../lib/clipboard'
import { ConsoleCommandList } from '../components/ConsoleCommandList'
import { consoleCommands, consoleCommandText, quickConsoleCommands, type ConsoleCommand } from '../lib/console-commands'
import type { ConsoleMode } from '../../electron/adb-console-protocol'
import '../adb-console.css'

export function AdbConsoleSection() {
  const s = useAdbConsoleStore(), connection = useConnectionStore(), blocked = usePowerBlocked()
  const device = connection.devices.find(d => d.id === connection.activeDeviceId)
  const available = connection.devices.filter(d => d.status === 'connected')
  const active = s.run?.status === 'running' || s.run?.status === 'stopping'
  const output = useRef<HTMLPreElement>(null), input = useRef<HTMLTextAreaElement>(null)
  const [follow, setFollow] = useState(true)
  const [showCommands, setShowCommands] = useState(false)
  const previous = useRef(-1), draft = useRef({ command: '', mode: s.mode })
  const connected = device?.status === 'connected'
  const canRun = connected && connection.adbAvailable && !!s.command.trim() && !s.pending && !blocked
  const selectedCommand = consoleCommands.find(command => consoleCommandText(command, s.mode) === s.command.trim())
  const changeCommand = (command: string, mode = s.mode) => {
    useAdbConsoleStore.setState({ command, mode, error: '' }); previous.current = -1
  }
  const chooseCommand = (command: ConsoleCommand) => {
    const value = consoleCommandText(command, s.mode)
    changeCommand(value); setShowCommands(false)
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(value.length, value.length) })
  }
  const run = () => {
    if (canRun && device) { setFollow(true); void s.start({ id: device.id, serial: device.serial, transportId: device.transportId }) }
  }
  useEffect(() => {
    if (follow && output.current) output.current.scrollTop = output.current.scrollHeight
  }, [s.run?.output, follow])
  const copy = async () => {
    if (!s.run) return
    try {
      await copyText(`${s.run.deviceName} · ${s.run.target.serial}\n${s.run.mode === 'adb' ? 'adb' : '$'} ${s.run.command}\n\n${s.run.output.map(part => part.text).join('')}\n\n${s.run.message}`)
      useAppStore.getState().notify("Console output copied.")
    } catch (error) { useAdbConsoleStore.setState({ error: (error as Error).message }) }
  }
  return <section className="section-content adb-console-section" aria-labelledby="adb-console-title">
    <div className="section-heading"><div><div className="eyebrow section-eyebrow">{t("DEVICE TOOLS")}</div><h1 id="adb-console-title">{t("Console")}<span className="heading-period">.</span></h1><p>{t("Run commands on your phone and read their output as it arrives.")}</p></div></div>
    <div className="console-controls">
      <label>{t("Device")}<select aria-label={t("Console device")} value={device?.id || ''} disabled={s.pending || active || !available.length} onChange={e => connection.selectDevice(e.target.value)}>
        {!connected && <option value={device?.id || ''} disabled>{device ? `${device.name} · ${device.status}` : available.length ? t("Select a connected phone") : connection.scanning ? t("Searching for phones…") : t("No connected phones")}</option>}
        {available.map(d => <option key={d.id} value={d.id}>{d.name} · {d.serial}</option>)}
      </select></label>
      <label>{t("Mode")}<select aria-label={t("Console mode")} value={s.mode} onChange={e => changeCommand(s.command, e.target.value as ConsoleMode)}>
        <option value="adb">{t("ADB command")}</option><option value="shell">{t("Android shell")}</option>
      </select></label>
      <label>{t("Time limit")}<select aria-label={t("Command time limit")} value={s.timeout} onChange={e => useAdbConsoleStore.setState({ timeout: Number(e.target.value) })}>
        <option value={30000}>{t("30 seconds")}</option><option value={120000}>{t("2 minutes")}</option><option value={600000}>{t("10 minutes")}</option>
      </select></label>
    </div>
    <div className="console-editor">
      <div className="console-examples"><button className="button secondary console-list-trigger" onClick={() => setShowCommands(true)}><BookOpen size={14} />{t("Command list")}<span>{consoleCommands.length}</span></button>
        {quickConsoleCommands.map(command => <button key={command.label} className="button secondary" title={message(command.description)} onClick={() => chooseCommand(command)}>{command.label}</button>)}
      </div>
      <label htmlFor="console-command">{s.mode === 'adb' ? t("ADB command") : t("Android shell command")}<span>{t("Enter to run · Ctrl+Enter for a new line · ↑ / ↓ for history")}</span></label>
      <div className="console-input"><span aria-hidden="true">{s.mode === 'adb' ? t("adb ›") : '$'}</span><textarea ref={input} id="console-command" aria-label={t("Console command")} value={s.command} spellCheck={false} autoCapitalize="off" autoComplete="off" maxLength={8192} rows={2}
        placeholder={s.mode === 'adb' ? t("shell getprop ro.product.model") : t("getprop ro.product.model")}
        onChange={e => changeCommand(e.target.value)}
        onKeyDown={e => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter') {
            e.preventDefault()
            if (e.ctrlKey || e.metaKey) {
              const field = e.currentTarget, start = field.selectionStart
              const value = `${s.command.slice(0, start)}\n${s.command.slice(field.selectionEnd)}`
              if (value.length <= field.maxLength) {
                changeCommand(value)
                requestAnimationFrame(() => field.setSelectionRange(start + 1, start + 1))
              }
            } else if (!e.repeat) run()
            return
          }
          if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !s.command.includes('\n') && ['ArrowUp', 'ArrowDown'].includes(e.key) && s.history.length) {
            e.preventDefault()
            if (previous.current === -1) draft.current = { command: s.command, mode: s.mode }
            previous.current = Math.min(s.history.length - 1, Math.max(-1, previous.current + (e.key === 'ArrowUp' ? 1 : -1)))
            useAdbConsoleStore.setState(previous.current === -1 ? draft.current : s.history[previous.current])
          }
        }} /></div>
      {selectedCommand && <p className="console-command-help"><Info size={14} aria-hidden="true" /><span>{message(selectedCommand.description)}</span></p>}
      <div className="console-command-actions">
        <select aria-label={t("Recent console commands")} value="" disabled={!s.history.length} onChange={e => { const item = s.history[Number(e.target.value)]; if (item) { changeCommand(item.command, item.mode); input.current?.focus() } }}>
          <option value="">{t("Recent commands (")}{s.history.length})</option>
          {s.history.map((item, i) => <option key={i} value={i}>{item.mode === 'adb' ? t("adb") : '$'} {item.command}</option>)}
        </select>
        <button className="button primary" disabled={!canRun} onClick={run}><Play size={14} />{t("Run command")}</button>
        <button className="button secondary" disabled={!active || s.pending || s.run?.status === 'stopping'} onClick={() => void s.stop()}><Square size={14} />{t("Stop")}</button>
      </div>
    </div>
    {(!connected || !connection.adbAvailable) && <div className="console-connection-note">
      <p className="console-note" role="status">{!connection.adbAvailable ? t("ADB is not available. Install or locate it in Components.") : !available.length ? t("No connected phones. Open Connection to connect a phone or check its authorization.") : t("Select a connected phone above to run commands.")}</p>
      {(!connection.adbAvailable || !available.length) && <button className="button secondary" onClick={() => useAppStore.getState().setSection(connection.adbAvailable ? 'connection' : 'components')}>{connection.adbAvailable ? t("Open Connection") : t("Open Components")}</button>}
    </div>}
    {connected && blocked && !active && <p className="console-note">{t("Wait for the current phone operation to finish.")}</p>}
    {s.error && <p className="console-error" role="alert">{message(s.error)}</p>}
    <div className="console-output-card">
      <div className="console-output-heading"><strong>{t("Output")}</strong>
        {s.run && <span className={`console-result ${s.run.status}`} role="status">{s.run.status === 'running' ? t("Running") : s.run.status === 'stopping' ? t("Stopping") : s.run.status === 'cancelled' ? t("Stopped") : t("Exit {0}", [s.run.exitCode ?? '—'])}</span>}
        <div className="console-output-actions"><button className="button secondary" disabled={!s.run} onClick={() => { setFollow(true); if (output.current) output.current.scrollTop = output.current.scrollHeight }} title={t("Follow latest output")}><ArrowDown size={14} />{t("Follow")}</button><button className="button secondary" disabled={!s.run} onClick={() => void copy()}><Copy size={14} />{t("Copy output")}</button><button className="button secondary" disabled={active || s.pending || !s.run && !s.history.length} onClick={() => void s.clear()} title={t("Clear output and command history for this session")}><Trash2 size={14} />{t("Clear session")}</button></div>
      </div>
      {s.run ? <>
        <div className="console-run-context"><span>{s.run.deviceName} · {s.run.target.serial}</span><code>{s.run.mode === 'adb' ? t("adb") : '$'} {s.run.command}</code></div>
        {s.run.truncated && <p className="console-note">{t("Earlier output omitted. Showing the latest output.")}</p>}
        <pre ref={output} className="console-output" aria-label={t("Command output")} tabIndex={0} onScroll={e => setFollow(e.currentTarget.scrollHeight - e.currentTarget.scrollTop - e.currentTarget.clientHeight < 24)}>
          {s.run.output.length ? s.run.output.map((part, i) => <span key={i} className={`console-${part.stream}`}>{part.text}</span>) : <span className="console-empty-output">{active ? t("Waiting for output…") : t("The command produced no output.")}</span>}
        </pre>
        <div className="console-output-footer">{message(s.run.message)}</div>
      </> : <div className="console-empty"><Terminal size={28} /><strong>{t("Ready for a command")}</strong><p>{t("Choose a command above, then press Enter or Run command.")}</p></div>}
    </div>
    {showCommands && <ConsoleCommandList mode={s.mode} choose={chooseCommand} close={() => setShowCommands(false)} />}
  </section>
}

export function AdbConsoleInspector() {
  const mode = useAdbConsoleStore(s => s.mode)
  return <><span className="eyebrow">{t("CONSOLE")}</span><h2>{mode === 'adb' ? t("ADB commands") : t("Android shell")}</h2>
    <p className="component-description">{mode === 'adb' ? t("Enter a command such as shell getprop, logcat or pull. The adb prefix is optional. ADB Vault supplies the selected device automatically.") : t("Enter Android shell commands directly. Pipes, quotes and redirects are interpreted on the phone.")}</p>
    <dl className="metadata"><div><dt>{t("Run")}</dt><dd>{t("Enter")}</dd></div><div><dt>{t("New line")}</dt><dd>{t("Ctrl+Enter")}</dd></div><div><dt>{t("Command history")}</dt><dd>↑ / ↓</dd></div><div><dt>{t("History storage")}</dt><dd>{t("Current session · 50 commands")}</dd></div></dl>
    <p className="component-description">{t("Each command starts a new process. For example, use ")}<code>{t("cd /sdcard && ls")}</code>{t(" in one shell command. Interactive programs that need keyboard input are not supported.")}</p>
    <p className="component-description">{t("Output stops at 1 MB per stream or at the selected time limit. Stop ends the local ADB command; it does not undo changes or guarantee that a detached process on the phone stops.")}</p>
  </>
}
