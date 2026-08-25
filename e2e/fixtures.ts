import { expect, type Frame, type Page } from '@playwright/test'

/**
 * Every test starts from an empty store and a named editor, so nothing depends
 * on what a previous test left behind or on a randomly generated identity.
 */
export async function openEditor(page: Page, options: { as?: string; path?: string } = {}) {
  const query = new URLSearchParams({ as: options.as ?? 'Sam' })
  const url = `${options.path ?? '/'}?${query}`

  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'domcontentloaded' })

  await page.getByRole('button', { name: 'Edit page' }).click()
  await page.waitForSelector('.vedit-toolbar', { timeout: 15_000 })
  await expect(page.locator('.vedit-artboard iframe').first()).toBeVisible()
  // Wait for the artboards to hand over their stores and settle at a stable zoom.
  await expect
    .poll(() => page.locator('.vedit-artboard[data-active="true"]').count(), { timeout: 10_000 })
    .toBe(1)
  await page.waitForTimeout(800)
}

/** The artboard for a route, once its page has loaded inside the canvas. */
export function artboard(page: Page, path = '/'): Frame {
  const frames = page.frames().filter((frame) => frame.url().includes('vedit-canvas'))
  const match =
    path === '/'
      ? frames.find((frame) => new URL(frame.url()).pathname === '/')
      : frames.find((frame) => new URL(frame.url()).pathname.startsWith(path))
  if (!match) throw new Error(`No artboard for ${path}; have ${frames.map((f) => f.url()).join(', ')}`)
  return match
}

/** Select a node inside an artboard and wait for the inspector to catch up. */
export async function select(page: Page, id: string, path = '/') {
  await artboard(page, path).locator(`[data-vedit-id="${id}"]`).click()
  await expect(page.locator('.vedit-rect-selected')).toHaveCount(1)
  await page.waitForTimeout(250)
}

/** The inspector row whose label matches, inside a named section. */
export function inspectorRow(page: Page, section: string, label: string) {
  return page.locator(`.vedit-right .vedit-section:has-text("${section}") .vedit-row:has-text("${label}")`)
}

/**
 * The compact length inputs (Size, Line, W, H, padding sides…) sit in a grid
 * rather than a labelled row, and carry their label as a prefix inside the field.
 */
export function inspectorField(page: Page, section: string, label: string) {
  return page
    .locator(
      `.vedit-right .vedit-section:has-text("${section}") .vedit-field:has(.vedit-field-prefix:text-is("${label}"))`,
    )
    .locator('input')
    .first()
}
