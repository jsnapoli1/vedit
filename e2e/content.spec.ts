import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { artboard, openCatalog, select } from './fixtures'

/**
 * The catalog pages are the half of the demo where vedit owns the content: rows,
 * files, a shared nav and a sign-in gate, all behind `example/content-server.mjs`.
 * The unit tests prove each layer on its own; what they cannot show is that an
 * edit made in the real chrome ends up on the server, and that a visitor who
 * never signed in gets it back. Every test here ends on the server side, with
 * a request that carries no session, because that is the thing being guarded.
 *
 * The server is one in-memory store for the whole run, so each test writes a
 * value it made up (stamped with the time) and reads that back — nothing here
 * depends on what another test left behind, and nothing takes the seed apart.
 */

/** The content server itself, past the Vite proxy: a request here is a visitor. */
const API = 'http://localhost:5180/vedit'

const board = (page: Page) => artboard(page, '/catalog')

/** The Content section's textarea — the one place copy is typed for a selected element. */
const copyField = (page: Page) => page.locator('.vedit-right textarea[aria-label="Copy for this element"]')

async function saveDraft(page: Page) {
  await page.locator('.vedit-toolbar button:has-text("Save draft")').click()
  await expect(page.locator('.vedit-toolbar button:has-text("Saved")')).toBeVisible()
}

async function publish(page: Page) {
  await page.locator('.vedit-toolbar button:has-text("Publish")').click()
  await expect(page.locator('.vedit-toolbar button:has-text("Published")')).toBeVisible()
}

async function record(request: APIRequestContext, source: string, id: string): Promise<Record<string, unknown>> {
  const response = await request.get(`${API}/v1/content/${source}/${id}`)
  expect(response.status()).toBe(200)
  return (await response.json()) as Record<string, unknown>
}

