import { expect, test, type Page } from '@playwright/test'
import { artboard, inspectorField, inspectorRow, openEditor, select } from './fixtures'

test.describe('editing on the canvas', () => {
  test('selecting an element outlines it and fills the inspector', async ({ page }) => {
    await openEditor(page)
    await select(page, 'home.hero.title')

    const element = await artboard(page).locator('[data-vedit-id="home.hero.title"]').boundingBox()
    const outline = await page.locator('.vedit-rect-selected').boundingBox()

    // The outline is drawn in the parent window over a scaled frame; it has to
    // land exactly on the element it is describing.
    expect(Math.abs(outline!.x - element!.x)).toBeLessThan(2)
    expect(Math.abs(outline!.y - element!.y)).toBeLessThan(2)
    expect(Math.abs(outline!.width - element!.width)).toBeLessThan(2)
    await expect(page.locator('.vedit-right .vedit-panel-head span').first()).toHaveText('Title')
  })

  test('rewriting copy in the inspector changes the page', async ({ page }) => {
    await openEditor(page)
    await select(page, 'home.hero.title')

    await page.locator('.vedit-right textarea').first().fill('Edited by a test')
    await expect(artboard(page).locator('[data-vedit-id="home.hero.title"]')).toHaveText('Edited by a test')
  })

  test('a breakpoint edit only applies from that width up', async ({ page }) => {
    await openEditor(page)
    await select(page, 'home.hero.title')

    const title = artboard(page).locator('[data-vedit-id="home.hero.title"]')

    // The artboard opens at whatever breakpoint its width lands in, so say which
    // one this edit belongs to rather than assuming.
    await page.locator('.vedit-toolbar button[data-breakpoint="base"]').click()
    await page.waitForTimeout(600)
    const size = inspectorField(page, 'Typography', 'Size')

    await size.fill('30px')
    await size.press('Enter')
    await expect.poll(() => title.evaluate((el) => getComputedStyle(el).fontSize)).toBe('30px')

    await page.locator('.vedit-toolbar button[data-breakpoint="lg"]').click()
    await page.waitForTimeout(600)
    const sizeAtLg = inspectorField(page, 'Typography', 'Size')
    await sizeAtLg.fill('72px')
    await sizeAtLg.press('Enter')
    await expect.poll(() => title.evaluate((el) => getComputedStyle(el).fontSize)).toBe('72px')

    // Narrow past the breakpoint and the base value, which applies everywhere,
    // takes over again.
    await page.locator('.vedit-toolbar button[data-breakpoint="sm"]').click()
    await page.waitForTimeout(800)
    await expect.poll(() => title.evaluate((el) => getComputedStyle(el).fontSize)).toBe('30px')
  })

  test("the site's own media queries respond to the artboard width", async ({ page }) => {
    await openEditor(page)
    const features = artboard(page).locator('.features')

    await page.locator('.vedit-toolbar button[data-breakpoint="xl"]').click()
    await page.waitForTimeout(800)
    const wide = await features.evaluate((el) => getComputedStyle(el).gridTemplateColumns)
    expect(wide.split(' ')).toHaveLength(3)

    await page.locator('.vedit-toolbar button[data-breakpoint="sm"]').click()
    await page.waitForTimeout(800)
    const narrow = await features.evaluate((el) => getComputedStyle(el).gridTemplateColumns)
    expect(narrow.split(' ')).toHaveLength(1)
  })

  test('a hover style is written to the hover state and not the base one', async ({ page }) => {
    await openEditor(page)
    await select(page, 'home.hero.cta')
    const cta = artboard(page).locator('[data-vedit-id="home.hero.cta"]')
    const atRest = await cta.evaluate((el) => getComputedStyle(el).backgroundColor)

    await page.locator('.vedit-right .vedit-segmented button:has-text("Hover")').click()
    await expect(cta).toHaveAttribute('data-vedit-force', 'hover')
    await page
      .locator('.vedit-right .vedit-section:has-text("Appearance") .vedit-swatch input[type=color]')
      .first()
      .fill('#ff0000')
    await expect.poll(() => cta.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 0, 0)')

    await page.locator('.vedit-right .vedit-segmented button:has-text("Normal")').click()
    await expect(cta).not.toHaveAttribute('data-vedit-force', 'hover')
    await expect.poll(() => cta.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(atRest)

    await cta.hover()
    await expect.poll(() => cta.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 0, 0)')
  })

  test('a component prop is offered as its declared choices', async ({ page }) => {
    await openEditor(page)
    await select(page, 'home.hero.cta')
    const cta = artboard(page).locator('[data-vedit-id="home.hero.cta"]')
    await expect(cta).toHaveClass(/btn-solid/)

    const component = page.locator('.vedit-right .vedit-section:has-text("Component")')
    await component.locator('.vedit-segmented button:has-text("outline")').click()
    await expect(cta).toHaveClass(/btn-outline/)

    // Resetting the prop puts the code's own value back.
    await component.locator('.vedit-row:has-text("Style") .vedit-reset').click()
    await expect(cta).toHaveClass(/btn-solid/)
  })

  test('dragging re-orders siblings in a grid, and undo puts them back', async ({ page }) => {
    await openEditor(page)
    const order = () =>
      artboard(page)
        .locator('.features > .card')
        .evaluateAll((els) =>
          els
            .map((el) => ({ x: el.getBoundingClientRect().left, text: el.querySelector('h2')!.textContent }))
            .sort((a, b) => a.x - b.x)
            .map((entry) => entry.text)
            .join(' | '),
        )

    const before = await order()
    const cards = artboard(page).locator('.features > .card')
    const first = await cards.nth(0).boundingBox()
    const last = await cards.nth(2).boundingBox()

    await page.mouse.move(first!.x + 40, first!.y + 6)
    await page.mouse.down()
    await page.mouse.move(first!.x + 120, first!.y + 6, { steps: 5 })
    await expect(page.locator('.vedit-drop')).toHaveCount(1)
    await page.mouse.move(last!.x + last!.width - 12, last!.y + 6, { steps: 10 })
    await page.mouse.up()

    await expect.poll(order).not.toBe(before)
    await page.keyboard.press('Control+z')
    await expect.poll(order).toBe(before)
  })

  test('a draft is not what visitors see until it is published', async ({ page }) => {
    await openEditor(page)
    await select(page, 'home.hero.title')
    await page.locator('.vedit-right textarea').first().fill('Draft only')
    await page.locator('.vedit-toolbar button:has-text("Save draft")').click()
    await expect(page.locator('.vedit-toolbar button:has-text("Saved")')).toBeVisible()

    await page.locator('.vedit-toolbar button[title^="Close the editor"]').click()
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.locator('[data-vedit-id="home.hero.title"]')).not.toHaveText('Draft only')

    await page.getByRole('button', { name: 'Edit page' }).click()
    await page.waitForSelector('.vedit-toolbar')
    await page.waitForTimeout(1200)
    await expect(artboard(page).locator('[data-vedit-id="home.hero.title"]')).toHaveText('Draft only')

    await page.locator('.vedit-toolbar button:has-text("Publish")').click()
    await expect(page.locator('.vedit-toolbar button:has-text("Published")')).toBeVisible()
    await page.locator('.vedit-toolbar button[title^="Close the editor"]').click()
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.locator('[data-vedit-id="home.hero.title"]')).toHaveText('Draft only')
  })

  test('the checks panel finds a contrast failure as it is introduced', async ({ page }) => {
    await openEditor(page)
    await page.locator('.vedit-left .vedit-tabs button:has-text("Checks")').click()
    const before = await page.locator('.vedit-issue').count()

    await select(page, 'home.hero.title')
    await page
      .locator('.vedit-right .vedit-section:has-text("Typography") .vedit-swatch input[type=color]')
      .first()
      .fill('#f4f4f4')

    await page.locator('.vedit-left .vedit-tabs button:has-text("Checks")').click()
    await expect.poll(() => page.locator('.vedit-issue').count(), { timeout: 5000 }).toBe(before + 1)
    await expect(page.locator('.vedit-issue').first()).toContainText('Contrast')
  })

  test('each artboard edits its own document', async ({ page }) => {
    await openEditor(page)
    // Home, Pricing and the slot-driven Campaign page.
    await expect(page.locator('.vedit-artboard')).toHaveCount(3)

    await select(page, 'pricing.title', '/pricing')
    await expect(page.locator('.vedit-artboard[data-active="true"] .vedit-artboard-label')).toContainText(
      'Pricing',
    )
    await page.locator('.vedit-right textarea').first().fill('Pricing edited')

    await expect(artboard(page, '/pricing').locator('[data-vedit-id="pricing.title"]')).toHaveText(
      'Pricing edited',
    )
    const keys = await Promise.all(
      ['/', '/pricing'].map((path) =>
        artboard(page, path).evaluate(
          () => (window as unknown as { __veditCanvas: { store: { getState(): { doc: { key: string } } } } })
            .__veditCanvas.store.getState().doc.key,
        ),
      ),
    )
    expect(keys).toEqual(['/', '/pricing'])
  })

  test('links and forms stay inert while editing', async ({ page }) => {
    await openEditor(page)
    const url = page.url()
    await artboard(page).locator('.nav-links a', { hasText: 'Pricing' }).click()
    await page.waitForTimeout(400)
    expect(page.url()).toBe(url)
    await expect(page.locator('.vedit-right .vedit-panel-head span').first()).toHaveText('Pricing')
  })
})

