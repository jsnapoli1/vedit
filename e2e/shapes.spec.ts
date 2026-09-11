import { expect, test, type Page } from '@playwright/test'
import { artboard, inspectorField, inspectorRow, openEditor } from './fixtures'
import { SVG_REFUSED } from '../src/editor/panels/Insert'

/** The campaign page is a slot and nothing else: whatever is on it was placed here. */
async function openCampaign(page: Page) {
  await openEditor(page, { path: '/campaign' })
  await page.locator('.vedit-left .vedit-tabs button:has-text("Insert")').click()
}

const board = (page: Page) => artboard(page, '/campaign')

/** Every shape the editor places is an `<svg>` carrying the kind, in the slot. */
const shapes = (page: Page) => board(page).locator('svg[data-vedit-kind="shape"]')

/**
 * The shape's own box, in its own pixels.
 *
 * Not `boundingBox()`: the canvas scales each artboard with a CSS `transform`,
 * so a measurement taken in the host page's coordinates is multiplied by
 * whatever the zoom happens to be. Inside the frame there is no such factor.
 */
async function boxOf(page: Page) {
  return shapes(page).evaluate((el) => {
    const rect = el.getBoundingClientRect()
    return `${Math.round(rect.width)}×${Math.round(rect.height)}`
  })
}

async function place(page: Page, name: string) {
  await page.locator('.vedit-insert-item', { hasText: name }).first().click()
  await page.waitForTimeout(350)
}

/** Effects is collapsed by default — everything in it is behind its title. */
async function openEffects(page: Page) {
  await page.locator('.vedit-right .vedit-section:has-text("Effects") .vedit-section-title').click()
  await expect(page.locator('.vedit-right .vedit-section:has-text("Effects")')).toContainText('Motion')
}

/**
 * An SVG that behaves badly on purpose. The `<path>` is the only thing that
 * should survive: the script, the `onload` and the page-wide `<style>` are what
 * an import is cleaned of.
 */
const HOSTILE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" onload="window.__pwned = 'onload'">
  <script>window.__pwned = 'script'</script>
  <style>* { display: none }</style>
  <path d="M4 4 L20 4 L12 20 Z" fill="#2563eb" />
