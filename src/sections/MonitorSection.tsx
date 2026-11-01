import { NetworkConnectionsPanel } from '../components/NetworkConnectionsPanel'
import { BatteryUsagePanel } from '../components/BatteryUsagePanel'
import { useAndroidDiagnosticsStore } from '../store/useAndroidDiagnosticsStore'
import { usePhoneToolsStore } from '../store/usePhoneToolsStore'
import { useEffect, useMemo, useState } from 'react'
import { Cpu, MemoryStick, Battery, Network, Pause, Play, Info, MapPin } from 'lucide-react'
import { monitorTabs } from '../../electron/monitor-protocol'
import { useMonitorStore, type MonitorPoint } from '../store/useMonitorStore'
import { useConnectionStore } from '../store/useConnectionStore'
import { useAppStore } from '../store/useAppStore'
import { formatBytes, networkRate } from '../lib/monitor'

const tabs = { processes: { name: 'Processes', icon: Cpu }, memory: { name: 'Memory', icon: MemoryStick }, battery: { name: 'Battery', icon: Battery }, network: { name: 'Network', icon: Network } }
let requestInFlight = false
const numeric = (value: number | null | undefined, unit: string) => value == null ? "Unavailable" : `${value.toLocaleString('en-US', { maximumFractionDigits: 1 })}${unit}`
function Metric({ label, value, percent }: { label: string; value: string; percent?: number | null }) {
  return <div className="monitor-metric"><span>{label}</span><strong>{value}</strong>{percent != null && <meter min={0} max={100} value={percent} aria-label={label} />}</div>
}
function Chart({ title, points, value, format, max, secondary = false }: { title: string; points: MonitorPoint[]; value: (p: MonitorPoint, index: number) => number | null | undefined; format: (n: number) => string; max?: number; secondary?: boolean }) {
  const values = points.map(value), valid = values.filter((v): v is number => v != null && Number.isFinite(v)), ceiling = max || Math.max(1, ...valid) * 1.1
  const floor = Math.min(0, ...valid)
  const start = points[0]?.time || 0, end = points.at(-1)?.time || start, duration = Math.max(1000, end - start)
  const x = (i: number) => 8 + (points[i].time - start) / duration * 584, y = (n: number) => 122 - Math.min(1, Math.max(0, (n - floor) / (ceiling - floor))) * 112
  let path = '', connected = false
  values.forEach((v, i) => { if (v == null || !Number.isFinite(v)) { connected = false; return }; path += `${connected ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `; connected = true })
  return <figure className={`monitor-chart ${secondary ? 'secondary' : ''}`}><figcaption><strong>{title}</strong><span>{valid.length ? format(ceiling) : "No samples"}</span></figcaption><div className="monitor-plot"><svg viewBox="0 0 600 132" role="img" aria-label={`${title}, ${valid.length} samples`} preserveAspectRatio="none"><path className="monitor-grid" d="M8 10H592 M8 66H592 M8 122H592" /><path className="monitor-line" d={path} />{values.map((v, i) => v == null ? null : <circle key={i} className="monitor-dot" cx={x(i)} cy={y(v)} r={2}><title>{new Date(points[i].time).toLocaleTimeString('en-US')}: {format(v)}</title></circle>)}</svg>{!valid.length && <span className="monitor-chart-empty">Waiting for available data</span>}</div><div className="monitor-chart-time"><span>{start ? new Date(start).toLocaleTimeString('en-US') : '—'}</span><span>{end ? new Date(end).toLocaleTimeString('en-US') : '—'}</span></div></figure>
}