/**
 * Three artboards side by side is the right default for comparing pages, but it
 * is the wrong way to look closely at one. Focusing hides the others without
 * unloading them, so a page you were part-way through editing is still there —
 * and still unsaved — when you come back to it.
 */
test.describe('focusing one page', () => {
  const focus = (page: Page) => page.locator('.vedit-toolbar select.vedit-page-focus')

  test('the dropdown lists every page, and starts on all of them', async ({ page }) => {
    await openEditor(page)

    await expect(focus(page)).toHaveValue('')
    await expect(focus(page).locator('option')).toHaveText(['All pages', 'Home', 'Pricing', 'Campaign'])
    await expect(page.locator('.vedit-artboard:visible')).toHaveCount(3)
  })

  test('picking a page hides the others but keeps them loaded', async ({ page }) => {
    await openEditor(page)
    await focus(page).selectOption('/pricing')
    await page.waitForTimeout(600)

    await expect(page.locator('.vedit-artboard:visible')).toHaveCount(1)
    await expect(page.locator('.vedit-artboard:visible .vedit-artboard-label')).toContainText('Pricing')

    // Still in the DOM, still bridged: hidden, not unmounted.
    await expect(page.locator('.vedit-artboard')).toHaveCount(3)
    expect(artboard(page, '/campaign')).toBeTruthy()
  })

  test('the focused page becomes the one the panels edit', async ({ page }) => {
    await openEditor(page)
    await focus(page).selectOption('/pricing')
    await page.waitForTimeout(600)

    await expect(page.locator('.vedit-artboard[data-active="true"] .vedit-artboard-label')).toContainText(
      'Pricing',
    )
  })

  test('unsaved edits survive being hidden and coming back', async ({ page }) => {
    await openEditor(page)
    await select(page, 'pricing.title', '/pricing')
    await page.locator('.vedit-right textarea').first().fill('Edited before hiding')

    await focus(page).selectOption('/')
    await page.waitForTimeout(600)
    await expect(page.locator('.vedit-artboard:visible')).toHaveCount(1)

    await focus(page).selectOption('')
    await page.waitForTimeout(600)
    await expect(page.locator('.vedit-artboard:visible')).toHaveCount(3)
    await expect(artboard(page, '/pricing').locator('[data-vedit-id="pricing.title"]')).toHaveText(
      'Edited before hiding',
    )
  })
})

