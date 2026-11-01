import type { ConsoleMode } from '../../electron/adb-console-protocol'

export interface ConsoleCommand {
  label: string
  category: string
  description: string
  shell: string
  adb?: string
}

export const consoleCommands: ConsoleCommand[] = [
  { label: "Device model", category: "Device", description: "Shows the model name reported by the phone. Useful for identifying the connected device.", shell: 'getprop ro.product.model' },
  { label: "Android version", category: "Device", description: "Shows the installed Android release, such as 15 or 16.", shell: 'getprop ro.build.version.release' },
  { label: "Security patch", category: "Device", description: "Shows the Android security patch date reported by the installed system.", shell: 'getprop ro.build.version.security_patch' },
  { label: "CPU architecture", category: "Device", description: "Lists supported application architectures, such as arm64-v8a. Useful when choosing an APK variant.", shell: 'getprop ro.product.cpu.abilist' },
  { label: "System properties", category: "Device", description: "Lists Android system properties, including build, hardware and configuration details.", shell: 'getprop' },
  { label: "Uptime", category: "Device", description: "Shows how long the phone has been running since its last restart, with system load averages.", shell: 'uptime' },
  { label: "Battery", category: "Resources", description: "Shows charge level, charging source, health, voltage and temperature. Temperature is reported in tenths of a degree Celsius.", shell: "dumpsys battery" },
  { label: "Memory summary", category: "Resources", description: "Shows system RAM usage and memory consumed by running processes. Useful when investigating high memory use.", shell: "dumpsys meminfo" },
  { label: "Storage space", category: "Resources", description: "Shows used and available space for app data and shared storage. These paths may share the same underlying storage.", shell: 'df -h /data /sdcard' },
  { label: "Installed apps", category: "Applications", description: "Lists installed package identifiers, including system and third-party apps.", shell: "pm list packages" },
  { label: "User apps", category: "Applications", description: "Lists third-party package identifiers, excluding system apps.", shell: "pm list packages -3" },
  { label: "Disabled apps", category: "Applications", description: "Lists package identifiers currently marked as disabled.", shell: "pm list packages -d" },
  { label: "Screen resolution", category: "Display & network", description: "Shows the physical display resolution and any active size override. Does not change the resolution.", shell: "wm size" },
  { label: "Screen density", category: "Display & network", description: "Shows the display density in DPI and any active override. Does not change display scaling.", shell: "wm density" },
  { label: "IP addresses", category: "Display & network", description: "Lists network interfaces and their assigned IP addresses. Useful for checking Wi-Fi or USB networking.", shell: "ip -o addr show" },
  { label: "Network routes", category: "Display & network", description: "Shows routes in the main IPv4 routing table. Android may keep additional routes in other tables.", shell: "ip route" },
  { label: "Recent logs", category: "Diagnostics", description: "Reads the latest 100 records from the default Logcat buffers and exits. Useful for a quick look at recent system and app messages.", shell: 'logcat -d -t 100', adb: 'logcat -d -t 100' },
  { label: "Crash logs", category: "Diagnostics", description: "Reads the latest 100 available records from the crash buffer and exits. The buffer may be empty or older records may have been overwritten.", shell: "logcat -b crash -d -t 100", adb: "logcat -b crash -d -t 100" },
  { label: "Activity state", category: "Diagnostics", description: "Shows Android activity and task state, including foreground and recent app activities. Useful for checking which screen is open.", shell: "dumpsys activity activities" },
  { label: "System services", category: "Diagnostics", description: "Lists system services that can provide diagnostic information through dumpsys.", shell: 'dumpsys -l' },
]

export const quickConsoleCommands = ['Device model', 'Android version', 'Battery', 'Recent logs']
  .map(label => consoleCommands.find(command => command.label === label)!)

export function consoleCommandText(command: ConsoleCommand, mode: ConsoleMode) {
  return mode === 'adb' ? command.adb ?? `shell ${command.shell}` : command.shell
}