export function MonitorSection() {
  const phoneToolsBusy = usePhoneToolsStore(s => s.pending || s.job?.status === 'running' && s.job.action !== 'export')
  const diagnosticsRunning = useAndroidDiagnosticsStore(s => s.pending || s.job?.status === 'running')
  const diagnosticBusy = phoneToolsBusy || diagnosticsRunning
  const state = useMonitorStore(), { tab, paused, interval, history, networkView } = state
  const { activeDeviceId, devices } = useConnectionStore()
  const context = activeDeviceId || state.context
  const device = devices.find(d => d.id === context), connected = !!activeDeviceId && device?.status === 'connected'
  const [visible, setVisible] = useState(!document.hidden), [query, setQuery] = useState(''), [sort, setSort] = useState<'cpu' | 'rss' | 'name'>('cpu'), [iface, setIface] = useState('')
  useEffect(() => { const changed = () => setVisible(!document.hidden); document.addEventListener('visibilitychange', changed); return () => document.removeEventListener('visibilitychange', changed) }, [])
  useEffect(() => { if (useMonitorStore.getState().context !== context) { useMonitorStore.getState().reset(context); setIface('') } }, [context])
  useEffect(() => {
    useMonitorStore.setState({ error: null })
    if (tab === 'network' && networkView === 'connections' || !activeDeviceId || !connected || paused || diagnosticBusy || !visible || !window.desktop) return
    let stopped = false, timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      if (stopped) return
      if (requestInFlight) { timer = setTimeout(() => void poll(), 200); return }
      requestInFlight = true
      useMonitorStore.setState({ reading: true })
      try {
        const reply = await window.desktop!.request({ type: 'monitor.read', id: activeDeviceId, tab })
        if (stopped) return
        if (!reply.ok) throw new Error(reply.error)
        if (!reply.monitor || reply.monitor.id !== activeDeviceId || reply.monitor.tab !== tab) throw new Error("Monitor sample unavailable.")
        useMonitorStore.getState().append(reply.monitor)
      } catch (error) { if (!stopped) { useMonitorStore.getState().gap(tab); useMonitorStore.setState({ error: error instanceof Error ? error.message : String(error) }) } }
      finally { requestInFlight = false; if (!stopped) { useMonitorStore.setState({ reading: false }); timer = setTimeout(() => void poll(), interval * 1000) } }
    }
    // Delay also avoids duplicate initial reads under React StrictMode.
    timer = setTimeout(() => void poll(), 100)
    return () => { stopped = true; clearTimeout(timer); useMonitorStore.getState().gap(tab); useMonitorStore.setState({ reading: false }) }
  }, [activeDeviceId, context, device?.transportId, device?.serial, connected, tab, paused, visible, interval, diagnosticBusy, networkView])
  const points = state.context === context ? history[tab] : [], sample = [...points].reverse().find(p => p.sample)?.sample
  const memory = sample?.memory, battery = sample?.battery
  const interfaces = sample?.network?.interfaces || [], currentInterface = interfaces.some(i => i.name === iface) ? iface : interfaces.find(i => i.name === 'wlan0' && i.received > 0)?.name || interfaces.find(i => i.name !== 'lo' && i.received > 0)?.name || interfaces.find(i => i.name !== 'lo')?.name || interfaces[0]?.name || ''
  const net = interfaces.find(i => i.name === currentInterface)
  let last = points.length - 1
  while (last >= 0 && !points[last].sample) last--
  const used = memory?.total != null && memory.available != null ? memory.total - memory.available : null
  const processes = useMemo(() => (sample?.processes || []).filter(p => `${p.name} ${p.pid}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => (tab === 'memory' || sort === 'rss') ? (b.rss ?? -1) - (a.rss ?? -1) : sort === 'cpu' ? (b.cpu ?? -1) - (a.cpu ?? -1) : a.name.localeCompare(b.name)), [sample, query, sort, tab])
  const maxRss = Math.max(1, ...processes.map(p => p.rss || 0))
  const status = !connected ? "Disconnected" : !window.desktop ? "Desktop application required" : phoneToolsBusy ? "Paused during phone data collection" : diagnosticBusy ? "Paused during diagnostic collection" : paused ? "Paused" : !visible ? "Paused while hidden" : state.error ? "Collection failed" : !sample ? "Reading…" : "Live"
  return <section className="monitor-section" aria-label="Device monitor">
    <header className="monitor-heading"><h1>Monitor</h1><span>{device?.name || "No device selected"}</span><div className="monitor-controls"><label>{"Interval "}<select aria-label="Monitor interval" value={interval} onChange={e => useMonitorStore.setState({ interval: Number(e.target.value) })}>{[2, 5, 10, 30].map(n => <option key={n} value={n}>{n}{" s"}</option>)}</select></label><button className="button secondary" disabled={!connected} onClick={() => useMonitorStore.setState({ paused: !paused })}>{paused ? <Play size={14} /> : <Pause size={14} />}{paused ? "Resume" : "Pause"}</button></div></header>
    <div className="monitor-tabs" role="tablist" aria-label="Monitor views">{monitorTabs.map((key, index) => { const Icon = tabs[key].icon; return <button role="tab" id={`monitor-tab-${key}`} aria-controls="monitor-panel" aria-selected={tab === key} tabIndex={tab === key ? 0 : -1} key={key} onClick={() => useMonitorStore.setState({ tab: key })} onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const next = e.key === 'Home' ? 0 : e.key === 'End' ? 3 : (index + (e.key === 'ArrowRight' ? 1 : 3)) % 4; useMonitorStore.setState({ tab: monitorTabs[next] }); document.getElementById(`monitor-tab-${monitorTabs[next]}`)?.focus() } }}><Icon size={16} />{tabs[key].name}</button> })}</div>
    {!(tab === 'network' && networkView === 'connections') && <div className="monitor-status" role="status"><span>{status}{sample ? ` · Updated ${new Date(sample.time).toLocaleTimeString('en-US')}` : ''}</span><span title="Only this view is sampled. History is kept for this session, up to 120 points per view. Gaps represent pauses or unavailable data."><Info size={13} />Session history</span></div>}
    <div id="monitor-panel" className="monitor-content" role="tabpanel" aria-labelledby={`monitor-tab-${tab}`}>
      {!connected && <div className="monitor-notice">{device ? "Device disconnected. Displayed values are the last collected sample." : "Connect and select a phone to start monitoring."}<button className="button secondary" onClick={() => useAppStore.getState().setSection('connection')}>Open Connection</button></div>}
      {state.error && <p className="operation-error" role="alert">{state.error}</p>}
      {tab === 'processes' && <><div className="monitor-metrics"><Metric label="CPU · Android sampling window" value={numeric(sample?.cpu?.total, '%')} percent={sample?.cpu?.total} /><Metric label="Visible processes" value={sample?.processes?.length ? String(sample.processes.length) : "Unavailable"} /></div><Chart title="CPU load" points={points} value={p => p.sample?.cpu?.total} format={n => numeric(n, '%')} max={100} /><p className="monitor-note" title={sample?.cpu?.window || undefined}>CPU is Android’s recent sampling window, not an instantaneous reading. Processes absent from that report have no CPU value.</p></>}
      {tab === 'memory' && <><div className="monitor-metrics"><Metric label="Used RAM · total minus available" value={formatBytes(used)} percent={used !== null && memory?.total ? used / memory.total * 100 : null} /><Metric label="Available RAM" value={formatBytes(memory?.available)} /><Metric label="Total RAM" value={formatBytes(memory?.total)} /></div><Chart title="RAM usage" points={points} value={p => { const m = p.sample?.memory; return m?.total != null && m.available != null ? m.total - m.available : null }} format={formatBytes} max={memory?.total || undefined} /><div className="monitor-metrics"><Metric label="Free RAM" value={formatBytes(memory?.free)} /><Metric label="Page cache (overlaps available RAM)" value={formatBytes(memory?.cached)} /><Metric label="Swap used / total" value={memory?.swapTotal != null && memory.swapFree != null ? `${formatBytes(memory.swapTotal - memory.swapFree)} / ${formatBytes(memory.swapTotal)}` : "Unavailable"} /></div><p className="monitor-note">Per-process RAM is RSS and includes shared pages. Adding these values does not give total RAM usage.</p></>}
      {(tab === 'processes' || tab === 'memory') && <><div className="monitor-table-tools"><input aria-label="Search processes" placeholder="Process name or PID…" value={query} onChange={e => setQuery(e.target.value)} />{tab === 'processes' && <select aria-label="Sort processes" value={sort} onChange={e => setSort(e.target.value as typeof sort)}><option value="cpu">CPU usage</option><option value="rss">RAM usage</option><option value="name">Process name</option></select>}<span>{processes.length}{" processes"}</span></div><div className="monitor-table-wrap"><table><thead><tr><th>Process</th><th>PID</th>{tab === 'processes' && <th>CPU</th>}<th>RAM · RSS</th></tr></thead><tbody>{processes.map(p => <tr key={p.pid}><td title={p.name}>{p.name}</td><td>{p.pid}</td>{tab === 'processes' && <td>{numeric(p.cpu, '%')}{p.cpu != null && <meter aria-label={`${p.name} CPU`} min={0} max={Math.max(100, p.cpu)} value={p.cpu} />}</td>}<td>{formatBytes(p.rss)}{p.rss !== null && <meter aria-label={`${p.name} RAM`} min={0} max={maxRss} value={p.rss} />}</td></tr>)}</tbody></table>{!processes.length && <p className="monitor-empty">{sample?.processes?.length ? "No matching processes." : "No process data available."}</p>}</div></>}
      {tab === 'battery' && <><div className="monitor-metrics"><Metric label="Battery" value={numeric(battery?.level, '%')} percent={battery?.level} /><Metric label="Temperature" value={numeric(battery?.temperature, ' °C')} /><Metric label="Status" value={(battery?.status || '') || "Unavailable"} /></div><div className="monitor-charts"><Chart title="Battery level" points={points} value={p => p.sample?.battery?.level} format={n => numeric(n, '%')} max={100} /><Chart title="Temperature" secondary points={points} value={p => p.sample?.battery?.temperature} format={n => numeric(n, ' °C')} /></div><div className="monitor-metrics"><Metric label="Voltage" value={numeric(battery?.voltage, ' V')} /><Metric label="Current · device-reported sign" value={numeric(battery?.current, ' mA')} /><Metric label="Health" value={(battery?.health || '') || "Unavailable"} /><Metric label="Power source" value={battery?.status ? battery.power.map(source => source).join(', ') || "Battery" : "Unavailable"} /><Metric label="Technology" value={battery?.technology || "Unavailable"} /></div><BatteryUsagePanel device={device} /></>}
      {tab === 'network' && <div className="network-tools" role="group" aria-label="Network view"><button className="button secondary" aria-pressed={networkView === 'overview'} onClick={() => useMonitorStore.setState({ networkView: 'overview' })}>Overview</button><button className="button secondary" aria-pressed={networkView === 'connections'} onClick={() => useMonitorStore.setState({ networkView: 'connections' })}>Connections</button></div>}
      {tab === 'network' && networkView === 'connections' && <NetworkConnectionsPanel key={JSON.stringify([device?.id, device?.serial, device?.transportId])} device={device} visible={visible} blocked={diagnosticBusy} />}
      {tab === 'network' && networkView === 'overview' && <><div className="monitor-table-tools"><label>{"Interface "}<select aria-label="Network interface" value={currentInterface} disabled={!interfaces.length} onChange={e => setIface(e.target.value)}>{!interfaces.length && <option value="">Unavailable</option>}{interfaces.map(i => <option key={i.name}>{i.name}</option>)}</select></label></div><div className="monitor-metrics"><Metric label="Receive speed" value={numericRate(networkRate(points, last, currentInterface, 'received'))} /><Metric label="Send speed" value={numericRate(networkRate(points, last, currentInterface, 'sent'))} /><Metric label="Received / sent · interface counters" value={net ? `${formatBytes(net.received)} / ${formatBytes(net.sent)}` : "Unavailable"} /></div><div className="monitor-charts"><Chart title="Receive speed" points={points} value={(_p, i) => networkRate(points, i, currentInterface, 'received')} format={n => `${formatBytes(n)}/s`} /><Chart title="Send speed" secondary points={points} value={(_p, i) => networkRate(points, i, currentInterface, 'sent')} format={n => `${formatBytes(n)}/s`} /></div><p className="monitor-note">Speed needs two consecutive samples. Counters belong to one interface; Wi-Fi, mobile and VPN traffic are not added together.</p><h2>Interface addresses</h2><div className="monitor-addresses">{sample?.network?.addresses.length ? sample.network.addresses.map((line, i) => <code key={i}>{line}</code>) : <p className="monitor-empty">Unavailable</p>}</div></>}
      {!(tab === 'network' && networkView === 'connections') && !!sample?.issues.length && <details className="monitor-issues"><summary>Unavailable readings ({sample.issues.length})</summary>{sample.issues.map((issue, i) => <p key={i}>{issue}</p>)}</details>}
    </div>
  </section>
}
function numericRate(value: number | null) { return value === null ? "Waiting for samples" : `${formatBytes(value)}/s` }

export function MonitorInspector() {
  const tab = useMonitorStore(s => s.tab)
  const networkView = useMonitorStore(s => s.networkView)
  const inspectorTab = useAppStore(s => s.inspectorTab)
  if (inspectorTab === 'actions') return <><span className="eyebrow">MONITOR ACTIONS</span>{tab === 'network' ? <><div className="component-action-list"><button className="button secondary" onClick={() => { useAppStore.getState().setSection('components'); useAppStore.setState({ selectedId: 'geoip', inspectorTab: 'actions' }) }}><MapPin size={15} />Configure GeoIP</button></div><p className="component-description">Open the GeoIP component to select local country and network databases.</p></> : <p className="component-description">Use the controls in the workspace to pause or resume readings.</p>}</>
  if (tab === 'network' && networkView === 'connections') return <><span className="eyebrow">PHONE CONNECTIONS</span><p className="component-description">See which IP addresses your phone connects to and which apps Android associates with them. Pause keeps the current list.</p><p className="component-description">Country and Network show the approximate country and network operator. Configure GeoIP in Actions to add local databases. Local addresses have no country.</p><p className="component-description">Click a remote or local address to copy its IP without the port. Click a network to copy its name and ASN. App icons come from the matching profile loaded in Apps.</p><p className="component-description">Several apps can share one Android identifier (UID). In that case, the list shows all possible owners.</p></>
  return <><span className="eyebrow">{"MONITOR / "}{tabs[tab].name.toUpperCase()}</span><p className="component-description">Read-only device monitoring. Collection runs only while Monitor and the selected view are visible. Pause keeps the current readings.</p><p className="component-description">Charts show this session, up to 120 samples per view. Switching devices clears the history. Missing readings and connection interruptions leave gaps.</p><p className="component-description">Android may restrict process and network information. Unavailable does not mean zero. No root permission is requested automatically.</p></>
}
