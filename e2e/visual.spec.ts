import { expect, test, type Locator, type Page } from '@playwright/test'
import { artboard, openEditor, select } from './fixtures'

/**
 * Two kinds of check, because they catch different things.
 *
 * The screenshots catch anything that changes how the chrome looks, and depend
 * on the browser build (pinned by the `@playwright/test` version) and on font
 * rasterisation (pinned by running CI in the matching container).
 *
 * The layout invariants below catch the failures that actually happened while
 * this was built — a panel covering the controls behind it, tab labels clipped
 * to nonsense — and hold on any machine, because they are about geometry rather
 * than pixels.
 */

/** Things that legitimately differ run to run and would make a baseline flap. */
function unstable(page: Page): Locator[] {
  return [
    // Measured artboard heights, and "just now" on a comment.
    page.locator('.vedit-artboard-label'),
    page.locator('.vedit-comment em, .vedit-comment-head em'),
  ]
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(400)
  await expect(page).toHaveScreenshot(name, { mask: unstable(page) })
}

test.describe('how it looks', () => {
  test('the site, with nobody editing', async ({ page }) => {
    await page.goto('/?as=Sam', { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => localStorage.clear())
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.locator('.hero h1')).toBeVisible()
    await shot(page, 'site-view-mode.png')
  })

  test('the editor with an element selected', async ({ page }) => {
    await openEditor(page)
    await select(page, 'home.hero.title')
    await shot(page, 'editor-selected.png')
  })

  test('the inspector for an image', async ({ page }) => {
    await openEditor(page)
    await select(page, 'home.hero.art')
    await shot(page, 'inspector-image.png')
  })

  test('the inspector for a component, in its hover state', async ({ page }) => {
    await openEditor(page)
    await select(page, 'home.hero.cta')
    await page.locator('.vedit-right .vedit-segmented button:has-text("Hover")').click()
    await shot(page, 'inspector-component-hover.png')
  })

  test('the tokens panel', async ({ page }) => {
    await openEditor(page)
    await page.locator('.vedit-left .vedit-tabs button:has-text("Tokens")').click()
    await page.locator('.vedit-left .vedit-section:has-text("Colors") button[title*="Add"]').click()
    await shot(page, 'panel-tokens.png')
  })

  test('the checks panel', async ({ page }) => {
    await openEditor(page)
    await page.locator('.vedit-left .vedit-tabs button:has-text("Checks")').click()
    await expect(page.locator('.vedit-issue-summary')).toBeVisible()
    await shot(page, 'panel-checks.png')
  })

  test('a comment thread', async ({ page }) => {
    await openEditor(page)
    await page.keyboard.press('c')
    await artboard(page).locator('[data-vedit-id="home.hero.title"]').click()
    await page.locator('.vedit-thread textarea').fill('Too long on mobile')
    await page.locator('.vedit-thread button:has-text("Comment")').click()
    await page.locator('.vedit-pin').click()
    await shot(page, 'comment-thread.png')
  })

  test('a mobile artboard', async ({ page }) => {
    await openEditor(page)
    await page.locator('.vedit-toolbar button[data-breakpoint="sm"]').click()
    await page.waitForTimeout(900)
    await shot(page, 'artboard-mobile.png')
  })
})

test.describe('layout invariants', () => {
  test('the toolbar never slides under a panel', async ({ page }) => {
    await openEditor(page)
    const toolbar = (await page.locator('.vedit-toolbar').boundingBox())!
    const left = (await page.locator('.vedit-left').boundingBox())!
    const right = (await page.locator('.vedit-right').boundingBox())!

    expect(toolbar.x).toBeGreaterThanOrEqual(left.x + left.width)
    expect(toolbar.x + toolbar.width).toBeLessThanOrEqual(right.x)
  })

  test('every toolbar control is reachable', async ({ page }) => {
    await openEditor(page)
    const buttons = page.locator('.vedit-toolbar button')
    const count = await buttons.count()
    expect(count).toBeGreaterThan(10)

    for (let index = 0; index < count; index += 1) {
      const button = buttons.nth(index)
      const box = (await button.boundingBox())!
      const label = (await button.getAttribute('title')) ?? (await button.innerText())
      // Whatever sits at the middle of a button must be that button.
      const onTop = await page.evaluate(
        (point) => {
          const element = document.elementFromPoint(point.x, point.y)
          if (!element) return 'nothing'
          // A disabled control isn't a hit target in Chrome, so ask which panel
          // owns the point rather than which button — the invariant is that
          // nothing else has been laid over the toolbar.
          const panel = element.closest('.vedit-panel')
          if (!panel) return element.className || element.tagName
          return panel.classList.contains('vedit-toolbar') ? 'toolbar' : 'another panel'
        },
        { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      )
      expect(onTop, `toolbar control "${label}" is covered`).toBe('toolbar')
    }
  })

  test('no panel label is clipped by its container', async ({ page }) => {
    await openEditor(page)
    await select(page, 'home.hero.title')

    for (const selector of ['.vedit-tabs button', '.vedit-label', '.vedit-panel-head span']) {
      const clipped = await page.locator(selector).evaluateAll((elements) =>
        elements
          .filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).textOverflow === 'ellipsis')
          .map((el) => el.textContent),
      )
      // Ellipsis on a node label is deliberate; on a fixed UI label it is a bug.
      if (selector !== '.vedit-panel-head span') expect(clipped, selector).toEqual([])
    }
  })

  test('the panels leave room for the artboards', async ({ page }) => {
    await openEditor(page)
    const first = (await page.locator('.vedit-artboard iframe').first().boundingBox())!
    const left = (await page.locator('.vedit-left').boundingBox())!
    expect(first.x).toBeGreaterThanOrEqual(left.x + left.width)
  })

  test('collapsing the panels gives the whole window to the canvas', async ({ page }) => {
    await openEditor(page)
    await page.keyboard.press('\\')
    await expect(page.locator('.vedit-left')).toBeHidden()
    const toolbar = (await page.locator('.vedit-toolbar').boundingBox())!
    const viewport = page.viewportSize()!
    // Centred on the window once nothing is in the way.
    expect(Math.abs(toolbar.x + toolbar.width / 2 - viewport.width / 2)).toBeLessThan(4)
  })
})