test.describe('editing content on the catalog', () => {
  test('sign-in is required on the catalog and a wrong password is refused', async ({ page }) => {
    await page.context().clearCookies()
    await page.goto('/catalog?as=Sam', { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => localStorage.clear())
    await page.reload({ waitUntil: 'domcontentloaded' })

    await page.getByRole('button', { name: 'Edit page' }).click()
    const form = page.getByRole('form', { name: 'Sign in' })
    await expect(form).toBeVisible()
    // Nothing of the editor mounts behind the form: no page is loaded into a
    // frame for someone who has not yet shown they may change it.
    await expect(page.locator('.vedit-toolbar')).toHaveCount(0)
    await expect(page.locator('.vedit-artboard')).toHaveCount(0)

    await form.getByLabel('Email').fill('sam@example.com')
    await form.getByLabel('Password').fill('not-the-password')
    await form.getByRole('button', { name: 'Sign in' }).click()
    await expect(form.getByRole('alert')).toContainText('Wrong email or password')
    await expect(page.locator('.vedit-toolbar')).toHaveCount(0)

    await form.getByLabel('Password').fill('vedit-demo')
    await form.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.locator('.vedit-toolbar')).toBeVisible({ timeout: 15_000 })
    await expect(form).toHaveCount(0)
  })

  test('replacing a datasheet uploads the file and a visitor gets the bytes as application/pdf', async ({
    page,
    request,
  }) => {
    await openCatalog(page)
    await select(page, 'products.datasheet~p-relay', '/catalog')
    const link = board(page).locator('[data-vedit-id="products.datasheet~p-relay"]')
    const before = await link.getAttribute('href')

    // The smallest thing a PDF reader would open: what matters is that these
    // exact bytes, under this exact type, come back out of the media store.
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF')
    const chooser = page.waitForEvent('filechooser')
    await page.locator('.vedit-right .vedit-section:has-text("File") button:has-text("Replace…")').click()
    await (await chooser).setFiles({ name: 'sheet.pdf', mimeType: 'application/pdf', buffer: pdf })

    // The file is stored on the record, so the page's link follows it at once.
    await expect(link).toHaveAttribute('href', /\/vedit\/v1\/media\//)
    const href = await link.getAttribute('href')
    expect(href).not.toBe(before)

    await saveDraft(page)
    await publish(page)

    const response = await request.get(`http://localhost:5180${href}`)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('application/pdf')
    const body = await response.body()
    expect(body.subarray(0, 4).toString()).toBe('%PDF')
    expect(body.equals(pdf)).toBe(true)
  })

  test('a bound edit saves as a draft and shows after publish', async ({ page, request }) => {
    await openCatalog(page)
    await select(page, 'products.title~p-relay', '/catalog')
    const title = `Relay Module ${Date.now()}`

    await copyField(page).fill(title)
    await expect(board(page).locator('[data-vedit-id="products.title~p-relay"]')).toHaveText(title)

    // A draft is the editor's alone: a visitor reads the live copy until it is
    // published, which is the whole point of having two stages.
    await saveDraft(page)
    expect((await record(request, 'products', 'p-relay')).title).not.toBe(title)

    await publish(page)
    expect((await record(request, 'products', 'p-relay')).title).toBe(title)
  })

  test('adding and removing a row round-trips through the server', async ({ page, request }) => {
    // Drafts are for authors: sign in on the side, as the API would be used
    // from a script, and count the rows the server actually holds.
    const login = await request.post(`${API}/v1/auth/login`, {
      data: { email: 'sam@example.com', password: 'vedit-demo' },
    })
    expect(login.status()).toBe(200)
    const { token } = (await login.json()) as { token: string }
    const rowCount = async () => {
      const response = await request.get(`${API}/v1/content/products?stage=draft`, {
        headers: { authorization: `Bearer ${token}` },
      })
      expect(response.status()).toBe(200)
      return ((await response.json()) as { items: unknown[] }).items.length
    }
    const onServer = await rowCount()

    await openCatalog(page)
    await select(page, 'products.title~p-relay', '/catalog')
    const titles = board(page).locator('[data-vedit-id^="products.title~"]')
    const ids = () => titles.evaluateAll((elements) => elements.map((el) => el.getAttribute('data-vedit-id') ?? ''))
    const shown = await ids()

    await page.locator('.vedit-right').getByRole('button', { name: 'Add a Products row' }).click()
    await expect(titles).toHaveCount(shown.length + 1)
    const added = (await ids()).filter((id) => !shown.includes(id))
    expect(added).toHaveLength(1)

    // A row has a required title, so the new card is given one the way an
    // editor would: by selecting it and typing.
    await select(page, added[0], '/catalog')
    await copyField(page).fill(`Added row ${Date.now()}`)
    await saveDraft(page)
    expect(await rowCount()).toBe(onServer + 1)

    // Saving swaps the temporary id for the server's, so the card is found
    // again by what it is not: one of the cards that were there before.
    await expect.poll(async () => (await ids()).filter((id) => !shown.includes(id))).toHaveLength(1)
    const [stored] = (await ids()).filter((id) => !shown.includes(id))
    expect(stored).not.toBe(added[0])

    await select(page, stored, '/catalog')
    await page.locator('.vedit-right').getByRole('button', { name: 'Remove this Products row' }).click()
    await expect(titles).toHaveCount(shown.length)
    await saveDraft(page)
    expect(await rowCount()).toBe(onServer)
  })

  test('the Data panel edits a record that Save sends to the server', async ({ page, request }) => {
    await openCatalog(page)
    await page.getByRole('tab', { name: 'Data' }).click()
    await page.getByRole('option', { name: /Categories/ }).click()
    await page.getByRole('option', { name: /^Power/ }).click()

    const name = `Power ${Date.now()}`
    const field = page.getByRole('group', { name: 'Categories record' }).locator('input').first()
    await field.fill(name)
    await field.press('Enter')

    // The panel writes through the same store as the page, so the toolbar's
    // Save and Publish carry the record like any edit made on the canvas.
    await saveDraft(page)
    expect((await record(request, 'categories', 'cat-power')).name).not.toBe(name)
    await publish(page)
    expect((await record(request, 'categories', 'cat-power')).name).toBe(name)
  })

  test('a nav edit made on the catalog shows on the sheet page after save', async ({ page, request }) => {
    await openCatalog(page)
    const stamp = Date.now()

    // The brand lives in the `site` document every catalog page shares; the
    // tagline is bound to the site global. Both are edited on one page so the
    // other can show them, which is the reason either exists.
    await select(page, 'catalog-nav.brand', '/catalog')
    const brand = `Northwind ${stamp}`
    await copyField(page).fill(brand)
    await expect(board(page).locator('[data-vedit-id="catalog-nav.brand"]')).toHaveText(brand)

    await select(page, 'tagline', '/catalog')
    const tagline = `Ships today ${stamp}`
    await copyField(page).fill(tagline)
    await expect(board(page).locator('[data-vedit-id="tagline"]')).toHaveText(tagline)

    await saveDraft(page)
    await publish(page)

    // A visitor: no session, no editor, just the other page. The brand comes
    // from the shared document, the tagline from the global the node is bound
    // to — the page fetches that source itself, so both show without an editor.
    await page.context().clearCookies()
    await page.goto('/catalog/sheet', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.nav .brand')).toHaveText(brand)
    await expect(page.locator('.nav .tagline')).toHaveText(tagline)
    await expect(page.locator('.vedit-root')).toHaveCount(0)
    expect((await record(request, 'site', 'global')).tagline).toBe(tagline)
  })
})
