import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyOperations, describeDocument, emptyDocument, migrateDocument } from '../dist/server.js'
import { SHAPE_PRESETS, parseShape, shapeStyleDefaults } from '../dist/index.js'
import { pruneOverride, shapeElements } from '../dist/internal.js'

/**
 * A shape's geometry is an override like any other, which is the whole reason it
 * lives there: it undoes, it travels, it prunes. What is different is that it
 * comes off the wire as unvalidated data, so `parseShape` is where the trust
 * stops.
 */

const blank = () => emptyDocument('home')

/* ---------------------------------------------------------------- parsing */

test('the five shape types parse', () => {
  assert.deepEqual(parseShape({ type: 'rect' }), { type: 'rect' })
  assert.deepEqual(parseShape({ type: 'rect', rx: 8 }), { type: 'rect', rx: 8 })
  assert.deepEqual(parseShape({ type: 'circle' }), { type: 'circle' })
  assert.deepEqual(parseShape({ type: 'line', x1: 0, y1: 50, x2: 100, y2: 50 }), {
    type: 'line',
    x1: 0,
    y1: 50,
    x2: 100,
    y2: 50,
  })
  assert.deepEqual(parseShape({ type: 'polygon', points: [[0, 0], [10, 0], [5, 10]] }), {
    type: 'polygon',
    points: [[0, 0], [10, 0], [5, 10]],
  })

  const custom = parseShape({ type: 'custom', svg: '<svg viewBox="0 0 4 4"><rect/></svg>' })
  assert.equal(custom.type, 'custom')
  assert.equal(custom.viewBox, '0 0 4 4')
})

test('a corner radius is clamped to the box it rounds', () => {
  assert.deepEqual(parseShape({ type: 'rect', rx: 400 }), { type: 'rect', rx: 50 })
  assert.deepEqual(parseShape({ type: 'rect', rx: -4 }), { type: 'rect', rx: 0 })
})

test('malformed geometry is refused rather than repaired', () => {
  assert.equal(parseShape(null), null)
  assert.equal(parseShape('circle'), null)
  assert.equal(parseShape([]), null)
  assert.equal(parseShape({ type: 'blob' }), null)
  assert.equal(parseShape({ type: 'line', x1: 0, y1: 0, x2: 'far', y2: 0 }), null)
  assert.equal(parseShape({ type: 'line', x1: 0, y1: 0, x2: Infinity, y2: 0 }), null)
  assert.equal(parseShape({ type: 'line', x1: 0, y1: 0, x2: NaN, y2: 0 }), null)
  assert.equal(parseShape({ type: 'rect', rx: 'lots' }), null)
})

test('a polygon needs at least three points and at most 256', () => {
  assert.equal(parseShape({ type: 'polygon', points: [[0, 0], [1, 1]] }), null)
  assert.equal(parseShape({ type: 'polygon', points: 'lots' }), null)
  assert.equal(parseShape({ type: 'polygon', points: [[0, 0], [1, 1], [2]] }), null)
  assert.equal(parseShape({ type: 'polygon', points: [[0, 0], [1, 1], ['x', 2]] }), null)

  const many = Array.from({ length: 257 }, (_, index) => [index, index])
  assert.equal(parseShape({ type: 'polygon', points: many }), null)
  assert.ok(parseShape({ type: 'polygon', points: many.slice(0, 256) }))
})

test('custom markup is sanitised on the way through, and a bad viewBox replaced', () => {
  const parsed = parseShape({
    type: 'custom',
    svg: '<svg viewBox="0 0 8 8"><script>alert(1)</script><path d="M0 0"/></svg>',
    viewBox: '"><script>alert(1)</script>',
  })
  assert.ok(!parsed.svg.includes('script'))
  assert.ok(parsed.svg.includes('d="M0 0"'))
  assert.equal(parsed.viewBox, '0 0 8 8', 'a viewBox that is not four numbers comes from the file')

  assert.equal(parseShape({ type: 'custom', svg: 'not an svg' }), null)
  assert.equal(parseShape({ type: 'custom', svg: 42 }), null)
})

