import { expect, test, type Page } from '@playwright/test'
import { artboard, openEditor, select } from './fixtures'

/**
 * The pricing page's three plan cards come from one `repeat` over the host's own
 * array. What matters here is the thing the unit tests can't show: that clicking
 * a card in a real editor edits the template, and that the inspector can scope
 * that to one card.
 */

const board = (page: Page) => artboard(page, '/pricing')

/** The rendered text of one card's name, by plan key. */
function planName(page: Page, key: string) {
  return board(page).locator(`[data-vedit-id="pricing.plan.name~${key}"]`)
}

async function openPricing(page: Page) {
  await openEditor(page, { path: '/pricing' })
}

test.describe('repeating over data', () => {
  test('each item renders with its own id and its own values', async ({ page }) => {
    await openPricing(page)

    // Keyed by the plan's own id, not by position: this is what makes an edit
    // survive the array being reordered.
    await expect(planName(page, 'starter')).toHaveText('Starter')
    await expect(planName(page, 'team')).toHaveText('Team')
    await expect(planName(page, 'agency')).toHaveText('Agency')
  })

  test('editing one card changes them all', async ({ page }) => {
    await openPricing(page)
    await select(page, 'pricing.plan.name~team', '/pricing')

    // The default scope is the whole repeat, so this one edit reaches all three.
    await page.locator('.vedit-right textarea').first().fill('{name} plan')

    await expect(planName(page, 'starter')).toHaveText('Starter plan')
    await expect(planName(page, 'team')).toHaveText('Team plan')
    await expect(planName(page, 'agency')).toHaveText('Agency plan')
  })

  test('scoping an edit to one card leaves the others alone', async ({ page }) => {
    await openPricing(page)
    await select(page, 'pricing.plan.name~team', '/pricing')

    await page.locator('.vedit-right button:has-text("This one")').click()
    await page.locator('.vedit-right textarea').first().fill('Most popular')

    await expect(planName(page, 'team')).toHaveText('Most popular')
    await expect(planName(page, 'starter')).toHaveText('Starter')
    await expect(planName(page, 'agency')).toHaveText('Agency')
  })

  test('a card with its own edit says so, and can be put back', async ({ page }) => {
    await openPricing(page)
    await select(page, 'pricing.plan.name~team', '/pricing')

    await page.locator('.vedit-right button:has-text("This one")').click()
    await page.locator('.vedit-right textarea').first().fill('Most popular')

    // Back to editing all of them: the panel has to admit that this card won't
    // follow, rather than letting a template edit look like it did nothing.
    await page.locator('.vedit-right button:has-text("All 3")').click()
    await expect(page.locator('.vedit-right')).toContainText('has its own edit')

    await page.locator('.vedit-right button:has-text("Reset it to the template")').click()
    await expect(planName(page, 'team')).toHaveText('Team')
  })

  test('the repeating element itself is not a node on the page', async ({ page }) => {
    await openPricing(page)
    // A repeat is a loop, not a box — it must not add a wrapper to the host's grid.
    await expect(board(page).locator('[data-vedit-id="pricing.plans"]')).toHaveCount(0)
  })

  test('the layers panel names items without their keys', async ({ page }) => {
    await openPricing(page)
    // `Name~team` is machinery leaking into the UI; the tree position already
    // says which card this is.
    await expect(page.locator('.vedit-left [role="treeitem"]', { hasText: '~' })).toHaveCount(0)
  })
})
