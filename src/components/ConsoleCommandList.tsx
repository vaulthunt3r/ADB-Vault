import { useState } from 'react'
import { ArrowUpRight, Search } from 'lucide-react'
import { BadgeDialog } from './BadgeDialog'
import { consoleCommands, consoleCommandText, type ConsoleCommand } from '../lib/console-commands'
import type { ConsoleMode } from '../../electron/adb-console-protocol'

const categories = [...new Set(consoleCommands.map(command => command.category))]

export function ConsoleCommandList({ mode, choose, close }: { mode: ConsoleMode; choose: (command: ConsoleCommand) => void; close: () => void }) {
  const [query, setQuery] = useState(''), [category, setCategory] = useState('All')
  const terms = query.toLowerCase().trim().split(/\s+/)
  const filtered = consoleCommands.filter(command => (category === 'All' || command.category === category)
    && terms.every(term => `${command.label} ${command.category} ${command.description} ${consoleCommandText(command, mode)}`.toLowerCase().includes(term)))
  return <BadgeDialog title="Command list" className="console-command-list" close={close}>
    <p className="console-catalog-intro">Choose a command to fill the editor, then press Enter or Run command. These commands read information from your phone.</p>
    <div className="console-catalog-search"><Search size={15} aria-hidden="true" /><input autoFocus type="search" aria-label="Search commands" placeholder="Search by name, purpose or command…" value={query} onChange={event => setQuery(event.target.value)} /></div>
    <div className="console-catalog-categories" aria-label="Command categories">{["All", ...categories].map(item => <button key={item} className="button secondary" aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div>
    <p className="console-catalog-count" role="status">{filtered.length} {filtered.length === 1 ? "command" : "commands"} · {mode === 'adb' ? "ADB command" : "Android shell"}</p>
    <div className="console-catalog-results">
      {categories.map(group => {
        const commands = filtered.filter(command => command.category === group)
        return commands.length ? <div className="console-catalog-group" key={group}><h3>{group}</h3>{commands.map(command => <button className="console-catalog-command" key={command.label} aria-label={`Use ${command.label}`} onClick={() => choose(command)}>
          <strong>{command.label}<ArrowUpRight size={14} aria-hidden="true" /></strong>
          <span>{command.description}</span>
          <code>{mode === 'adb' ? "adb " : '$ '}{consoleCommandText(command, mode)}</code>
        </button>)}</div> : null
      })}
      {!filtered.length && <p className="console-catalog-empty">No matching commands. Try another search or category.</p>}
    </div>
  </BadgeDialog>
}