test('a stored custom shape re-parses, because what is stored is the inner markup', () => {
  // The render path runs the stored shape through `parseShape` and the sanitiser
  // again on every mount, so a shape that only survived the *import* path would
  // draw nothing the second time anyone loaded the page.
  const imported = parseShape({
    type: 'custom',
    svg: '<svg viewBox="0 0 8 8"><path d="M0 0"/></svg>',
  })
  const reparsed = parseShape(imported)
  assert.deepEqual(reparsed, imported)
})

test('a viewBox out of the document cannot break out of the attribute it lands in', () => {
  const parsed = parseShape({
    type: 'custom',
    svg: '<path d="M0 0"/>',
    viewBox: '0 0 8 8"><script>alert(1)</script><x y="',
  })
  assert.ok(parsed)
  assert.ok(!parsed.svg.includes('script'))
  assert.equal(parsed.viewBox, '0 0 100 100', 'a viewBox that is not four numbers is replaced')
})

test('parsing returns a fresh object, so the caller cannot reach into the document', () => {
  const input = { type: 'polygon', points: [[0, 0], [1, 1], [2, 2]] }
  const parsed = parseShape(input)
  assert.notEqual(parsed, input)
  assert.notEqual(parsed.points, input.points)
  assert.notEqual(parsed.points[0], input.points[0])
})

test('every preset parses, and the polygons are closed shapes', () => {
  for (const [name, preset] of Object.entries(SHAPE_PRESETS)) {
    assert.deepEqual(parseShape(preset), preset, `${name} survives its own parser`)
  }
  assert.equal(SHAPE_PRESETS.triangle.points.length, 3)
  assert.equal(SHAPE_PRESETS.star.points.length, 10)
  assert.equal(SHAPE_PRESETS.hexagon.points.length, 6)
})

/* --------------------------------------------------------------- drawing */

test('preset geometry becomes one child element, drawn in the 100 box', () => {
  const [rect] = shapeElements({ type: 'rect', rx: 8 })
  assert.equal(rect.tag, 'rect')
  assert.equal(rect.attrs.width, '100')
  assert.equal(rect.attrs.rx, '8')

  const [circle] = shapeElements({ type: 'circle' })
  assert.deepEqual(
    { tag: circle.tag, cx: circle.attrs.cx, rx: circle.attrs.rx },
    { tag: 'ellipse', cx: '50', rx: '50' },
  )

  const [line] = shapeElements({ type: 'line', x1: 0, y1: 50, x2: 100, y2: 50 })
  assert.equal(line.tag, 'line')
  assert.equal(line.attrs.x2, '100')

  const [polygon] = shapeElements({ type: 'polygon', points: [[0, 0], [10, 0], [5, 10]] })
  assert.equal(polygon.tag, 'polygon')
  assert.equal(polygon.attrs.points, '0,0 10,0 5,10')
})

test('every preset child carries the attributes the stroke and the draw animation need', () => {
  for (const preset of Object.values(SHAPE_PRESETS)) {
    for (const element of shapeElements(preset)) {
      assert.equal(element.attrs.pathLength, '1')
      assert.equal(element.attrs.vectorEffect, 'non-scaling-stroke')
      assert.equal(element.attrs.fill, undefined, 'colour is inherited from the root')
      assert.equal(element.attrs.stroke, undefined)
    }
  }
})

/* --------------------------------------------------------------- defaults */

test('a line is stroked and everything else is filled', () => {
  const line = shapeStyleDefaults(SHAPE_PRESETS.line)
  assert.equal(line.fill, 'none')
  assert.equal(line.stroke, '#94a3b8')

  const circle = shapeStyleDefaults(SHAPE_PRESETS.circle)
  assert.equal(circle.fill, '#94a3b8')
  assert.equal(circle.stroke, undefined)

  const custom = shapeStyleDefaults({ type: 'custom', svg: '', viewBox: '0 0 1 1' })
  assert.equal(custom.fill, undefined, 'imported artwork keeps its own colours')
  assert.equal(custom.width, '160px')
})

/* -------------------------------------------------------------- inserting */

