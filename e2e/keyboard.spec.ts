import { expect, test, type Page } from '@playwright/test'
import { artboard, openEditor } from './fixtures'

/** What has focus right now, as something a failure message can be read from. */
function focused(page: Page) {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null
    if (!element) return 'nothing'
    const label = element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 24) ?? ''
    return `${element.tagName.toLowerCase()}.${element.className || '-'}${label ? ` "${label}"` : ''}`
  })
}

/** Tab until the predicate matches, so a test doesn't hard-code how many stops there are. */
async function tabUntil(page: Page, matches: (description: string) => boolean, limit = 40) {
  for (let step = 0; step < limit; step += 1) {
    await page.keyboard.press('Tab')
    const where = await focused(page)
    if (matches(where)) return where
  }
  throw new Error(`Never reached it in ${limit} tabs; focus ended on ${await focused(page)}`)
}

test.describe('driving the editor from a keyboard', () => {
  test('opening the editor puts focus in the chrome, and Tab reaches the panels', async ({ page }) => {
    await openEditor(page)

    expect(await focused(page)).toContain('vedit-toolbar')

    // The toolbar's own controls come first, then the panels.
    const tool = await tabUntil(page, (where) => where.includes('Select'))
    expect(tool).toContain('button')

    await tabUntil(page, (where) => where.includes('Layers'))
  })

  test('the layers tree is one tab stop, walked with the arrow keys', async ({ page }) => {
    await openEditor(page)

    await page.locator('.vedit-layer').first().focus()
    const first = await focused(page)
    await page.keyboard.press('ArrowDown')
    const second = await focused(page)
    expect(second).not.toBe(first)

    await page.keyboard.press('ArrowUp')
    expect(await focused(page)).toBe(first)

    // Every row but the focused one is out of the tab sequence.
    const inSequence = await page.locator('.vedit-layer[tabindex="0"]').count()
    expect(inSequence).toBe(1)
  })

  test('Enter on a layer selects it rather than starting an inline edit', async ({ page }) => {
    await openEditor(page)

    const row = page.locator('.vedit-layer', { hasText: 'Title' }).first()
    await row.focus()
    await page.keyboard.press('Enter')

    await expect(page.locator('.vedit-rect-selected')).toHaveCount(1)
    await expect(page.locator('.vedit-right .vedit-panel-head span').first()).toHaveText('Title')
    // The page element must not have gone into contenteditable behind the panel.
    await expect(artboard(page).locator('[data-vedit-inline="true"]')).toHaveCount(0)
  })

  test('the panel tabs move with the arrow keys and stay one tab stop', async ({ page }) => {
    await openEditor(page)

    await page.locator('.vedit-tabs button', { hasText: 'Layers' }).focus()
    await page.keyboard.press('ArrowRight')
    expect(await focused(page)).toContain('Tokens')

    await page.keyboard.press('Enter')
    await expect(page.locator('.vedit-tabs button[aria-selected="true"]')).toHaveText('Tokens')
    expect(await page.locator('.vedit-tabs button[tabindex="0"]').count()).toBe(1)
  })

  test('typing in the inspector does not fire the single-letter shortcuts', async ({ page }) => {
    await openEditor(page)
    await page.locator('.vedit-layer', { hasText: 'Title' }).first().focus()
    await page.keyboard.press('Enter')

    // Select what's there and type over it: the field is controlled, so clearing it
    // just re-renders the source copy back into place.
    const textarea = page.locator('.vedit-right textarea').first()
    await textarea.click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type('hire the right tool')

    await expect(textarea).toHaveValue('hire the right tool')
    // `h`, `t`, `i`, `r` are all tool shortcuts; the select tool must still be on.
    await expect(page.locator('.vedit-toolbar button[aria-label^="Select"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  test('a comment thread takes focus, keeps Tab inside it, and Escape closes it', async ({ page }) => {
    await openEditor(page)

    await page.keyboard.press('c')
    await artboard(page).locator('[data-vedit-id="home.hero.title"]').click()

    // The composer focuses its own field, so a note can be typed without a click.
    expect(await focused(page)).toContain('vedit-textarea')
    await page.keyboard.type('Reads well, too wide')
    await page.locator('.vedit-thread button:has-text("Comment")').click()
    await expect(page.locator('.vedit-pin')).toHaveCount(1)

    await page.locator('.vedit-pin').click()
    const inThread = await page.locator('.vedit-thread button, .vedit-thread textarea').count()
    for (let step = 0; step < inThread + 2; step += 1) {
      await page.keyboard.press('Tab')
      expect(
        await page.evaluate(() => !!document.activeElement?.closest('.vedit-thread')),
        'Tab left the open thread',
      ).toBe(true)
    }

    await page.keyboard.press('Escape')
    await expect(page.locator('.vedit-thread')).toHaveCount(0)
  })

  test('every control in the chrome has an accessible name', async ({ page }) => {
    await openEditor(page)

    const unnamed = await page.evaluate(() =>
      [...document.querySelectorAll('.vedit-root button')]
        .filter((button) => {
          const name =
            button.getAttribute('aria-label') ??
            button.getAttribute('title') ??
            button.textContent?.trim()
          return !name
        })
        .map((button) => button.className),
    )

    expect(unnamed).toEqual([])
  })
})
