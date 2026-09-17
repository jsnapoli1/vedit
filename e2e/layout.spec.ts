import { expect, test, type Page } from '@playwright/test'
import { artboard, openEditor } from './fixtures'

/**
 * The Pricing page ends in markup built the way sites usually are: a wrapper
 * that does nothing, a card its flex row sizes, a badge floated over the row
 * and a card an animation capped with an inline max-height. The editor's job
 * is to name what matters, skip what does not, and say why an edit would not
 * take — never to hide a constraint someone has to know about.
 */
const board = (page: Page) => artboard(page, '/pricing')
const traps = (page: Page) => board(page).locator('.layout-traps')

async function openTraps(page: Page) {
  await openEditor(page, { path: '/pricing' })
  await page.selectOption('.vedit-toolbar select.vedit-page-focus', '/pricing')
  await page.waitForTimeout(400)
}

test.describe('layout the editor has to explain', () => {
  test('a wrapper that does nothing is not a layer; the flex row and the badge are, by role', async ({ page }) => {
    await openTraps(page)
    const section = traps(page)
    const wrapper = section.locator(':scope > div').first()
    await expect(wrapper).not.toHaveAttribute('data-vedit-id')
    const row = wrapper.locator(':scope > div').first()
    await expect(row).toHaveAttribute('data-vedit-kind', 'box')
    const rowId = await row.getAttribute('data-vedit-id')
    await expect(page.locator(`.vedit-layer[data-id="${rowId}"] .vedit-layer-name`)).toHaveText('Flex row')
    const badgeId = await section.locator('.badge').getAttribute('data-vedit-id')
    await expect(page.locator(`.vedit-layer[data-id="${badgeId}"] .vedit-layer-name`)).toHaveText('Absolute box')
    const cappedId = await section.locator('.capped').getAttribute('data-vedit-id')
    await expect(page.locator(`.vedit-layer[data-id="${cappedId}"] .vedit-layer-name`)).toHaveText('Box · clips')
  })

  test('a capped card says so, and Unpin lets it grow', async ({ page }) => {
    await openTraps(page)
    const card = traps(page).locator('.capped')
    await card.click({ force: true, position: { x: 4, y: 4 } })
    const notice = page.locator('.vedit-right .vedit-layout-notice')
    await expect(notice).toContainText('capped at 96px')
    const before = await card.evaluate((el) => el.getBoundingClientRect().height)
    await notice.getByRole('button', { name: 'Unpin height' }).click()
    await expect.poll(() => card.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(before + 20)
    await expect(notice).toHaveCount(0)
  })

  test('a flex-grown card says its row sizes it, and a resize pins it', async ({ page }) => {
    await openTraps(page)
    const card = traps(page).locator('.flex-grown')
    await card.click({ force: true, position: { x: 4, y: 4 } })
    await expect(page.locator('.vedit-right .vedit-layout-notice')).toContainText('row it sits in')
    const before = await card.evaluate((el) => Math.round(el.getBoundingClientRect().width))
    const zoom = await page.locator('.vedit-artboard[data-active="true"] iframe').evaluate((f) => f.getBoundingClientRect().width / (f as HTMLIFrameElement).offsetWidth)
    const handle = await page.locator('.vedit-handle').nth(3).boundingBox() // east
    const x = handle!.x + handle!.width / 2
    const y = handle!.y + handle!.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x - 12, y)
    await page.mouse.move(x - 40 * zoom, y, { steps: 8 })
    await page.mouse.up()
    await expect.poll(() => card.evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(before - 40)
  })

  test('an absolute box says it floats', async ({ page }) => {
    await openTraps(page)
    await traps(page).locator('.badge').click({ force: true, position: { x: 2, y: 2 } })
    await expect(page.locator('.vedit-right .vedit-layout-notice')).toContainText('floats over the page')
  })
})
