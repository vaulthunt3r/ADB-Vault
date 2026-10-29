import fs from 'node:fs/promises'
import path from 'node:path'
const lock = JSON.parse(await fs.readFile('package-lock.json', 'utf8'))
const sections = []
for (const [directory, entry] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b, 'en'))) {
  if (!directory || entry.dev) continue
  const pkg = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'))
  if (pkg.version !== entry.version) throw new Error(`Installed version differs from lockfile: ${pkg.name}`)
  const names = (await fs.readdir(directory)).filter(n => /^(licen[cs]e|copying|notice)([.-]|$)/i.test(n)).sort()
  const texts = []
  if (pkg.name === '@nodable/entities' && pkg.version === '3.0.0' && !names.length) texts.push(await fs.readFile('third-party-notices/nodable-entities-LICENSE.txt', 'utf8'))
  for (const name of names) {
    const file = path.join(directory, name)
    if ((await fs.stat(file)).isFile()) texts.push(`${name}\n${(await fs.readFile(file, 'utf8')).replaceAll('\r\n', '\n').trim()}`)
  }
  if (!texts.length) throw new Error(`No licence file found for ${pkg.name}`)
  sections.push(`${pkg.name} ${pkg.version}\nLicence: ${typeof pkg.license === 'string' ? pkg.license : entry.license}\nPackage: https://www.npmjs.com/package/${pkg.name}/v/${pkg.version}\n\n${texts.join('\n\n')}`)
}
const text = `ADB Vault — third-party npm runtime dependencies\nGenerated from package-lock.json by scripts/generate-notices.mjs.\nRenderer dependencies are included even when bundled into JavaScript.\nElectron/Chromium, flags, themes, databases and other tools have separate notices; see NOTICE.md.\n\n${sections.join('\n\n' + '='.repeat(72) + '\n\n')}\n`
const output = 'third-party-notices/NPM-DEPENDENCIES.txt'
if (process.argv.includes('--check')) {
  if (await fs.readFile(output, 'utf8') !== text) throw new Error('npm notices are stale; run npm run notices:generate.')
} else await fs.writeFile(output, text)
console.log(`Verified ${sections.length} npm dependency notices.`)
