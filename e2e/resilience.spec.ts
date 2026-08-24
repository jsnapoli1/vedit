import { expect, test } from '@playwright/test'
import { artboard, openEditor } from './fixtures'

/**
 * The provider wraps the host's app, so an unguarded throw inside the editor
 * would unmount their site. These check that the blast radius stops at the
 * editor.
 */
test.describe('when the editor breaks', () => {
  test('the host page survives, and says what happened', async ({ page }) => {
    await openEditor(page)
    await expect(page.locator('.vedit-artboard')).toHaveCount(2)

    // Break something the inspector calls while rendering.
    await artboard(page).evaluate(() => {
      const canvas = window as unknown as { __veditCanvas: { store: { getNode: unknown } } }
      canvas.__veditCanvas.store.getNode = () => {
        throw new Error('deliberate failure inside the inspector')
      }
    })
    await artboard(page).locator('[data-vedit-id="home.hero.title"]').click()

    await expect(page.locator('.vedit-root')).toHaveCount(0)
    await expect(page.locator('.vedit-canvas')).toHaveCount(0)

    // The site itself is untouched and still interactive.
    await expect(page.locator('.nav .brand')).toHaveText('Northwind')
    await expect(page.locator('.hero h1')).toBeVisible()
    await expect(page.locator('html')).not.toHaveClass(/vedit-canvas-host/)

    const alert = page.getByRole('alert')
    await expect(alert).toContainText('The editor hit an error and closed')
    await expect(alert).toContainText('deliberate failure inside the inspector')
  })

  test('dismissing the notice hands the page back cleanly', async ({ page }) => {
    await openEditor(page)
    await artboard(page).evaluate(() => {
      const canvas = window as unknown as { __veditCanvas: { store: { getNode: unknown } } }
      canvas.__veditCanvas.store.getNode = () => {
        throw new Error('boom')
      }
    })
    await artboard(page).locator('[data-vedit-id="home.hero.title"]').click()

    await page.getByRole('alert').getByRole('button', { name: 'Dismiss' }).click()
    await expect(page.getByRole('alert')).toHaveCount(0)
    // The host's own toggle is back in its "closed" state, not stuck open.
    await expect(page.getByRole('button', { name: 'Edit page' })).toBeVisible()

    await page.locator('.nav-links a', { hasText: 'Pricing' }).click()
    await expect(page).toHaveURL(/\/pricing/)
  })

  test('reopening starts the editor again from scratch', async ({ page }) => {
    await openEditor(page)
    await artboard(page).evaluate(() => {
      const canvas = window as unknown as { __veditCanvas: { store: { getNode: unknown } } }
      canvas.__veditCanvas.store.getNode = () => {
        throw new Error('a failure in one session')
      }
    })
    await artboard(page).locator('[data-vedit-id="home.hero.title"]').click()
    await expect(page.getByRole('alert')).toBeVisible()

    // The frames went with the editor, so reopening builds fresh ones — the
    // broken store included.
    await page.getByRole('alert').getByRole('button', { name: 'Reopen' }).click()
    await expect(page.locator('.vedit-toolbar')).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.locator('.vedit-artboard')).toHaveCount(2)

    await page.waitForTimeout(1500)
    await artboard(page).locator('[data-vedit-id="home.hero.title"]').click()
    await expect(page.locator('.vedit-rect-selected')).toHaveCount(1)
  })
})