</svg>`

test.describe('placing and styling a shape', () => {
  test('a circle is an svg with an ellipse in it, at the default size', async ({ page }) => {
    await openCampaign(page)
    await place(page, 'Circle')

    const circle = shapes(page)
    await expect(circle).toHaveCount(1)
    await expect(circle.locator('ellipse')).toHaveCount(1)

    // 160 × 160 from `shapeStyleDefaults`, so a shape arrives big enough to see
    // and square enough to be a circle rather than an ellipse.
    expect(await boxOf(page)).toBe('160×160')
  })

  test('the Fill row repaints the ellipse', async ({ page }) => {
    await openCampaign(page)
    await place(page, 'Circle')

    const ellipse = shapes(page).locator('ellipse')
    const fill = () => ellipse.evaluate((el) => getComputedStyle(el).fill)
    expect(await fill()).not.toBe('rgb(220, 38, 38)')

    // Fill is inherited from the root `<svg>`, which is what the style lands on.
    const field = inspectorRow(page, 'Shape', 'Fill').locator('input.vedit-input')
    await field.fill('#dc2626')
    await field.press('Enter')

    await expect.poll(fill).toBe('rgb(220, 38, 38)')
  })

  test('the Layout W and H fields resize the box the shape is drawn in', async ({ page }) => {
    await openCampaign(page)
    await place(page, 'Circle')

    const width = inspectorField(page, 'Layout', 'W')
    await width.fill('240')
    await width.press('Enter')
    const height = inspectorField(page, 'Layout', 'H')
    await height.fill('80')
    await height.press('Enter')

    await expect.poll(() => boxOf(page)).toBe('240×80')
  })

  test('editing a polygon\'s points redraws it', async ({ page }) => {
    await openCampaign(page)
    await place(page, 'Triangle')

    const polygon = shapes(page).locator('polygon')
    const before = await polygon.getAttribute('points')
    expect(before).toBeTruthy()

    const points = page.locator('.vedit-right textarea[aria-label="Polygon points, one x,y per line"]')
    await points.fill('0,0\n100,0\n100,100\n0,100')
    // The textarea commits on blur, the way the long-form fields in the
    // inspector do — clicking the section title is enough to leave it.
    await points.blur()

    await expect(polygon).toHaveAttribute('points', '0,0 100,0 100,100 0,100')
  })
})

test.describe('importing artwork', () => {
  test('an imported SVG renders inline, and its script never runs', async ({ page }) => {
    await openCampaign(page)

    await page.locator('[data-vedit-import-svg]').setInputFiles({
      name: 'art.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(HOSTILE_SVG),
    })

    const shape = shapes(page)
    await expect(shape).toHaveCount(1)
    // The drawing survived…
    await expect(shape.locator('path')).toHaveCount(1)
    // …and nothing that could execute or restyle the page did.
    await expect(shape.locator('script')).toHaveCount(0)
    await expect(shape.locator('style')).toHaveCount(0)
    await expect(shape.locator('[onload]')).toHaveCount(0)

    const frame = board(page)
    expect(await frame.evaluate(() => (window as unknown as { __pwned?: string }).__pwned)).toBeUndefined()
  })

  test('a file that is not an SVG is refused, and places nothing', async ({ page }) => {
    await openCampaign(page)

    await page.locator('[data-vedit-import-svg]').setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('this is not an svg, it is a shopping list'),
    })

    await expect(page.locator('.vedit-toast')).toContainText(SVG_REFUSED)
    await expect(shapes(page)).toHaveCount(0)
  })
})

test.describe('effects and motion', () => {
  test('a Motion preset animates the shape with a keyframe vedit owns', async ({ page }) => {
    await openCampaign(page)
    await place(page, 'Star')
    await openEffects(page)

    await page.locator('.vedit-right select[aria-label="Motion preset"]').selectOption('spin')

    const shape = shapes(page)
    await expect
      .poll(() => shape.evaluate((el) => getComputedStyle(el).animationName))
      .toBe('vedit-spin')

    // The keyframes come from the emitted override stylesheet, not from the
    // host's CSS — an animation that names a missing keyframe animates nothing.
    const css = await board(page)
      .locator('style[data-vedit-overrides]')
      .evaluate((el) => el.textContent ?? '')
    expect(css).toContain('@keyframes vedit-spin')
  })

  test('a multi-selection edit keeps each shape\'s own effects', async ({ page }) => {
    await openCampaign(page)
    await place(page, 'Circle')
    await place(page, 'Circle')
    await expect(shapes(page)).toHaveCount(2)

    const first = shapes(page).nth(0)
    const second = shapes(page).nth(1)
    const filterOf = (shape: typeof first) => shape.evaluate((el) => getComputedStyle(el).filter)

    // Blur on the first alone.
    await first.click()
    await openEffects(page)
    const blur = page.locator('.vedit-right input[type="range"][aria-label="Blur"]')
    await blur.fill('6')
    await blur.dispatchEvent('change')
    await expect.poll(() => filterOf(first)).toContain('blur(')

    // Both selected, then Saturation — which must patch each one's own filter
    // rather than fan the primary's value out over the other.
    await second.click({ modifiers: ['Shift'] })
    const saturation = page.locator('.vedit-right input[type="range"][aria-label="Saturation"]')
    await saturation.fill('1.5')
    await saturation.dispatchEvent('change')

    await expect.poll(() => filterOf(first)).toContain('saturate(')
    expect(await filterOf(first)).toContain('blur(')

    await expect.poll(() => filterOf(second)).toContain('saturate(')
    expect(await filterOf(second)).not.toContain('blur(')
  })

  test('the Blur slider gives the shape a computed filter', async ({ page }) => {
    await openCampaign(page)
    await place(page, 'Circle')
    await openEffects(page)

    const blur = page.locator('.vedit-right input[type="range"][aria-label="Blur"]')
    await blur.fill('6')
    await blur.dispatchEvent('change')

    await expect
      .poll(() => shapes(page).evaluate((el) => getComputedStyle(el).filter))
      .toContain('blur(')
  })
})

test('undo takes the shape back off the page', async ({ page }) => {
  await openCampaign(page)
  await place(page, 'Hexagon')
  await expect(shapes(page)).toHaveCount(1)

  await page.keyboard.press('Control+z')
  await expect(shapes(page)).toHaveCount(0)
})
