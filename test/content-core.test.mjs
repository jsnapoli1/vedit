import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  RecordOperationError,
  applyRecordOperations,
  assetUrl,
  defineCollections,
  defineGlobals,
  isTempId,
  matchWhere,
  newRecordId,
  normalizeFields,
  overlayChanges,
  parseRecordQuery,
  remapIds,
  schemaFor,
  segmentsAfterVersion,
  sortRows,
  validateRecord,
} from '../dist/content.js'

const collections = defineCollections({
  posts: {
    fields: { title: { type: 'text', required: true }, blurb: 'richtext', position: 'number' },
    titleField: 'title',
    orderField: 'position',
  },
  inquiries: {
    fields: { email: 'text' },
    access: { read: 'admin', create: 'public', update: (ctx) => ctx.role === 'admin' },
  },
})

const globals = defineGlobals({
  site: { fields: { name: 'text' } },
})

const can = (schema, name) => schema.find((source) => source.name === name).can

test('defineCollections hands back what it was given', () => {
  const spec = { posts: { fields: { title: 'text' } } }
  assert.equal(defineCollections(spec), spec)
  const site = { site: { fields: { name: 'text' } } }
  assert.equal(defineGlobals(site), site)
})

test('a bare field type expands to a spec', () => {
  assert.deepEqual(normalizeFields({ title: 'text', body: { type: 'richtext', required: true } }), {
    title: { type: 'text' },
    body: { type: 'richtext', required: true },
  })
})

test('the schema for a role says what that role may do', () => {
  const asPublic = schemaFor(collections, globals, 'public')
  const posts = asPublic.find((source) => source.name === 'posts')
  assert.equal(posts.kind, 'collection')
  assert.equal(posts.label, 'Posts')
  assert.equal(posts.titleField, 'title')
  assert.equal(posts.orderField, 'position')
  assert.equal(posts.drafts, true)
  assert.deepEqual(posts.fields, [
    { name: 'title', type: 'text', label: 'Title', required: true },
    { name: 'blurb', type: 'richtext', label: 'Blurb' },
    { name: 'position', type: 'number', label: 'Position' },
  ])
  assert.deepEqual(posts.can, { read: true, create: false, update: false, delete: false, publish: false })

  const site = asPublic.find((source) => source.name === 'site')
  assert.equal(site.kind, 'global')
  assert.equal(site.label, 'Site')

  assert.deepEqual(can(schemaFor(collections, globals, 'author'), 'posts'), {
    read: true,
    create: true,
    update: true,
    delete: true,
    publish: false,
  })
  assert.equal(can(schemaFor(collections, globals, 'editor'), 'posts').publish, true)
  assert.equal(can(schemaFor(collections, globals, 'admin'), 'posts').publish, true)
})

test('an inquiry source lets the public create and only admins read', () => {
  const asPublic = can(schemaFor(collections, globals, 'public'), 'inquiries')
  assert.equal(asPublic.create, true)
  assert.equal(asPublic.read, false)
  // A function rule is the handler's call; here it only means "possible".
  assert.equal(asPublic.update, false)
  assert.equal(can(schemaFor(collections, globals, 'author'), 'inquiries').update, true)
  assert.equal(can(schemaFor(collections, globals, 'editor'), 'inquiries').read, false)
  assert.equal(can(schemaFor(collections, globals, 'admin'), 'inquiries').read, true)
})

test('applyRecordOperations folds set, create, delete and reorder into changes', () => {
  const before = {}
  const changes = applyRecordOperations(before, [
    { op: 'set-record', source: 'posts', id: 'a', data: { title: 'A' } },
    { op: 'create-record', source: 'posts', id: 'new-1', data: { title: 'N' } },
    { op: 'delete-record', source: 'posts', id: 'b' },
    { op: 'reorder-records', source: 'posts', order: ['a', 'new-1'] },
    { op: 'set-record', source: 'site', id: 'global', data: { name: 'Acme' } },
    { op: 'create-record', source: 'posts', data: { title: 'Unnamed' } },
  ])
  assert.deepEqual(changes.site, { update: { global: { name: 'Acme' } } })
  assert.deepEqual(changes.posts.update, { a: { title: 'A' } })
  assert.deepEqual(changes.posts.delete, ['b'])
  assert.deepEqual(changes.posts.order, ['a', 'new-1'])
  assert.equal(changes.posts.create.length, 2)
  assert.deepEqual(changes.posts.create[0], { id: 'new-1', title: 'N' })
  assert.equal(isTempId(changes.posts.create[1].id), true)
  assert.equal(changes.posts.create[1].title, 'Unnamed')
  assert.deepEqual(before, {}, 'the incoming changes are not mutated')

  // A second set on the same record layers over the first.
  const again = applyRecordOperations(changes, [{ op: 'set-record', source: 'posts', id: 'a', data: { blurb: 'x' } }])
  assert.deepEqual(again.posts.update.a, { title: 'A', blurb: 'x' })
})