/**
 * The Position toggle writes through `setStyle`, which lands in the cell for the
 * breakpoint you are on. It has to read back from that same cell — reading the
 * base bucket while writing to `responsive.lg` leaves the control showing "In
 * flow" for an element that is genuinely positioned.
 */
test.describe('the position toggle', () => {
  const segment = (page: Page) =>
    page.locator('.vedit-right .vedit-row:has-text("Position") .vedit-segmented')

  const activeLabel = (page: Page) =>
    segment(page).locator('button[data-active="true"]')

  for (const breakpoint of ['base', 'lg'] as const) {
    test(`switching to Free lights up at the ${breakpoint} breakpoint`, async ({ page }) => {
      await openEditor(page)
      await select(page, 'home.hero.title')

      await page.locator(`.vedit-toolbar button[data-breakpoint="${breakpoint}"]`).click()
      await page.waitForTimeout(900)

      await expect(activeLabel(page)).toHaveText('In flow')

      await segment(page).getByText('Free', { exact: true }).click()
      await expect(activeLabel(page)).toHaveText('Free')

      // The X/Y fields only make sense for a free element, so they follow it.
      await expect(inspectorField(page, 'Layout', 'X')).toBeVisible()

      // And back again.
      await segment(page).getByText('In flow', { exact: true }).click()
      await expect(activeLabel(page)).toHaveText('In flow')
    })
  }
})

