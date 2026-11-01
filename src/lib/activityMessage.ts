// Presentation only: the saved event, clipboard and export keep the original output.
export function activityMessageSummary(message: string): string {
  const lines = message.split(/\r?\n/).map(line => line.trim()).filter(line => line
    && !/^Exception occurred while executing\b/i.test(line)
    && !/^(?:at\s+)?[\w.$]+\([^)]*(?:\.java:\d+|Native Method|Unknown Source)[^)]*\)/.test(line)
    && !/^(?:at\s+|\.\.\. \d+ more|[.…]*\s*\[output truncated\])/.test(line))
  const cause = [...lines].reverse().find(line => /^Caused by:/i.test(line))
  const exception = lines.find(line => /^(?:[\w$]+\.)*[\w$]*(?:Exception|Error):\s*\S/.test(line))
  const reason = (cause || exception || lines.slice(0, 2).join(' '))
    .replace(/^Caused by:\s*/i, '').replace(/^(?:[\w$]+\.)*[\w$]*(?:Exception|Error):\s*/, '').trim()
  if (/^Cannot disable system packages\.?$/i.test(reason)) return "The phone’s firmware blocked disabling this system application through ADB."
  if (/^Cannot disable a protected package\b/i.test(reason)) return "Android blocked disabling this protected application."
  if (/does not have permission android\.permission\.CLEAR_APP_USER_DATA\b/i.test(reason)) return "Android denied ADB permission to clear this application’s data. Check the phone’s debugging permissions."
  if (!reason) return "No readable reason was recorded. See the original output in Operation details below."
  return reason.length > 360 ? `${reason.slice(0, 359).trimEnd()}…` : reason
}