test('a set on a freshly created record merges into the create', () => {
  const changes = applyRecordOperations({}, [
    { op: 'create-record', source: 'posts', id: 'new-1', data: { title: 'N' } },
    { op: 'set-record', source: 'posts', id: 'new-1', data: { blurb: 'B' } },
  ])
  assert.deepEqual(changes.posts.create, [{ id: 'new-1', title: 'N', blurb: 'B' }])
  assert.equal(changes.posts.update, undefined)

  // The same holds when the create came from an earlier batch.
  const later = applyRecordOperations(changes, [{ op: 'set-record', source: 'posts', id: 'new-1', data: { title: 'N2' } }])
  assert.deepEqual(later.posts.create, [{ id: 'new-1', title: 'N2', blurb: 'B' }])
  assert.equal(later.posts.update, undefined)
})

test('deleting a record created in the same batch drops both', () => {
  const changes = applyRecordOperations({}, [
    { op: 'create-record', source: 'posts', id: 'new-1', data: { title: 'N' } },
    { op: 'reorder-records', source: 'posts', order: ['a', 'new-1'] },
    { op: 'delete-record', source: 'posts', id: 'new-1' },
  ])
  assert.deepEqual(changes.posts?.create ?? [], [])
  assert.deepEqual(changes.posts?.delete ?? [], [])
  assert.deepEqual(changes.posts?.order ?? ['a'], ['a'])

  // Deleting a real record also forgets any pending edit to it.
  const gone = applyRecordOperations({}, [
    { op: 'set-record', source: 'posts', id: 'a', data: { title: 'A' } },
    { op: 'delete-record', source: 'posts', id: 'a' },
  ])
  assert.equal(gone.posts.update, undefined)
  assert.deepEqual(gone.posts.delete, ['a'])
})

test('a malformed record operation is refused with its index', () => {
  const bad = { op: 'set-record', id: 'a', data: {} }
  assert.throws(
    () => applyRecordOperations({}, [{ op: 'set-record', source: 'posts', id: 'a', data: {} }, bad]),
    (error) => error instanceof RecordOperationError && error.index === 1 && error.operation === bad && /source/.test(error.message),
  )
  assert.throws(
    () => applyRecordOperations({}, [{ op: 'explode', source: 'posts' }]),
    (error) => error instanceof RecordOperationError && error.index === 0,
  )
  assert.throws(
    () => applyRecordOperations({}, [{ op: 'reorder-records', source: 'posts', order: 'a' }]),
    (error) => error instanceof RecordOperationError && error.index === 0,
  )
  assert.throws(
    () => applyRecordOperations({}, [{ op: 'set-record', source: 'posts', id: 'a', data: 'nope' }]),
    (error) => error instanceof RecordOperationError && error.index === 0,
  )
  assert.throws(
    () => applyRecordOperations({}, 'not a list'),
    (error) => error instanceof RecordOperationError && error.index === 0,
  )
})

test('overlayChanges applies updates, hides deletes, appends creates and honours the order field', () => {
  const rows = [
    { id: 'a', title: 'A', position: 0 },
    { id: 'b', title: 'B', position: 1 },
    { id: 'c', title: 'C', position: 2 },
  ]
  const changes = {
    posts: {
      update: { a: { title: 'A2' } },
      delete: ['b'],
      create: [{ id: 'new-1', title: 'N' }],
    },
  }
  const plain = overlayChanges('posts', rows, changes)
  assert.deepEqual(plain, [
    { id: 'a', title: 'A2', position: 0 },
    { id: 'c', title: 'C', position: 2 },
    { id: 'new-1', title: 'N' },
  ])
  assert.deepEqual(rows[0], { id: 'a', title: 'A', position: 0 }, 'the host rows are untouched')

  const schema = schemaFor(collections, globals, 'admin').find((source) => source.name === 'posts')
  const ordered = overlayChanges('posts', rows, { posts: { ...changes.posts, order: ['c', 'new-1', 'a'] } }, schema)
  assert.deepEqual(
    ordered.map((row) => [row.id, row.position]),
    [
      ['c', 0],
      ['new-1', 1],
      ['a', 2],
    ],
  )

  // Rows the order list does not mention keep their place after the ones it does.
  const partial = overlayChanges('posts', rows, { posts: { order: ['c'] } }, schema)
  assert.deepEqual(
    partial.map((row) => row.id),
    ['c', 'a', 'b'],
  )

  assert.deepEqual(overlayChanges('other', rows, changes), rows)
})

