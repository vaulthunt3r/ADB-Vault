import fs from 'node:fs/promises'
import path from 'node:path'

// Explicit publication boundary: personal work directories are never traversed.
const roots = ['.github', 'android-helper', 'build', 'docs', 'electron', 'public', 'scripts', 'src', 'tests', 'third-party-notices']
const rootFiles = ['.editorconfig', '.gitattributes', '.gitignore', 'LICENSE', 'NOTICE.md', 'README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'VERIFICATION.md', 'BADGES.md', 'DETECTION.md', 'index.html', 'package.json', 'package-lock.json', 'playwright.config.ts', 'tsconfig.json', 'tsconfig.electron.json', 'vite.config.ts']
const excluded = /^(?:build\/generated|android-helper\/build|scripts\/research)(?:\/|$)/
export async function sourceFiles(root = process.cwd()) {
  const result = [...rootFiles]
  async function walk(relative) {
    for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
      const file = `${relative}/${entry.name}`
      if (excluded.test(file)) continue
      if (entry.isSymbolicLink()) throw new Error(`Source links are not allowed: ${file}`)
      if (entry.isDirectory()) await walk(file)
      else if (entry.isFile()) result.push(file)
    }
  }
  for (const directory of roots) await walk(directory)
  return result.sort()
}
