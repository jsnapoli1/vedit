import assert from 'node:assert/strict'
import { test } from 'node:test'
import { httpContentClient, localContentClient } from '../dist/content.js'

/**
 * A fetch that remembers every request and answers from a table keyed by
 * `METHOD pathname`, whether the client was given a relative or an absolute
 * endpoint. Anything not in the table is answered with `{}` so a route the
 * test does not care about still resolves.
 */
const fakeFetch = (answers = {}) => {
  const requests = []
  const fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET'
    const path = new URL(String(url), 'http://localhost').pathname
    requests.push({ url: String(url), method, init })
    const answer = answers[`${method} ${path}`]
    if (answer instanceof Response) return answer.clone()
    if (typeof answer === 'function') return answer({ url: String(url), init })
    return json(answer ?? {})
  }
  return { fetch, requests }
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const bodyOf = (request) => JSON.parse(request.init.body)

test('httpContentClient builds the routes and sends same-origin credentials', async () => {
  const { fetch, requests } = fakeFetch({
    'GET /vedit/v1/schema': json({ sources: [{ name: 'posts' }] }),
    'GET /vedit/v1/content/posts/a': json({ id: 'a', title: 'A' }),
    'GET /vedit/v1/content/posts/missing': json({ error: 'Not found' }, 404),
    'GET /vedit/v1/content/posts/a/versions': json({ items: [{ id: 'v1', savedAt: '2026-01-01T00:00:00.000Z', stage: 'draft' }] }),
    'POST /vedit/v1/content/posts/a/versions/v1/restore': new Response(null, { status: 204 }),
    'POST /vedit/v1/content/publish': new Response(null, { status: 204 }),
  })
  // A trailing slash on the endpoint is tolerated, and the extra header goes out on every request.
  const client = httpContentClient({ endpoint: '/vedit/', headers: { 'x-site': 'demo' }, fetch })

  assert.deepEqual(await client.schema(), [{ name: 'posts' }])
  assert.deepEqual(await client.get('posts', 'a', { stage: 'draft' }), { id: 'a', title: 'A' })
  assert.equal(await client.get('posts', 'missing'), null)
  assert.deepEqual(await client.versions('posts', 'a'), [{ id: 'v1', savedAt: '2026-01-01T00:00:00.000Z', stage: 'draft' }])
  await client.restoreVersion('posts', 'a', 'v1')
  await client.publish({ posts: ['a'] })

  assert.deepEqual(
    requests.map((request) => [request.method, request.url]),
    [
      ['GET', '/vedit/v1/schema'],
      ['GET', '/vedit/v1/content/posts/a?stage=draft'],
      ['GET', '/vedit/v1/content/posts/missing'],
      ['GET', '/vedit/v1/content/posts/a/versions'],
      ['POST', '/vedit/v1/content/posts/a/versions/v1/restore'],
      ['POST', '/vedit/v1/content/publish'],
    ],
  )
  for (const request of requests) {
    assert.equal(request.init.credentials, 'same-origin', `${request.method} ${request.url} should be same-origin`)
    assert.equal(request.init.headers['x-site'], 'demo', `${request.method} ${request.url} should carry the extra header`)
  }
  const publish = requests[5]
  assert.equal(publish.init.headers['content-type'], 'application/json')
  assert.deepEqual(bodyOf(publish), { records: { posts: ['a'] } })
})

test('list encodes where, orderBy, limit, populate and stage', async () => {
  const { fetch, requests } = fakeFetch({
    'GET /vedit/v1/content/posts': json({ items: [{ id: 'a' }, { id: 'b' }] }),
  })
  const client = httpContentClient({ endpoint: 'https://example.com/vedit', fetch })

  assert.deepEqual(await client.list('posts'), [{ id: 'a' }, { id: 'b' }])
  await client.list('posts', {
    where: { category: 'news', tag: ['x', 'y'] },
    orderBy: '-publishedAt',
    limit: 5,
    populate: ['category', 'author'],
    stage: 'draft',
  })

  assert.equal(requests[0].url, 'https://example.com/vedit/v1/content/posts')
  const params = new URL(requests[1].url).searchParams
  assert.equal(new URL(requests[1].url).pathname, '/vedit/v1/content/posts')
  assert.equal(params.get('stage'), 'draft')
  assert.equal(params.get('where[category]'), 'news')
  // An array in where repeats the field, which is how the server reads "any of these".
  assert.deepEqual(params.getAll('where[tag]'), ['x', 'y'])
  assert.equal(params.get('orderBy'), '-publishedAt')
  assert.equal(params.get('limit'), '5')
  assert.equal(params.get('populate'), 'category,author')
})

test('commit posts the batch and returns the idMap', async () => {
  const { fetch, requests } = fakeFetch({
    'POST /vedit/v1/content/commit': json({ idMap: { 'new-abc': 'srv1' }, updatedAt: '2026-01-01T00:00:00.000Z' }),
  })
  const client = httpContentClient({ endpoint: '/vedit', fetch })
  const changes = { posts: { create: [{ id: 'new-abc', title: 'New' }], update: { a: { title: 'A2' } } } }

  const result = await client.commit(changes, { stage: 'draft' })
  assert.deepEqual(result, { idMap: { 'new-abc': 'srv1' }, updatedAt: '2026-01-01T00:00:00.000Z' })

  assert.equal(requests.length, 1)
  assert.equal(requests[0].method, 'POST')
  assert.equal(requests[0].url, '/vedit/v1/content/commit')
  assert.equal(requests[0].init.headers['content-type'], 'application/json')
  assert.deepEqual(bodyOf(requests[0]), { changes, stage: 'draft' })
})

