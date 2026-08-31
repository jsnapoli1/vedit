import { expect, test, type Page } from '@playwright/test'
import { artboard, openEditor } from './fixtures'

/** The campaign page is a slot and nothing else: whatever is on it was placed here. */
async function openCampaign(page: Page) {
  await openEditor(page, { path: '/campaign' })
  await page.locator('.vedit-left .vedit-tabs button:has-text("Insert")').click()
}

const board = (page: Page) => artboard(page, '/campaign')

async function place(page: Page, name: string) {
  await page.locator('.vedit-insert-item', { hasText: name }).first().click()
  await page.waitForTimeout(350)
}

test.describe('composing a page out of the site\'s own components', () => {
  test('the insert panel offers what the app registered, grouped', async ({ page }) => {
    await openCampaign(page)

    const items = page.locator('.vedit-insert-item .vedit-insert-name')
    // Grouped, and alphabetical within a group.
    await expect(items).toContainText([
      'Split',
      'Banner',
      'FeatureRow',
      'Quote',
      'Text',
      'Image',
      'Box',
      'Button',
      'Link',
    ])
    await expect(page.locator('.vedit-left .vedit-section-title')).toContainText([
      'Adding to',
      'Layout',
      'Sections',
      'Social proof',
      'Elements',
    ])
  })

  test('placing a component renders the real component, with its defaults', async ({ page }) => {
    await openCampaign(page)
    await expect(page.locator('[data-vedit-insert-target]')).toContainText('Campaign page')

    await place(page, 'Banner')

    const banner = board(page).locator('.block-banner')
    await expect(banner).toHaveCount(1)
    await expect(banner.locator('h2')).toHaveText('A headline worth reading')
    // The component's own class did the styling — vedit contributed no CSS here.
    await expect(banner.locator('.btn.btn-solid')).toHaveText('Start free')
  })

  test('its props are the ones the component declared, and editing one re-renders it', async ({ page }) => {
    await openCampaign(page)
    await place(page, 'Banner')

    // The Component section is the one the registry produced; the rest of the
    // inspector is the usual styling, which a placed component gets as well.
    const inspector = page.locator('.vedit-right .vedit-section', { hasText: 'Component' }).first()
    await expect(page.locator('.vedit-right .vedit-panel-head span').first()).toHaveText('Banner')

    const headline = inspector.locator('.vedit-row:has-text("Headline") input').first()
    await headline.fill('Spring campaign')
    await headline.press('Enter')
    await expect(board(page).locator('.block-banner h2')).toHaveText('Spring campaign')

    // A select prop offers exactly the variants the schema declared — as a
    // segmented control, because there are few enough of them to show at once.
    const align = inspector.locator('.vedit-row:has-text("Align")')
    await expect(align.locator('button')).toHaveText(['left', 'center'])
    await align.locator('button:has-text("center")').click()
    await expect(board(page).locator('.block-banner')).toHaveClass(/align-center/)
  })

  test('several components stack in order, and can be re-ordered', async ({ page }) => {
    await openCampaign(page)
    await place(page, 'Banner')
    await place(page, 'Quote')

    const blocks = board(page).locator('.vedit-slot > .vedit-placed')
    await expect(blocks).toHaveCount(2)
    await expect(blocks.first().locator('.block-banner')).toHaveCount(1)

    // The Quote is selected from placing it; move it above the Banner.
    await page.locator('.vedit-right .vedit-row:has-text("Order") button:has-text("Move up")').click()
    await page.waitForTimeout(300)
    await expect(blocks.first().locator('.block-quote')).toHaveCount(1)
  })

  test('a layout component holds the components put inside it', async ({ page }) => {
    await openCampaign(page)
    await place(page, 'Split')
    // With the Split selected, the next thing placed goes inside it.
    await expect(page.locator('[data-vedit-insert-target]')).toContainText('Split')
    await place(page, 'Quote')

    await expect(board(page).locator('.block-split .block-quote')).toHaveCount(1)
  })

  test('what was placed survives a save and a reload as a visitor', async ({ page }) => {
    await openCampaign(page)
    await place(page, 'Banner')
    const headline = page.locator('.vedit-right .vedit-row:has-text("Headline") input').first()
    await headline.fill('Published by the editor')
    await headline.press('Enter')

    await page.locator('.vedit-toolbar button:has-text("Save draft")').click()
    await page.locator('.vedit-toolbar button:has-text("Publish")').click()
    await page.waitForTimeout(400)

    // A visitor: no editor, no canvas, just the page.
    await page.goto('/campaign')
    await expect(page.locator('.block-banner h2')).toHaveText('Published by the editor')
    await expect(page.locator('.vedit-root')).toHaveCount(0)
  })

  test('a component the code no longer has says so instead of vanishing', async ({ page }) => {
    await page.goto('/campaign')
    // A document written by a build that had a component this one doesn't.
    await page.evaluate(() => {
      const doc = {
        version: 1,
        key: '/campaign',
        updatedAt: new Date().toISOString(),
        nodes: {},
        inserted: [
          { id: 'campaign.sections::added-x', parentId: 'campaign.sections', kind: 'component', component: 'Carousel', index: 0 },
        ],
        tokens: [],
      }
      localStorage.setItem('demo:/campaign:published', JSON.stringify(doc))
    })
    await page.reload()

    const missing = page.locator('[data-vedit-missing]')
    await expect(missing).toContainText('Carousel')
    await expect(missing).toContainText('Banner')
  })
})

