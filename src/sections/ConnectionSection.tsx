import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Cable, Check, History, QrCode, RefreshCw, Smartphone, Trash2, Unplug, Usb, Wifi, X } from 'lucide-react'
import { useConnectionStore } from '../store/useConnectionStore'
import { ConnectionStatus } from '../components/ConnectionInspector'
import { ForgetDeviceDialog } from '../components/ForgetDeviceDialog'
import { ReconnectDeviceDialog } from '../components/ReconnectDeviceDialog'
import type { DeviceRecord } from '../../electron/contracts'
import { FastbootDevices } from '../components/FastbootDevices'
import { AdbSetupNotice } from '../components/AdbSetupNotice'
import { orderedKnownDevices } from '../lib/knownDevices'

export function ConnectionSection() {
  const state = useConnectionStore()
  const { devices, activeDeviceId, selectedDeviceId, busy, adbAvailable } = state
  const [host, setHost] = useState(''), [port, setPort] = useState('')
  const [pairHost, setPairHost] = useState(''), [pairPort, setPairPort] = useState(''), [code, setCode] = useState('')
  const [image, setImage] = useState(''), [now, setNow] = useState(Date.now())
  const [forgetDevice, setForgetDevice] = useState<DeviceRecord | null>(null)
  const [findDevice, setFindDevice] = useState(false)
  const active = devices.find(d => d.id === activeDeviceId)
  const usb = devices.filter(d => d.method === 'USB' && d.status !== 'disconnected')
  const known = orderedKnownDevices(devices, activeDeviceId)
  const knownList = useRef<HTMLDivElement>(null)
  useEffect(() => { if (activeDeviceId) knownList.current?.scrollTo({ top: 0 }) }, [activeDeviceId])
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  useEffect(() => {
    let cancelled = false
    setImage('')
    if (state.qr?.payload) void QRCode.toDataURL(state.qr.payload, { width: 160, margin: 2, color: { dark: '#18231e', light: '#ffffff' } }).then(url => { if (!cancelled) setImage(url) }).catch(() => {})
    return () => { cancelled = true }
  }, [state.qr?.payload])
  const seconds = Math.max(0, Math.ceil(((state.qr?.expiresAt || 0) - now) / 1000))
  return <section className="section-content connection-section">
    <div className="section-heading"><div><div className="eyebrow section-eyebrow">CONNECT YOUR DEVICE</div><h1>Connection<span className="heading-period">.</span></h1><p>USB and Android Wireless debugging. Device states come from ADB.</p></div></div>
    {!window.desktop && <div className="operation-error" role="alert">Real connections require the Electron desktop application. Start it with npm run dev.</div>}
    {window.desktop && !adbAvailable && <AdbSetupNotice />}
    <div className="connection-overview"><Smartphone size={16} /><span>{active ? <>{"Active device: "}<strong>{active.name}</strong> · {active.method}</> : "No active device"}</span><span className="connection-count">{devices.filter(d => d.status === 'connected').length}{" connected"}</span></div>
    {state.errorNotice && <div className="operation-error dismissible-error" role="alert"><span>{state.errorNotice.text}</span><button className="icon-button" aria-label="Dismiss connection error" onClick={state.dismissError}><X size={15} /></button></div>}
    {state.message && <p className="connection-message" role="status">{state.message}</p>}
    <div className="connection-methods" aria-label="Connection methods">
      <article className="connection-method" aria-labelledby="usb-heading"><div className="method-intro"><div className="method-heading"><Usb size={18} /><h2 id="usb-heading">USB connection</h2></div><p>Enable USB debugging, connect a data cable and approve this computer on the phone.</p></div><div className="method-controls usb-live-list">
        {usb.length ? usb.map(device => <div key={device.id} className="usb-live-device"><button className="device-select" onClick={() => state.selectDevice(device.id)}><Smartphone size={20} /><span><strong>{device.name}</strong><span>{device.serial}</span></span></button><ConnectionStatus status={device.status} /><div className="data-actions"><button className="button secondary" disabled={busy} onClick={() => void state.reconnect(device.id)}><RefreshCw size={14} />Reconnect</button><button className="button secondary" disabled={busy || !device.canDetach} title={device.canDetach ? "Detach this USB device from ADB" : "Unplug the cable; this USB backend does not support detach"} onClick={() => void state.disconnect(device.id)}><Unplug size={14} />{device.canDetach ? "Disconnect" : "Unplug cable"}</button></div>{device.status === 'unauthorized' && <p className="connection-recovery">Unlock the phone and accept the USB debugging authorization dialog.</p>}{device.status === 'offline' && <p className="connection-recovery">ADB sees the device, but it is offline. Reconnect the cable or toggle USB debugging.</p>}</div>) : <p className="empty-device-list">No USB devices detected. Devices appear automatically after ADB detects them.</p>}
      </div></article>
      <article className="connection-method" aria-labelledby="code-heading"><div className="method-intro"><div className="method-heading"><Wifi size={18} /><h2 id="code-heading">Pair with code</h2></div><p>Android 11+: Wireless debugging → Pair device with pairing code. Use the pairing port shown there.</p></div><form className="method-controls" onSubmit={async event => { event.preventDefault(); if (await state.pair(pairHost.trim(), pairPort, code)) { setCode(''); setHost(pairHost.trim()) } }}><div className="connection-fields pairing-fields"><label>Pairing IP address<input required value={pairHost} onChange={e => setPairHost(e.target.value)} placeholder="192.168.1.42" /></label><label>Pairing port<input required value={pairPort} onChange={e => setPairPort(e.target.value)} inputMode="numeric" placeholder="Port" /></label><label>Pairing code<input required value={code} onChange={e => setCode(e.target.value)} pattern="[0-9]{6}" maxLength={6} inputMode="numeric" autoComplete="off" placeholder="6 digits" /></label><button className="button secondary" disabled={busy || !adbAvailable}><Wifi size={14} />Pair device</button></div><p className="connection-field-hint">Pairing authorizes this computer. ADB connects through discovery, or use the connection address below.</p></form></article>
      <article className="connection-method" aria-labelledby="qr-heading"><div className="method-intro"><div className="method-heading"><QrCode size={18} /><h2 id="qr-heading">Pair with QR</h2></div><p>Android 11+: Wireless debugging → Pair device with QR code. Both devices must be on the same network.</p></div><div className="qr-layout method-controls"><div className="qr-frame">{image && seconds > 0 ? <img src={image} alt="Wireless debugging pairing QR code" /> : <QrCode size={42} />}</div><div className="qr-session"><span className="qr-expiry">{state.qr?.status === 'waiting' ? `Waiting for scan · ${seconds}s` : state.qr?.status === 'pairing' ? "Pairing…" : state.qr?.status || "No active QR session"}</span><span className="qr-demo-hint">{state.qr?.message || "Create a QR code to start a secure pairing session."}</span></div><div className="qr-buttons"><button className="button secondary" disabled={busy || !adbAvailable || state.qrCreating} onClick={() => void state.newQr()}><RefreshCw size={14} />{state.qrCreating ? "Creating QR code…" : state.qr ? "New QR code" : "Create QR code"}</button>{(state.qr || state.qrCreating) && <button className="text-button" disabled={busy} onClick={() => void state.cancelQr()}>Cancel QR session</button>}</div></div></article>
      <article className="connection-method" aria-labelledby="manual-heading"><div className="method-intro"><div className="method-heading"><Cable size={18} /><h2 id="manual-heading">Connect manually</h2></div><p>{"Use IP address & Port from the main Wireless debugging screen. This is different from the pairing port."}</p></div><form className="method-controls" onSubmit={event => { event.preventDefault(); void state.connect(host.trim(), port) }}><div className="connection-fields manual-fields"><label>Device IP address<input required value={host} onChange={e => setHost(e.target.value)} placeholder="192.168.1.42" /></label><label>Connection port<input required value={port} onChange={e => setPort(e.target.value)} inputMode="numeric" placeholder="Port from phone" /></label><button className="button secondary" disabled={busy || !adbAvailable}><Cable size={14} />Connect address</button></div></form></article>
      <FastbootDevices />
    </div>
    <div className="subsection-heading"><h2><History size={16} />Known devices</h2><button className="button secondary" disabled={busy || !adbAvailable} onClick={() => setFindDevice(true)}><RefreshCw size={14} />Find devices</button></div>
    <div ref={knownList} className="known-devices" role="region" aria-label="Known devices list" tabIndex={0}>{known.length ? known.map(device => <div className={`known-device ${selectedDeviceId === device.id ? 'selected' : ''}`} key={device.id}><button className="device-select" aria-label={`Select ${device.name}`} aria-pressed={selectedDeviceId === device.id} onClick={() => state.selectDevice(device.id)}><Smartphone size={22} /><span><strong>{device.name}{activeDeviceId === device.id && <span className="active-device-label"><Check size={10} />Active</span>}</strong><span>{device.method} · {device.endpoint} · {new Date(device.lastSeen).toLocaleString('en-US')}</span></span></button><ConnectionStatus status={device.status} /><div className="known-device-actions"><button className="button secondary" disabled={busy || !adbAvailable} onClick={() => void state.reconnect(device.id)}><RefreshCw size={13} />Reconnect</button>{device.status === 'connected' && <button className="button secondary" disabled={busy || !device.canDetach} title={device.canDetach ? "Disconnect this device" : "Unplug the USB cable or close the emulator"} onClick={() => void state.disconnect(device.id)}><Unplug size={13} />Disconnect</button>}{['disconnected', 'offline'].includes(device.status) && <button className="button secondary" disabled={busy} aria-label={`Forget ${device.name}`} title="Remove from ADB Vault history only. Phone pairing is unchanged." onClick={() => setForgetDevice(device)}><Trash2 size={13} />Forget</button>}</div>{device.status === 'connected' && device.method === 'USB' && !device.canDetach && <p className="connection-transport-hint">USB: Disconnect is unavailable with this ADB backend. Unplug the cable or disable USB debugging on the phone.</p>}</div>) : <p className="empty-device-list">No connection history yet.</p>}</div>
    <p className="workspace-footnote">USB devices are monitored automatically. Wireless ports may change after restarting Wireless debugging. Pairing codes and QR secrets are never saved.</p>
    {forgetDevice && <ForgetDeviceDialog device={forgetDevice} close={() => setForgetDevice(null)} />}
    {findDevice && <ReconnectDeviceDialog close={() => setFindDevice(false)} onUsed={() => knownList.current?.scrollTo({ top: 0 })} />}
  </section>
}
