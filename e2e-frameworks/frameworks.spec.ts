import { expect, test, type Page } from '@playwright/test'

/**
 * One pass per framework in the matrix INTEGRATING.md promises. The unit suite
 * covers SSR with a synthetic renderToString; this covers the part that only a
 * real framework build can show — that the client directive survives the
 * bundler, that a server-rendered tree hydrates, and that an edit made in the
 * browser is still there after a reload.
 */

/** Open the editor the way a real user does, and wait for it to mount. */
async function openEditor(page: Page) {
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+e' : 'Control+e')
  await expect(page.locator('.vedit-toolbar')).toBeVisible({ timeout: 20_000 })
}

/** The heading inside the artboard, whichever frame the canvas put it in. */
function heading(page: Page) {
  const frame = page.frames().find((candidate) => candidate.url().includes('vedit-canvas'))
  return (frame ?? page).locator('[data-vedit-id="hero-title"]')
}

test.describe('framework matrix', () => {
  test('server-renders the editable markup', async ({ page }) => {
    const response = await page.goto('/')
    const html = await response!.text()

    // Asserted against the raw response, before any hydration: this is the
    // check that the markup came from the server and not from React booting.
    expect(html).toContain('data-vedit-id="hero-title"')
    expect(html).toContain('data-vedit-id="hero-body"')
  })

  test('hydrates without console errors', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    page.on('pageerror', (error) => errors.push(String(error)))

    await page.goto('/', { waitUntil: 'networkidle' })
    await expect(heading(page)).toBeVisible()

    expect(errors).toEqual([])
  })

  test('opens the editor and persists an edit across a reload', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    await page.evaluate(() => localStorage.clear())
    await page.reload({ waitUntil: 'networkidle' })

    await openEditor(page)

    await heading(page).click()
    await expect(page.locator('.vedit-rect-selected')).toHaveCount(1)

    // Copy is rewritten through the inspector, not by typing on the canvas.
    await page.locator('.vedit-right textarea').first().fill('Edited by the framework suite')
    await expect(heading(page)).toHaveText('Edited by the framework suite')

    // Autosave is off by default, so the save is explicit — waiting on the
    // confirmation keeps the reload below from racing the write. These apps use
    // the default localStorage store, which has no draft/publish split, so the
    // button reads "Save changes" rather than "Save draft".
    await page.locator('.vedit-toolbar button:has-text("Save changes")').click()
    await expect(page.locator('.vedit-toolbar button:has-text("Saved")')).toBeVisible()

    // The point of the test: leave the editor entirely and come back.
    await page.reload({ waitUntil: 'networkidle' })
    await expect(heading(page)).toHaveText('Edited by the framework suite', { timeout: 15_000 })
  })
})
