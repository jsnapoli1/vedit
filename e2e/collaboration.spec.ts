import { expect, test, type Browser, type Page } from '@playwright/test'
import { VIEWPORT } from '../playwright.config'
import { artboard, openEditor, select } from './fixtures'

/**
 * Two editors in one browser context, so they share an origin and therefore a
 * BroadcastChannel. The SSE transport carries the same messages — it has its own
 * unit tests against the relay, and the session code underneath is identical.
 */
async function twoEditors(browser: Browser): Promise<[Page, Page]> {
  const context = await browser.newContext({ viewport: VIEWPORT })
  const sam = await context.newPage()
  await openEditor(sam, { as: 'Sam' })
  const alex = await context.newPage()
  await openEditor(alex, { as: 'Alex' })
  await sam.bringToFront()
  await sam.waitForTimeout(1200)
  return [sam, alex]
}

test.describe('two people at once', () => {
  test('each sees the other in the toolbar, once', async ({ browser }) => {
    const [sam, alex] = await twoEditors(browser)
    await expect(sam.locator('.vedit-avatar')).toHaveText(['S', 'A'])
    await expect(alex.locator('.vedit-avatar')).toHaveText(['A', 'S'])
  })

  test("a peer's selection and cursor are drawn in their colour", async ({ browser }) => {
    const [sam, alex] = await twoEditors(browser)

    await alex.bringToFront()
    await select(alex, 'home.hero.title')
    const body = await artboard(alex).locator('[data-vedit-id="home.hero.body"]').boundingBox()
    await alex.mouse.move(body!.x + 40, body!.y + 20)
    await alex.mouse.move(body!.x + 90, body!.y + 30)

    await sam.bringToFront()
    await expect(sam.locator('.vedit-peer-rect')).toHaveCount(1)
    await expect(sam.locator('.vedit-peer-tag')).toHaveText('Alex')
    await expect(sam.locator('.vedit-peer-cursor span')).toHaveText('Alex')
  })

  test('edits to different elements both survive', async ({ browser }) => {
    const [sam, alex] = await twoEditors(browser)

    await alex.bringToFront()
    await select(alex, 'home.hero.title')
    await alex.locator('.vedit-right textarea').first().fill('Alex wrote this')

    await sam.bringToFront()
    await expect(artboard(sam).locator('[data-vedit-id="home.hero.title"]')).toHaveText('Alex wrote this')

    await select(sam, 'home.hero.eyebrow')
    await sam.locator('.vedit-right textarea').first().fill('Sam wrote this')

    await alex.bringToFront()
    await expect(artboard(alex).locator('[data-vedit-id="home.hero.eyebrow"]')).toHaveText('Sam wrote this')
    await expect(artboard(alex).locator('[data-vedit-id="home.hero.title"]')).toHaveText('Alex wrote this')
  })

  test('undo steps back through your own work, not theirs', async ({ browser }) => {
    const [sam, alex] = await twoEditors(browser)

    await sam.bringToFront()
    await select(sam, 'home.hero.eyebrow')
    await sam.locator('.vedit-right textarea').first().fill('Sam wrote this')

    await alex.bringToFront()
    await select(alex, 'home.hero.title')
    await alex.locator('.vedit-right textarea').first().fill('Alex wrote this')

    await sam.bringToFront()
    await expect(artboard(sam).locator('[data-vedit-id="home.hero.title"]')).toHaveText('Alex wrote this')
    await sam.locator('.vedit-toolbar button[title^="Undo"]').click()

    await expect(artboard(sam).locator('[data-vedit-id="home.hero.eyebrow"]')).not.toHaveText('Sam wrote this')
    await expect(artboard(sam).locator('[data-vedit-id="home.hero.title"]')).toHaveText('Alex wrote this')
  })

  test('a comment reaches the other editor, takes a reply, and resolves for both', async ({ browser }) => {
    const [sam, alex] = await twoEditors(browser)

    await sam.bringToFront()
    await sam.keyboard.press('c')
    await artboard(sam).locator('[data-vedit-id="home.hero.title"]').click()
    await sam.locator('.vedit-thread textarea').fill('Too long on mobile')
    await sam.locator('.vedit-thread button:has-text("Comment")').click()
    await expect(sam.locator('.vedit-pin')).toHaveCount(1)

    await alex.bringToFront()
    await expect(alex.locator('.vedit-pin')).toHaveCount(1)
    await alex.locator('.vedit-pin').click()
    await expect(alex.locator('.vedit-thread .vedit-comment').first()).toContainText('Too long on mobile')
    await alex.locator('.vedit-thread textarea').fill('Shortening it')
    await alex.locator('.vedit-thread button:has-text("Reply")').click()

    await sam.bringToFront()
    await sam.locator('.vedit-left .vedit-tabs button:has-text("Notes")').click()
    await expect(sam.locator('.vedit-comment-head').first()).toContainText('1 reply')

    await sam.locator('.vedit-pin').click()
    await sam.locator('.vedit-thread button:has-text("Resolve")').first().click()
    await alex.bringToFront()
    await expect(alex.locator('.vedit-pin')).toHaveCount(0)
  })

  test('a pin stays on the element it is about when that element resizes', async ({ browser }) => {
    const [sam] = await twoEditors(browser)

    await sam.bringToFront()
    await sam.keyboard.press('c')
    await artboard(sam).locator('[data-vedit-id="home.hero.title"]').click()
    await sam.locator('.vedit-thread textarea').fill('Anchored here')
    await sam.locator('.vedit-thread button:has-text("Comment")').click()
    const before = await sam.locator('.vedit-pin').boundingBox()

    await select(sam, 'home.hero.title')
    const width = sam
      .locator('.vedit-right .vedit-field:has(.vedit-field-prefix:text-is("W"))')
      .locator('input')
      .first()
    await width.fill('300px')
    await width.press('Enter')

    await expect
      .poll(async () => Math.round((await sam.locator('.vedit-pin').boundingBox())!.x))
      .not.toBe(Math.round(before!.x))
  })

  test('saving after someone else saved warns before replacing their version', async ({ browser }) => {
    const [sam, alex] = await twoEditors(browser)

    await alex.bringToFront()
    await select(alex, 'home.hero.title')
    await alex.locator('.vedit-right textarea').first().fill('Alex saved this')
    await alex.locator('.vedit-toolbar button:has-text("Save draft")').click()

    await sam.bringToFront()
    await expect(sam.locator('.vedit-toast[data-tone="warn"]')).toContainText('Someone else saved')
  })
})