test('remapIds rewrites temp ids in changes', () => {
  const changes = {
    posts: {
      create: [{ id: 'new-1', title: 'N' }],
      update: { 'new-2': { title: 'U' }, a: { title: 'A' } },
      delete: ['new-3', 'b'],
      order: ['a', 'new-1'],
    },
    site: { update: { global: { name: 'Acme' } } },
  }
  const mapped = remapIds(changes, { 'new-1': 'p1', 'new-2': 'p2', 'new-3': 'p3' })
  assert.deepEqual(mapped, {
    posts: {
      create: [{ id: 'p1', title: 'N' }],
      update: { p2: { title: 'U' }, a: { title: 'A' } },
      delete: ['p3', 'b'],
      order: ['a', 'p1'],
    },
    site: { update: { global: { name: 'Acme' } } },
  })
  assert.deepEqual(changes.posts.create, [{ id: 'new-1', title: 'N' }], 'the input is left alone')
  assert.notEqual(mapped, changes)
})

test('remapIds renames repeat item overrides and inserted parents keyed by a temp id', () => {
  const doc = {
    version: 1,
    key: 'catalog',
    updatedAt: '2026-01-01T00:00:00.000Z',
    nodes: {
      'cards.title~new-abc': { text: 'Fresh' },
      'cards.title~sku-1': { text: 'Old' },
      hero: { text: 'Hero' },
      'cards.title': { style: { color: 'red' } },
    },
    inserted: [
      { id: 'cards.box~new-abc::added-1', parentId: 'cards.box~new-abc', kind: 'text', index: 0 },
      { id: 'hero::added-2', parentId: 'hero', kind: 'text', index: 0 },
    ],
    tokens: [],
  }
  const mapped = remapIds(doc, { 'new-abc': 'p9' })
  assert.deepEqual(Object.keys(mapped.nodes).sort(), ['cards.title', 'cards.title~p9', 'cards.title~sku-1', 'hero'])
  assert.deepEqual(mapped.nodes['cards.title~p9'], { text: 'Fresh' })
  assert.equal(mapped.inserted[0].parentId, 'cards.box~p9')
  assert.equal(mapped.inserted[0].id, 'cards.box~new-abc::added-1', 'only the parent link is renamed')
  assert.deepEqual(mapped.inserted[1], doc.inserted[1])
  assert.equal(mapped.version, 1)
  assert.equal(mapped.key, 'catalog')
  assert.equal(mapped.updatedAt, doc.updatedAt)
  assert.equal(mapped.tokens, doc.tokens)
  assert.notEqual(mapped, doc)
  assert.ok('cards.title~new-abc' in doc.nodes, 'the input is left alone')

  // A document with nothing to rename comes back equal, still as a new object.
  const same = remapIds(doc, { 'new-zzz': 'p1' })
  assert.deepEqual(same, doc)
  assert.notEqual(same, doc)
})

test('validateRecord reports missing required fields and wrong types by field name', () => {
  const schema = {
    name: 'posts',
    kind: 'collection',
    label: 'Posts',
    drafts: true,
    can: { read: true, create: true, update: true, delete: true, publish: true },
    fields: [
      { name: 'title', type: 'text', label: 'Title', required: true },
      { name: 'count', type: 'number', label: 'Count' },
      { name: 'live', type: 'boolean', label: 'Live' },
      { name: 'when', type: 'date', label: 'When' },
      { name: 'tone', type: 'select', label: 'Tone', options: ['warm', { value: 'cool', label: 'Cool' }] },
      { name: 'cover', type: 'image', label: 'Cover' },
      { name: 'category', type: 'relation', label: 'Category', to: 'categories' },
      { name: 'tags', type: 'relation', label: 'Tags', to: 'tags', many: true },
      { name: 'body', type: 'richtext', label: 'Body' },
      { name: 'extra', type: 'json', label: 'Extra' },
    ],
  }

  const bad = {
    count: 'lots',
    live: 'yes',
    when: 'someday',
    tone: 'loud',
    cover: { name: 'x' },
    category: 7,
    tags: 'one',
    body: '<b>Hi</b><script>alert(1)</script>',
    extra: { anything: true },
  }
  const messages = validateRecord(schema, bad)
  for (const field of ['title', 'count', 'live', 'when', 'tone', 'cover', 'category', 'tags']) {
    assert.ok(
      messages.some((message) => message.includes(field)),
      `expected a message naming ${field} in ${JSON.stringify(messages)}`,
    )
  }
  assert.ok(!messages.some((message) => message.includes('extra')))
  assert.ok(!messages.some((message) => message.includes('body')))
  assert.equal(bad.body, '<b>Hi</b>', 'rich text is sanitised in place')

  const good = {
    title: 'Hello',
    count: 3,
    live: false,
    when: '2026-09-14',
    tone: 'cool',
    cover: { url: '/a.png' },
    category: 'c1',
    tags: ['t1', 't2'],
    body: '<em>fine</em>',
  }
  assert.deepEqual(validateRecord(schema, good), [])
  assert.deepEqual(validateRecord(schema, { title: 'Only the required one', cover: '/legacy.png' }), [])
  assert.deepEqual(validateRecord(schema, { title: '' }), ['title is required'])
  assert.deepEqual(validateRecord(schema, 'nope'), ['Expected a record'])
})

