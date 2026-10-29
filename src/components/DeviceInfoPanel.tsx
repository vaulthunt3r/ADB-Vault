import { locale as uiLocale } from '../lib/i18n'
import { message } from "../lib/i18n"
import { t } from "../lib/i18n"
import { useEffect } from 'react'
import type { DeviceRecord, DeviceInfo } from '../../electron/contracts'
import { readDeviceInfo } from '../store/useConnectionStore'

const groups: { label: string; fields: [keyof DeviceInfo['fields'], string][] }[] = [
  { get label() { return t("Device & hardware") }, fields: [['manufacturer', "Manufacturer"], ['model', "Model"], ['product', "Product"], ['codename', "Device codename"], ['socManufacturer', "SoC manufacturer"], ['socModel', "SoC model"], ['board', "Board"], ['hardware', "Hardware"], ['abis', "CPU architectures"]] },
  { get label() { return t("Android & build") }, fields: [['sdk', "Android API"], ['securityPatch', "Security patch"], ['build', "Build"], ['buildDate', "Build date"], ['buildType', "Build type"], ['buildTags', "Build tags"], ['fingerprint', "Build fingerprint"]] },
  { get label() { return t("Boot & radio") }, fields: [['bootloader', "Bootloader version"], ['baseband', "Baseband version"], ['bootloaderState', "Bootloader state"], ['verifiedBoot', "Verified Boot"], ['slot', "Current slot"]] },
]
function displayValue(key: keyof DeviceInfo['fields'], value?: string) {
  if (!value) return t("Unavailable")
  if (key === 'buildDate' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value))) return new Date(value).toLocaleString(uiLocale())
  if (key === 'bootloaderState') return value === 'locked' ? t("Locked") : value === 'unlocked' ? t("Unlocked") : value
  if (key === 'verifiedBoot') return new Map([['green', t("Green · verified")], ['yellow', t("Yellow · custom key")], ['orange', t("Orange · unlocked")], ['red', t("Red · verification failed")]]).get(value) || value
  return value
}
export function DeviceInfoPanel({ device }: { device: DeviceRecord }) {
  const info = device.info
  useEffect(() => { if (device.status === 'connected' && !info) void readDeviceInfo(device.id) }, [device.id, device.serial, device.transportId, device.hardwareId, device.status, info?.status])
  return <div className="diagnostics-panel" aria-label={t("Device and firmware")}><div className="diagnostics-heading"><h3>{t("Device & firmware")}</h3></div>
    {info?.status === 'loading' && <p role="status">{t("Reading device properties…")}</p>}
    {info?.collectedAt && <p className="diagnostics-timestamp">{device.status === 'connected' ? t("Read") : t("Last read")} {new Date(info.collectedAt).toLocaleString(uiLocale())}</p>}
    {info?.status === 'error' && <p className="diagnostics-issue">{message(info.error)}</p>}
    {device.status !== 'connected' && <p className="component-description">{t("Connect and authorize the device to read current properties.")}</p>}
    {groups.map(group => <section className="device-info-group" aria-label={group.label} key={group.label}><h4>{group.label}</h4><dl className="diagnostics-fields">{group.fields.map(([key, label]) => <div key={key}><dt>{t(label)}</dt><dd>{displayValue(key, info?.fields[key])}</dd></div>)}</dl></section>)}
    <p className="component-description">{t("Reported by the phone. Fields not exposed by this firmware are unavailable.")}</p>
  </div>
}