test('login, logout and capabilities hit their routes', async () => {
  const user = { id: 'u1', email: 'sam@example.com', role: 'editor' }
  const capabilities = {
    user,
    login: true,
    can: { write: true, publish: true, upload: true, data: { write: true, delete: true } },
  }
  const { fetch, requests } = fakeFetch({
    'POST /vedit/v1/auth/login': json({ user, token: 'tok-123' }),
    'POST /vedit/v1/auth/logout': new Response(null, { status: 204 }),
    'GET /vedit/v1/capabilities': json(capabilities),
  })
  const client = httpContentClient({ endpoint: '/vedit', fetch })

  assert.deepEqual(await client.capabilities(), capabilities)
  assert.deepEqual(await client.login('sam@example.com', 'vedit-demo'), user)
  await client.capabilities()
  await client.logout()
  await client.capabilities()

  assert.deepEqual(
    requests.map((request) => [request.method, request.url]),
    [
      ['GET', '/vedit/v1/capabilities'],
      ['POST', '/vedit/v1/auth/login'],
      ['GET', '/vedit/v1/capabilities'],
      ['POST', '/vedit/v1/auth/logout'],
      ['GET', '/vedit/v1/capabilities'],
    ],
  )
  assert.deepEqual(bodyOf(requests[1]), { email: 'sam@example.com', password: 'vedit-demo' })
  // The token from login rides along until logout, for hosts where no cookie can carry the session.
  assert.equal(requests[0].init.headers.authorization, undefined)
  assert.equal(requests[2].init.headers.authorization, 'Bearer tok-123')
  assert.equal(requests[3].init.headers.authorization, 'Bearer tok-123')
  assert.equal(requests[4].init.headers.authorization, undefined)
})

test('a non-2xx answer becomes an error carrying the server message', async () => {
  const { fetch } = fakeFetch({
    'POST /vedit/v1/content/commit': json({ error: 'Not allowed' }, 403),
    'GET /vedit/v1/content/posts': new Response('gateway fell over', { status: 502, statusText: 'Bad Gateway' }),
    'GET /vedit/v1/schema': new Response(null, { status: 500, statusText: 'Internal Server Error' }),
  })
  const client = httpContentClient({ endpoint: '/vedit', fetch })

  await assert.rejects(client.commit({ posts: { update: { a: { title: 'x' } } } }, { stage: 'draft' }), {
    message: 'Not allowed',
  })
  // Without a JSON error field the status line is all there is to say.
  await assert.rejects(client.list('posts'), { message: '502 Bad Gateway' })
  await assert.rejects(client.schema(), { message: '500 Internal Server Error' })
})

test('localContentClient round-trips commit, list, get and publish with everything allowed', async () => {
  const client = localContentClient({
    collections: {
      posts: { fields: { title: 'text', order: 'number' }, orderField: 'order' },
    },
    globals: {
      site: { fields: { tagline: 'text' } },
    },
    seed: { posts: [{ id: 'a', title: 'A', order: 0 }] },
  })

  // No init call: the first operation brings the store up, seed included.
  assert.deepEqual(
    (await client.list('posts')).map((row) => [row.id, row.title]),
    [['a', 'A']],
  )

  const capabilities = await client.capabilities()
  assert.deepEqual(capabilities, {
    user: null,
    login: false,
    can: { write: true, publish: true, upload: true, data: { write: true, delete: true } },
  })
  assert.deepEqual(
    (await client.schema()).map((source) => [source.name, source.kind]),
    [['posts', 'collection'], ['site', 'global']],
  )

  const { idMap } = await client.commit(
    { posts: { create: [{ id: 'new-abc', title: 'B' }], update: { a: { title: 'A2' } } } },
    { stage: 'draft' },
  )
  const created = idMap['new-abc']
  assert.ok(created && !created.startsWith('new-'), 'the create gets a server id')

  // The draft sees both changes; visitors still see the seed as it was.
  const draft = await client.list('posts', { stage: 'draft', orderBy: 'title' })
  assert.deepEqual(draft.map((row) => [row.id, row.title, row._status]), [['a', 'A2', 'changed'], [created, 'B', 'draft']])
  assert.deepEqual((await client.list('posts')).map((row) => row.title), ['A'])
  assert.equal((await client.get('posts', created, { stage: 'draft' })).title, 'B')
  assert.equal(await client.get('posts', created), null)
  assert.equal(await client.get('posts', 'nope', { stage: 'draft' }), null)

  await client.publish({ posts: ['a', created] })
  assert.deepEqual(
    (await client.list('posts', { orderBy: 'title' })).map((row) => [row.title, row._status]),
    [['A2', 'published'], ['B', 'published']],
  )
  assert.equal((await client.versions('posts', 'a')).length, 1)

  // A global is one record, created empty the first time anyone asks.
  assert.deepEqual((await client.list('site')).map((row) => row.id), ['global'])
})
