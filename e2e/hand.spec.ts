import { expect, test } from '@playwright/test'
import { artboard, openEditor, select } from './fixtures'

/**
 * The hand tool is how the page gets put into a state the editor did not load
 * it in: a click goes through to the site's own controls, and whatever they
 * reveal can then be selected like anything else. Links stay inert throughout.
 */
test.describe('working the page with the hand tool', () => {
  test('a hand click reaches the page, and the revealed element can be selected', async ({ page }) => {
    await openEditor(page, { path: '/pricing' })
    const board = artboard(page, '/pricing')
    const note = board.locator('[data-vedit-id="pricing.yearly-note"]')
    await expect(note).toHaveCount(0)

    // With the select tool the toggle is just another element: it selects and
    // never fires.
    await board.getByRole('button', { name: 'Yearly' }).click()
    await expect(page.locator('.vedit-rect-selected')).toHaveCount(1)
    await expect(note).toHaveCount(0)

    await page.keyboard.press('h')
    await board.getByRole('button', { name: 'Yearly' }).click()
    await expect(note).toBeVisible()
    await expect(board.getByRole('button', { name: 'Yearly' })).toHaveAttribute('aria-pressed', 'true')

    await page.keyboard.press('v')
    await select(page, 'pricing.yearly-note', '/pricing')
    await expect(page.locator('.vedit-right .vedit-panel-head span').first()).toHaveText('Yearly note')
  })

  test('a hand click on a link does not navigate', async ({ page }) => {
    await openEditor(page, { path: '/pricing' })
    const board = artboard(page, '/pricing')

    await page.keyboard.press('h')
    await board.locator('.nav-links a', { hasText: 'Home' }).click()
    await page.waitForTimeout(500)

    expect(new URL(board.url()).pathname).toBe('/pricing')
    await expect(page).toHaveURL(/\/pricing/)
  })
})
