import { expect, test, type Page } from '@playwright/test'
import { artboard, openEditor, select } from './fixtures'

const row = (page: Page, id: string) => page.locator(`.vedit-layer[data-id="${id}"]`)
const name = (page: Page, id: string) => row(page, id).locator('.vedit-layer-name')

test.describe('the layers tree', () => {
  test('a row with children collapses and expands from its chevron', async ({ page }) => {
    await openEditor(page)

    const hero = row(page, 'home.hero')
    await expect(hero).toHaveAttribute('aria-expanded', 'true')
    await expect(row(page, 'home.hero.title')).toBeVisible()

    await hero.locator('.vedit-layer-toggle').click()
    await expect(hero).toHaveAttribute('aria-expanded', 'false')
    await expect(row(page, 'home.hero.title')).toHaveCount(0)
    // Collapsing must not select: it is a tree gesture, not a page one.
    await expect(page.locator('.vedit-rect-selected')).toHaveCount(0)

    await hero.locator('.vedit-layer-toggle').click()
    await expect(row(page, 'home.hero.title')).toBeVisible()
  })

  test('a row without children has no chevron, and its siblings still line up', async ({ page }) => {
    await openEditor(page)
    await expect(row(page, 'home.hero.title').locator('.vedit-layer-toggle')).toHaveCount(0)
    const title = (await row(page, 'home.hero.title').locator('.vedit-layer-name').boundingBox())!
    const body = (await row(page, 'home.hero.body').locator('.vedit-layer-name').boundingBox())!
    expect(title.x).toBe(body.x)
  })

  test('Left collapses, Right expands, and Left on a leaf goes to its parent', async ({ page }) => {
    await openEditor(page)

    // The scanner registers the <div> between the hero and its copy, so Title's
    // parent is that row, not Hero; Left climbs one level at a time.
    const level = Number(await row(page, 'home.hero.title').getAttribute('aria-level'))
    await row(page, 'home.hero.title').focus()
    await page.keyboard.press('ArrowLeft')
    const parent = page.locator('.vedit-layer:focus')
    await expect(parent).toHaveAttribute('aria-level', String(level - 1))
    await expect(parent).toHaveAttribute('aria-expanded', 'true')

    await page.keyboard.press('ArrowLeft')
    await expect(parent).toHaveAttribute('aria-expanded', 'false')
    await expect(row(page, 'home.hero.title')).toHaveCount(0)

    await page.keyboard.press('ArrowLeft')
    await expect(row(page, 'home.hero')).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(row(page, 'home.hero')).toHaveAttribute('aria-expanded', 'false')

    await page.keyboard.press('ArrowRight')
    await expect(row(page, 'home.hero')).toHaveAttribute('aria-expanded', 'true')
    // Right on an open row walks into it.
    const heroLevel = Number(await row(page, 'home.hero').getAttribute('aria-level'))
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.vedit-layer:focus')).toHaveAttribute('aria-level', String(heroLevel + 1))
  })

  test('the collapse survives a trip to another tab', async ({ page }) => {
    await openEditor(page)
    await row(page, 'home.hero').locator('.vedit-layer-toggle').click()
    await page.locator('.vedit-tabs button', { hasText: 'Tokens' }).click()
    await page.locator('.vedit-tabs button', { hasText: 'Layers' }).click()
    await expect(row(page, 'home.hero')).toHaveAttribute('aria-expanded', 'false')
  })

  test('selecting something on the page opens the rows above it', async ({ page }) => {
    await openEditor(page)
    await row(page, 'home.hero').locator('.vedit-layer-toggle').click()
    await expect(row(page, 'home.hero.title')).toHaveCount(0)

    await select(page, 'home.hero.title')
    await expect(row(page, 'home.hero.title')).toBeVisible()
    await expect(row(page, 'home.hero.title')).toHaveAttribute('aria-selected', 'true')
  })

  test('double-click renames a layer, and the name shows wherever the layer is named', async ({ page }) => {
    await openEditor(page)

    await row(page, 'home.hero.title').locator('.vedit-layer-name').dblclick()
    const field = page.locator('.vedit-layer-rename')
    await expect(field).toBeFocused()
    await expect(field).toHaveValue('Title')
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type('Headline')
    await page.keyboard.press('Enter')

    await expect(page.locator('.vedit-layer-rename')).toHaveCount(0)
    await expect(name(page, 'home.hero.title')).toHaveText('Headline')

    // The hover tag over the page says the same. The double-click also selected
    // the row, and a selected node draws no hover tag, so select something else.
    await select(page, 'home.hero.eyebrow')
    await row(page, 'home.hero.title').hover()
    await expect(page.locator('.vedit-tag')).toHaveText('Headline')

    await select(page, 'home.hero.title')
    await expect(page.locator('.vedit-right .vedit-panel-head span').first()).toHaveText('Headline')

    await page.locator('.vedit-toolbar button[title^="Undo"]').click()
    await expect(name(page, 'home.hero.title')).toHaveText('Title')
  })

  test('F2 renames the focused row, Escape leaves the name alone, and a blank name goes back to the source', async ({
    page,
  }) => {
    await openEditor(page)

    await row(page, 'home.hero.title').focus()
    await page.keyboard.press('F2')
    await expect(page.locator('.vedit-layer-rename')).toBeFocused()
    await page.keyboard.type('Nope')
    await page.keyboard.press('Escape')
    await expect(page.locator('.vedit-layer-rename')).toHaveCount(0)
    await expect(name(page, 'home.hero.title')).toHaveText('Title')
    // Focus lands back on the row, so the keyboard is not stranded.
    await expect(row(page, 'home.hero.title')).toBeFocused()

    await page.keyboard.press('F2')
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type('Headline')
    await page.keyboard.press('Enter')
    await expect(name(page, 'home.hero.title')).toHaveText('Headline')
    await expect(row(page, 'home.hero.title')).toBeFocused()

    await page.keyboard.press('F2')
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Enter')
    await expect(name(page, 'home.hero.title')).toHaveText('Title')
  })

  test('a name is saved with the page and is still there after a reload', async ({ page }) => {
    await openEditor(page)

    await row(page, 'home.hero.title').locator('.vedit-layer-name').dblclick()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type('Headline')
    await page.keyboard.press('Enter')
    await page.locator('.vedit-toolbar button:has-text("Save draft")').click()
    await expect(page.locator('.vedit-toolbar button:has-text("Saved")')).toBeVisible()

    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Edit page' }).click()
    await page.waitForSelector('.vedit-toolbar')
    await expect(name(page, 'home.hero.title')).toHaveText('Headline')
    // The page itself is untouched: a name is for the editor, not the visitor.
    await expect(artboard(page).locator('[data-vedit-id="home.hero.title"]')).toHaveText(
      'Ship the site your designer actually drew.',
    )
  })
})
