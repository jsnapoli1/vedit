import { expect, test, type Page } from '@playwright/test'

/**
 * The visitor's half of forms, driven in a real browser: the parts that are
 * about timing, focus and what actually leaves the page, none of which a
 * DOM-less unit test can see.
 *
 * These run against the page directly rather than through the editor — this is
 * what someone filling the form gets, with no vedit chrome loaded.
 */

/** Answer the form's endpoint, and record what reached it. */
async function stubEndpoint(page: Page) {
  const posts: Array<Record<string, unknown>> = []
  await page.route('**/api/contact', async (route) => {
    posts.push(JSON.parse(route.request().postData() ?? '{}'))
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  return posts
}

test('a required field says nothing until it is left, then clears on correction', async ({ page }) => {
  await page.goto('/')
  const email = page.getByLabel('Email')

  await email.click()
  await email.fill('not-an-email')
  // Still mid-edit: the visitor has not left the field, so nothing is said yet.
  await expect(page.getByRole('alert')).toHaveCount(0)

  await email.blur()
  await expect(page.getByRole('alert')).toHaveText(/valid email/i)

  // Live from here, so the message goes as the correction is made.
  await email.fill('someone@example.com')
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('a valid submit posts once, with the honeypot stripped', async ({ page }) => {
  const posts = await stubEndpoint(page)
  await page.goto('/')

  await page.getByLabel('Email').fill('someone@example.com')
  await page.getByLabel('Message').fill('Hello there.')
  await page.getByRole('button', { name: 'Send' }).click()

  await expect(page.getByRole('status')).toBeVisible()
  expect(posts).toHaveLength(1)
  expect(posts[0].formId).toBe('contact')
  expect((posts[0].values as Record<string, unknown>).email).toBe('someone@example.com')
  expect((posts[0].values as Record<string, unknown>).message).toBe('Hello there.')
  expect((posts[0].values as Record<string, unknown>)._vedit_hp).toBeUndefined()
})

test('an invalid submit focuses the first bad field and posts nothing', async ({ page }) => {
  const posts = await stubEndpoint(page)
  await page.goto('/')

  await page.getByRole('button', { name: 'Send' }).click()

  await expect(page.getByLabel('Email')).toBeFocused()
  await expect(page.getByRole('alert')).toHaveText(/required/i)
  expect(posts).toHaveLength(0)
})

test('a filled honeypot reports success and posts nothing', async ({ page }) => {
  const posts = await stubEndpoint(page)
  await page.goto('/')

  await page.getByLabel('Email').fill('someone@example.com')
  await page.locator('input[name="_vedit_hp"]').fill('buy pills', { force: true })
  await page.getByRole('button', { name: 'Send' }).click()

  // Success, so whoever wrote the bot learns nothing from the response.
  await expect(page.getByRole('status')).toBeVisible()
  expect(posts).toHaveLength(0)
})

test('an error is announced and tied to its field', async ({ page }) => {
  await page.goto('/')
  const email = page.getByLabel('Email')

  await email.click()
  await email.blur()

  const error = page.getByRole('alert')
  await expect(error).toBeVisible()
  await expect(email).toHaveAttribute('aria-invalid', 'true')

  // The message is reachable from the input, not merely next to it on screen.
  const describedBy = await email.getAttribute('aria-describedby')
  const errorId = await error.getAttribute('id')
  expect(describedBy?.split(' ')).toContain(errorId)
})

test('the form can be filled and submitted from the keyboard alone', async ({ page }) => {
  const posts = await stubEndpoint(page)
  await page.goto('/')

  await page.getByLabel('Email').focus()
  await page.keyboard.type('someone@example.com')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Sent without a mouse.')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')

  await expect(page.getByRole('status')).toBeVisible()
  expect(posts).toHaveLength(1)
})
