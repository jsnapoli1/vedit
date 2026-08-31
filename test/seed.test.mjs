import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applySeed, emptyDocument, seedFromDom } from '../dist/index.js'

/**
 * `seedFromDom` reads a very small slice of the DOM — children, `matches`,
 * `textContent`, `tagName`, `className`. Faking exactly that slice keeps the
 * unit tests dependency-free and pins the surface the helper is allowed to use:
 * if it ever reaches for more, these tests break and say so.
 */
function element({ tag = 'div', block, text = '', children = [] } = {}) {
  return {
    tagName: tag.toUpperCase(),
    className: block ? `block ${block}` : '',
    children,
    textContent: text || children.map((child) => child.textContent).join(' '),
    matches(selector) {
      const match = /^\[data-block="(.+)"\]$/.exec(selector)
      if (match) return block === match[1]
      return selector === tag
    },
  }
}

const rules = [
  { component: 'Hero', selector: '[data-block="hero"]' },
  { component: 'Pricing', selector: '[data-block="pricing"]' },
]

test('a rendered region becomes the inserted nodes that recreate it', () => {
  const root = element({
    children: [element({ block: 'hero', text: 'Ship it' }), element({ block: 'pricing', text: 'Plans' })],
  })

  const seed = seedFromDom({ root, slotId: 'home.body', components: rules })

  assert.equal(seed.unmatched.length, 0)
  assert.deepEqual(
    seed.inserted.map((node) => ({ parentId: node.parentId, kind: node.kind, component: node.component, index: node.index })),
    [
      { parentId: 'home.body', kind: 'component', component: 'Hero', index: 0 },
      { parentId: 'home.body', kind: 'component', component: 'Pricing', index: 1 },
    ],
  )
})

test('ids are derived from position, so seeding twice gives the same document', () => {
  const build = () =>
    seedFromDom({
      root: element({ children: [element({ block: 'hero' }), element({ block: 'pricing' })] }),
      slotId: 'home.body',
      components: rules,
    })

  assert.deepEqual(build().inserted, build().inserted)
})

test('props are read off the element, so a seeded component keeps its real copy', () => {
  const root = element({ children: [element({ block: 'hero', text: 'Ship it' })] })

  const seed = seedFromDom({
    root,
    slotId: 'home.body',
    components: [{ ...rules[0], props: (el) => ({ title: el.textContent }) }],
  })

  const [id] = Object.keys(seed.props)
  assert.deepEqual(seed.props[id], { props: { title: 'Ship it' } })
})

test('content matching no rule is reported rather than silently dropped', () => {
  const root = element({
    children: [element({ block: 'hero' }), element({ tag: 'section', block: 'testimonials', text: 'Nice' })],
  })

  const seed = seedFromDom({ root, slotId: 'home.body', components: rules })

  assert.equal(seed.inserted.length, 1)
  assert.deepEqual(seed.unmatched, [{ tag: 'section', label: 'Nice' }])
})

test('loose text and images are emitted only when asked for', () => {
  const root = element({ children: [element({ tag: 'p', text: 'A note' }), element({ tag: 'img' })] })

  const off = seedFromDom({ root, slotId: 'home.body', components: [] })
  assert.equal(off.inserted.length, 0)
  assert.equal(off.unmatched.length, 2)

  const on = seedFromDom({ root, slotId: 'home.body', components: [], includeLooseContent: true })
  assert.deepEqual(on.inserted.map((node) => node.kind), ['text', 'image'])
})

test('applying a seed fills an empty slot', () => {
  const seed = seedFromDom({
    root: element({ children: [element({ block: 'hero' })] }),
    slotId: 'home.body',
    components: rules,
  })

  const doc = applySeed(emptyDocument('home'), seed)
  assert.equal(doc.inserted.length, 1)
  assert.equal(doc.inserted[0].component, 'Hero')
})

test("applying a seed never overwrites work someone has already done", () => {
  const seed = seedFromDom({
    root: element({ children: [element({ block: 'hero' })] }),
    slotId: 'home.body',
    components: rules,
  })

  const edited = {
    ...emptyDocument('home'),
    inserted: [{ id: 'home.body::added-abc123', parentId: 'home.body', kind: 'component', component: 'Pricing', index: 0 }],
  }

  assert.deepEqual(applySeed(edited, seed), edited)
})
