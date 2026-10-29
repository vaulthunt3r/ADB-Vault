import { access, copyFile, cp, mkdir } from 'node:fs/promises'
await access('dist-electron/preload.cjs')
await mkdir('dist-electron/data', { recursive: true })
await copyFile('electron/screen-pin.html', 'dist-electron/screen-pin.html')
await copyFile('electron/data/NOTICE.md', 'dist-electron/data/NOTICE.md')

await cp('electron/data/app-manager', 'dist-electron/data/app-manager', { recursive: true })
