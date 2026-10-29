type LaunchShell = (args: string[], timeout?: number) => Promise<string>

function componentsFrom(output: string, packageName: string) {
  return [...new Set(output.split(/\r?\n/).map(line => line.trim()).filter(line => line.startsWith(`${packageName}/`) && /^[A-Za-z0-9_.$]+\/[A-Za-z0-9_.$]+$/.test(line)))]
}

export async function launchApplication(packageName: string, userId: number, shell: LaunchShell) {
  const user = String(userId)
  // A system module can expose MAIN/DEFAULT without a launcher icon (for example Health Connect).
  // Auxiliary entry screens must be unambiguous: never pick an arbitrary settings page.
  const entries = [
    ...['INFO', 'LAUNCHER', 'LEANBACK_LAUNCHER'].map(category => ({ action: 'MAIN', category, unique: false })),
    { action: 'MAIN', category: 'DEFAULT', unique: true },
    { action: 'APPLICATION_PREFERENCES', category: 'DEFAULT', unique: true },
  ]
  let ambiguous = false
  for (const entry of entries) {
    const intent = ['-a', `android.intent.action.${entry.action}`, '-c', `android.intent.category.${entry.category}`]
    let output: string
    try {
      // Query actual entry points: resolve-activity can return Android's chooser when an app has several.
      output = await shell(['cmd', 'package', 'query-activities', '--brief', '--components', '--user', user, ...intent, '-p', packageName])
      if (/unknown command|unknown option|not supported/i.test(output)) throw new Error(output)
    } catch (error) {
      if (!/unknown command|unknown option|not supported/i.test(error instanceof Error ? error.message : String(error))) throw error
      output = await shell(['cmd', 'package', 'resolve-activity', '--brief', '--user', user, ...intent, '-p', packageName])
    }
    const components = componentsFrom(output, packageName)
    if (entry.unique && components.length > 1) { ambiguous = true; continue }
    const component = components[0]
    if (!component) continue
    const started = await shell(['am', 'start', '-W', '--user', user, ...intent, '-f', '0x10200000', '-n', component], 30000)
    if (!/^\s*Status:\s*ok\s*$/im.test(started)) throw new Error(`Android did not confirm the launch in profile ${user}. ${started.trim().slice(0, 900) || 'No launch status was returned.'}`)
    return component
  }
  throw new Error(ambiguous
    ? `This application exposes several auxiliary screens in profile ${user}, but no single launch entry. Open app settings to manage it.`
    : `No launchable screen is available for this application in profile ${user}. Android exposes no enabled launcher, standalone main screen or preferences screen. Service packages may only open as part of another app or system feature. Use Open app settings to manage this package.`)
}
