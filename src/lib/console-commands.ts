import { t } from "./i18n"
import type { ConsoleMode } from '../../electron/adb-console-protocol'

export interface ConsoleCommand {
  label: string
  category: string
  description: string
  shell: string
  adb?: string
}

export const consoleCommands: ConsoleCommand[] = [
  { get label() { return t("Device model") }, get category() { return t("Device") }, get description() { return t("Shows the model name reported by the phone. Useful for identifying the connected device.") }, shell: 'getprop ro.product.model' },
  { get label() { return t("Android version") }, get category() { return t("Device") }, get description() { return t("Shows the installed Android release, such as 15 or 16.") }, shell: 'getprop ro.build.version.release' },
  { get label() { return t("Security patch") }, get category() { return t("Device") }, get description() { return t("Shows the Android security patch date reported by the installed system.") }, shell: 'getprop ro.build.version.security_patch' },
  { get label() { return t("CPU architecture") }, get category() { return t("Device") }, get description() { return t("Lists supported application architectures, such as arm64-v8a. Useful when choosing an APK variant.") }, shell: 'getprop ro.product.cpu.abilist' },
  { get label() { return t("System properties") }, get category() { return t("Device") }, get description() { return t("Lists Android system properties, including build, hardware and configuration details.") }, shell: 'getprop' },
  { get label() { return t("Uptime") }, get category() { return t("Device") }, get description() { return t("Shows how long the phone has been running since its last restart, with system load averages.") }, shell: 'uptime' },
  { get label() { return t("Battery") }, get category() { return t("Resources") }, get description() { return t("Shows charge level, charging source, health, voltage and temperature. Temperature is reported in tenths of a degree Celsius.") }, get shell() { return "dumpsys battery" } },
  { get label() { return t("Memory summary") }, get category() { return t("Resources") }, get description() { return t("Shows system RAM usage and memory consumed by running processes. Useful when investigating high memory use.") }, get shell() { return "dumpsys meminfo" } },
  { get label() { return t("Storage space") }, get category() { return t("Resources") }, get description() { return t("Shows used and available space for app data and shared storage. These paths may share the same underlying storage.") }, shell: 'df -h /data /sdcard' },
  { get label() { return t("Installed apps") }, get category() { return t("Applications") }, get description() { return t("Lists installed package identifiers, including system and third-party apps.") }, get shell() { return "pm list packages" } },
  { get label() { return t("User apps") }, get category() { return t("Applications") }, get description() { return t("Lists third-party package identifiers, excluding system apps.") }, get shell() { return "pm list packages -3" } },
  { get label() { return t("Disabled apps") }, get category() { return t("Applications") }, get description() { return t("Lists package identifiers currently marked as disabled.") }, get shell() { return "pm list packages -d" } },
  { get label() { return t("Screen resolution") }, get category() { return t("Display & network") }, get description() { return t("Shows the physical display resolution and any active size override. Does not change the resolution.") }, get shell() { return "wm size" } },
  { get label() { return t("Screen density") }, get category() { return t("Display & network") }, get description() { return t("Shows the display density in DPI and any active override. Does not change display scaling.") }, get shell() { return "wm density" } },
  { get label() { return t("IP addresses") }, get category() { return t("Display & network") }, get description() { return t("Lists network interfaces and their assigned IP addresses. Useful for checking Wi-Fi or USB networking.") }, get shell() { return "ip -o addr show" } },
  { get label() { return t("Network routes") }, get category() { return t("Display & network") }, get description() { return t("Shows routes in the main IPv4 routing table. Android may keep additional routes in other tables.") }, get shell() { return "ip route" } },
  { get label() { return t("Recent logs") }, get category() { return t("Diagnostics") }, get description() { return t("Reads the latest 100 records from the default Logcat buffers and exits. Useful for a quick look at recent system and app messages.") }, shell: 'logcat -d -t 100', adb: 'logcat -d -t 100' },
  { get label() { return t("Crash logs") }, get category() { return t("Diagnostics") }, get description() { return t("Reads the latest 100 available records from the crash buffer and exits. The buffer may be empty or older records may have been overwritten.") }, get shell() { return "logcat -b crash -d -t 100" }, get adb() { return "logcat -b crash -d -t 100" } },
  { get label() { return t("Activity state") }, get category() { return t("Diagnostics") }, get description() { return t("Shows Android activity and task state, including foreground and recent app activities. Useful for checking which screen is open.") }, get shell() { return "dumpsys activity activities" } },
  { get label() { return t("System services") }, get category() { return t("Diagnostics") }, get description() { return t("Lists system services that can provide diagnostic information through dumpsys.") }, shell: 'dumpsys -l' },
]

export const quickConsoleCommands = ['Device model', 'Android version', 'Battery', 'Recent logs']
  .map(label => consoleCommands.find(command => command.label === label)!)

export function consoleCommandText(command: ConsoleCommand, mode: ConsoleMode) {
  return mode === 'adb' ? command.adb ?? `shell ${command.shell}` : command.shell
}