test('insert-node writes the defaults for the geometry it is given', () => {
  const { doc, created } = applyOperations(blank(), [
    { op: 'insert-node', parentId: 'hero', kind: 'shape', shape: { type: 'circle' } },
  ])
  const id = created[0]
  assert.deepEqual(doc.inserted[0], { id, parentId: 'hero', kind: 'shape', index: 0 })
  assert.deepEqual(doc.nodes[id].shape, { type: 'circle' })
  assert.equal(doc.nodes[id].style.fill, '#94a3b8')
  assert.equal(doc.nodes[id].style.width, '160px')

  const stroked = applyOperations(blank(), [
    { op: 'insert-node', parentId: 'hero', kind: 'shape', shape: SHAPE_PRESETS.line },
  ]).doc
  assert.equal(Object.values(stroked.nodes)[0].style.fill, 'none')
})

test('an explicit style replaces the defaults, as it does for every other kind', () => {
  const { doc, created } = applyOperations(blank(), [
    {
      op: 'insert-node',
      parentId: 'hero',
      kind: 'shape',
      shape: { type: 'rect' },
      override: { style: { width: '40px' } },
    },
  ])
  assert.deepEqual(doc.nodes[created[0]].style, { width: '40px' })
  assert.deepEqual(doc.nodes[created[0]].shape, { type: 'rect' })
})

test('a shape without geometry, or with bad geometry, is refused', () => {
  assert.throws(
    () => applyOperations(blank(), [{ op: 'insert-node', parentId: 'hero', kind: 'shape' }]),
    /`shape` is required when kind is `shape`/,
  )
  assert.throws(
    () =>
      applyOperations(blank(), [
        { op: 'insert-node', parentId: 'hero', kind: 'shape', shape: { type: 'blob' } },
      ]),
    /`shape` is not a valid shape/,
  )
})

/* --------------------------------------------------------------- editing */

test('set-shape round-trips and refuses garbage', () => {
  const start = applyOperations(blank(), [
    { op: 'insert-node', parentId: 'hero', kind: 'shape', id: 'hero::s', shape: { type: 'rect' } },
  ]).doc

  const { doc, changed } = applyOperations(start, [
    { op: 'set-shape', id: 'hero::s', shape: { type: 'polygon', points: [[0, 0], [100, 0], [50, 100]] } },
  ])
  assert.deepEqual(doc.nodes['hero::s'].shape, {
    type: 'polygon',
    points: [[0, 0], [100, 0], [50, 100]],
  })
  assert.deepEqual(changed, ['hero::s'])
  assert.equal(doc.nodes['hero::s'].style.fill, '#94a3b8', 'the style it was given is left alone')

  assert.throws(
    () => applyOperations(start, [{ op: 'set-shape', id: 'hero::s', shape: { type: 'polygon', points: [] } }]),
    /`shape` is not a valid shape/,
  )
  assert.throws(() => applyOperations(start, [{ op: 'set-shape', shape: { type: 'rect' } }]), /`id` is required/)
})

/* ------------------------------------------------------------- surviving */

test('describeDocument names a shape among a node overrides', () => {
  const doc = applyOperations(blank(), [
    { op: 'insert-node', parentId: 'hero', kind: 'shape', id: 'hero::s', shape: { type: 'circle' } },
  ]).doc
  const node = describeDocument(doc).nodes.find((candidate) => candidate.id === 'hero::s')
  assert.ok(node.overrides.includes('shape'))
  assert.ok(node.overrides.includes('style'))
  assert.equal(node.inserted, true)
})

test('a stored shape survives a load with its geometry intact', () => {
  const stored = {
    version: 1,
    key: 'home',
    updatedAt: '2026-01-01T00:00:00.000Z',
    nodes: { 'hero::s': { shape: { type: 'rect', rx: 12 }, style: { fill: 'red' } } },
    inserted: [{ id: 'hero::s', parentId: 'hero', kind: 'shape', index: 0 }],
    tokens: [],
  }
  const doc = migrateDocument(stored)
  assert.deepEqual(doc.inserted, stored.inserted, 'the node is not dropped as an unknown kind')
  assert.deepEqual(doc.nodes['hero::s'].shape, { type: 'rect', rx: 12 })
})

test('pruneOverride keeps a shape and drops an absent one', () => {
  assert.deepEqual(pruneOverride({ shape: { type: 'circle' } }), { shape: { type: 'circle' } })
  assert.equal(pruneOverride({ shape: undefined }), undefined)
  assert.deepEqual(pruneOverride({ shape: undefined, text: 'x' }), { text: 'x' })
})