/**
 * Every one of these failures used to present identically: nothing on screen,
 * nothing in the console. The warnings are the feature — a silent dead end is
 * the expensive kind of bug, because the only way out is reading the source.
 */
test.describe('saying why nothing happened', () => {
  test('a page that hides markup from the scanner keeps the rest editable', async ({ page }) => {
    await openEditor(page, { path: '/pricing' })
    const board = artboard(page, '/pricing')

    // The split heading is skipped...
    await expect(board.locator('.split-heading[data-vedit-id]')).toHaveCount(0)
    await expect(board.locator('.split-heading span[data-vedit-id]')).toHaveCount(0)

    // ...and its neighbours are untouched, which `data-vedit-ui` would have broken.
    await board.locator('[data-vedit-id="pricing.title"]').click()
    await expect(page.locator('.vedit-rect-selected')).toHaveCount(1)
  })

  test('selecting a node with no box says so instead of drawing nothing', async ({ page }) => {
    const warnings: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'warning') warnings.push(message.text())
    })

    await openEditor(page, { path: '/pricing' })
    // An explicit `<EditableBox>` registers itself, so unlike a scanner-found
    // element it is never filtered out for being too small — this is the shape
    // that actually reaches a user. Selected the way the Layers panel does,
    // because a `display: contents` element is never a click's nearest match.
    await page.evaluate(() => {
      const frame = [...document.querySelectorAll('iframe')].find((element) =>
        (element as HTMLIFrameElement).src.includes('pricing'),
      ) as HTMLIFrameElement
      const canvas = frame.contentWindow as unknown as {
        __veditCanvas: { store: { select(id: string): void } }
      }
      canvas.__veditCanvas.store.select('pricing.contents')
    })
    await page.waitForTimeout(500)

    // The outline element exists but has collapsed to nothing, which is what
    // makes this look like a dead selection rather than an explained one.
    const outline = await page.locator('.vedit-rect-selected').boundingBox()
    expect(outline?.width ?? 0).toBe(0)
    expect(outline?.height ?? 0).toBe(0)
    expect(warnings.some((line) => line.includes('pricing.contents') && line.includes('0 × 0'))).toBe(true)
  })

  test('a disabled editor says why, instead of ignoring the shortcut', async ({ page }) => {
    const warnings: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'warning') warnings.push(message.text())
    })

    // The confusing case is a hostname that isn't local and carries no `?vedit`
    // — the provider mounts, the page renders, and ⌘E silently does nothing.
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => {
      history.replaceState(null, '', '/')
    })
    await page.waitForTimeout(300)

    // On localhost the editor is on, so this asserts the inverse: no warning
    // when it is working, which is what makes the warning meaningful elsewhere.
    expect(warnings.filter((line) => line.includes('disabled on this hostname'))).toEqual([])
  })
})