test('matchWhere and sortRows handle equality, arrays and descending order', () => {
  const rows = [
    { id: 'b', n: 2, name: 'Beta', status: 'live' },
    { id: 'a', n: 1, name: 'alpha', status: 'draft' },
    { id: 'c', n: 3, name: 'Gamma' },
  ]
  assert.equal(matchWhere(rows[0], { n: 2 }), true)
  // Over HTTP every value arrives as a string, so a scalar matches its string form.
  assert.equal(matchWhere(rows[0], { n: '2' }), true)
  assert.equal(matchWhere({ id: 'x', live: true }, { live: 'true' }), true)
  assert.equal(matchWhere({ id: 'x', live: false }, { live: 'true' }), false)
  assert.equal(matchWhere({ id: 'x', n: 2 }, { n: [1, '2'] }), true)
  assert.equal(matchWhere({ id: 'x', tags: ['a'] }, { tags: 'a' }), false)
  assert.equal(matchWhere(rows[0], { status: ['live', 'draft'] }), true)
  assert.equal(matchWhere(rows[2], { status: ['live', 'draft'] }), false)
  assert.equal(matchWhere(rows[0], {}), true)
  assert.equal(matchWhere(rows[0], undefined), true)

  assert.deepEqual(
    sortRows(rows, 'n').map((row) => row.id),
    ['a', 'b', 'c'],
  )
  assert.deepEqual(
    sortRows(rows, '-n').map((row) => row.id),
    ['c', 'b', 'a'],
  )
  assert.deepEqual(
    sortRows(rows, 'name').map((row) => row.id),
    ['a', 'b', 'c'],
    'strings sort case-insensitively',
  )
  assert.deepEqual(
    sortRows(rows, 'status').map((row) => row.id),
    ['a', 'b', 'c'],
    'a missing value sorts last',
  )
  assert.deepEqual(sortRows(rows, undefined), rows)
  assert.equal(rows[0].id, 'b', 'sorting does not reorder the input')

  // The query that the http routes carry is parsed into the same shapes.
  const query = parseRecordQuery(new URLSearchParams('stage=draft&where[status]=live&where[n]=2&orderBy=-n&limit=5&populate=category,tags'))
  assert.deepEqual(query, {
    stage: 'draft',
    where: { status: 'live', n: '2' },
    orderBy: '-n',
    limit: 5,
    populate: ['category', 'tags'],
  })
  assert.deepEqual(parseRecordQuery(new URLSearchParams('')), {})
  assert.deepEqual(parseRecordQuery(new URLSearchParams('stage=other&limit=x')), {})

  assert.deepEqual(segmentsAfterVersion('/vedit/v1/content/x'), ['content', 'x'])
  assert.deepEqual(segmentsAfterVersion('/v1/content/x'), ['content', 'x'])
  assert.deepEqual(segmentsAfterVersion('/v1/content/a%20b'), ['content', 'a b'])
  assert.equal(segmentsAfterVersion('/content/x'), null)
})

test('assetUrl accepts an asset object or a plain url', () => {
  assert.equal(assetUrl({ url: '/a.png', kind: 'image' }), '/a.png')
  assert.equal(assetUrl('/b.pdf'), '/b.pdf')
  assert.equal(assetUrl(null), '')
  assert.equal(assetUrl(undefined), '')
  assert.equal(assetUrl(42), '')
  assert.equal(assetUrl({ name: 'no url' }), '')
})

test('a temp id survives a repeat key', () => {
  const seen = new Set()
  for (let i = 0; i < 50; i += 1) {
    const id = newRecordId()
    assert.match(id, /^new-[a-z0-9]{8}$/)
    assert.doesNotMatch(id, /[~:>#[\]]/)
    assert.equal(isTempId(id), true)
    seen.add(id)
  }
  assert.ok(seen.size > 1, 'ids are random')
  assert.equal(isTempId('p1'), false)
  assert.equal(isTempId('renewed'), false)
  assert.equal(isTempId(''), false)
})

test('a field default is described to the client', () => {
  const described = defineCollections({
    cards: { fields: { live: { type: 'boolean', default: true }, title: 'text', at: { type: 'date', default: 'now' } } },
  })
  const fields = schemaFor(described, {}, 'author').find((source) => source.name === 'cards').fields
  assert.deepEqual(
    fields.map((field) => [field.name, field.default]),
    [
      ['live', true],
      ['title', undefined],
      ['at', 'now'],
    ],
  )
})
