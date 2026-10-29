// Explicitly invoked to refresh public artwork with demonstration data.
import { test } from '@playwright/test'
import { captureShowcase } from './showcase-capture'
import { renderShowcase } from '../scripts/render-showcase.mjs'

test('capture public documentation cards using fixture data only', async ({ page, browser }) => {
  test.setTimeout(120_000)
  await captureShowcase(page)
  const artwork = await browser.newPage({ viewport: { width: 1600, height: 1120 }, deviceScaleFactor: 1 })
  await renderShowcase(artwork)
  await artwork.close()
})