/**
 * Placement by clicking works and stays, but dragging is the gesture people try
 * first. It aims for itself: the drop point comes from where the pointer is, so
 * unlike a click it doesn't depend on what happens to be selected.
 */
test.describe('dragging a component onto the page', () => {
  const item = (page: Page, name: string) =>
    page.locator('.vedit-insert-item', { hasText: name }).first()

  const placed = (page: Page) => board(page).locator('[data-vedit-id^="campaign.sections::"]')

  test('dropping above the first block places it before, not after', async ({ page }) => {
    await openCampaign(page)
    await place(page, 'Banner')
    await place(page, 'Quote')
    await expect(placed(page)).toHaveCount(2)

    const first = await placed(page).first().boundingBox()
    const source = await item(page, 'FeatureRow').boundingBox()

    await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2)
    await page.mouse.down()
    // The top edge of the first block: above its middle means "before it".
    await page.mouse.move(first!.x + first!.width / 2, first!.y + 6, { steps: 12 })
    await expect(page.locator('.vedit-drop')).toHaveCount(1)
    await page.mouse.up()
    await page.waitForTimeout(400)

    await expect(placed(page)).toHaveCount(3)
    // Landed where it was aimed, rather than being appended.
    const order = await placed(page).evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-vedit-id') ?? ''),
    )
    expect(order).toHaveLength(3)
  })

  /**
   * The bug this exists for: the indicator was drawn from `instanceof
   * HTMLElement`, which is false across the frame boundary, so every child was
   * filtered out and the drop collapsed to "somewhere in the whole slot" — one
   * indicator, in one place, wherever you pointed. The count assertion above
   * still passed, because something was always placed.
   */
  test('the insertion line follows the pointer between blocks', async ({ page }) => {
    await openCampaign(page)
    await place(page, 'Banner')
    await place(page, 'Quote')

    const second = await placed(page).nth(1).boundingBox()
    const source = await item(page, 'FeatureRow').boundingBox()

    await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2)
    await page.mouse.down()

    const lineAt = async (y: number) => {
      await page.mouse.move(second!.x + second!.width / 2, y, { steps: 12 })
      await page.waitForTimeout(150)
      const box = await page.locator('.vedit-drop').boundingBox()
      return Math.round(box?.y ?? -1)
    }

    // Above the block's middle means "before it"; below means "after it".
    const above = await lineAt(second!.y + 6)
    const below = await lineAt(second!.y + second!.height - 6)
    await page.mouse.up()

    expect(above).toBeLessThan(below)
    expect(Math.abs(above - second!.y)).toBeLessThan(6)
    expect(Math.abs(below - (second!.y + second!.height))).toBeLessThan(6)
  })

  test('the editor\'s own chrome is never a drop target', async ({ page }) => {
    await openCampaign(page)

    const source = await item(page, 'Banner').boundingBox()
    await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2)
    await page.mouse.down()
    await page.mouse.move(source!.x + source!.width / 2, source!.y - 40, { steps: 6 })

    await expect(page.locator('.vedit-drop')).toHaveCount(0)
    await page.mouse.up()
    await page.waitForTimeout(300)
    await expect(placed(page)).toHaveCount(0)
  })

  test('a click still places, so the old gesture is untouched', async ({ page }) => {
    await openCampaign(page)
    await place(page, 'Banner')
    await expect(placed(page)).toHaveCount(1)
  })
})
