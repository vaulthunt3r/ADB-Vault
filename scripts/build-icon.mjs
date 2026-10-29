import fs from 'node:fs/promises'
import { chromium } from '@playwright/test'

const svg = await fs.readFile('public/app-icon.svg', 'utf8')
const sizes = [16, 24, 32, 48, 64, 128, 256]
const browser = await chromium.launch({ headless: true })
const images = []
try {
  for (const size of sizes) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
    await page.setContent(`<style>html,body{margin:0;width:100%;height:100%;background:transparent}svg{display:block;width:100%;height:100%}</style>${svg}`)
    images.push(await page.screenshot({ omitBackground: true }))
    await page.close()
  }
} finally { await browser.close() }
const header = Buffer.alloc(6 + sizes.length * 16)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(sizes.length, 4)
let offset = header.length
for (const [index, size] of sizes.entries()) {
  const entry = 6 + index * 16
  header[entry] = size === 256 ? 0 : size
  header[entry + 1] = size === 256 ? 0 : size
  header.writeUInt16LE(1, entry + 4)
  header.writeUInt16LE(32, entry + 6)
  header.writeUInt32LE(images[index].length, entry + 8)
  header.writeUInt32LE(offset, entry + 12)
  offset += images[index].length
}
await fs.mkdir('build', { recursive: true })
await fs.writeFile('build/icon.ico', Buffer.concat([header, ...images]))
await fs.writeFile('public/app-icon.png', images.at(-1))
console.log('Created Windows ICO at 16–256 px and application PNG from the existing ADB Vault mark.')
