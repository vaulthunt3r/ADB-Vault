import { rm } from 'node:fs/promises'

// tsc overwrites compiled modules but leaves files whose sources were removed.
await rm(new URL('../dist-electron/', import.meta.url), { recursive: true, force: true })
