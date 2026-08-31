import type { InsertedNode, NodeKind, VeditDocument } from './types'

/**
 * Turning a hand-written region into a slot is the one migration in this library
 * that can't be done incrementally: the moment a `<VeditSlot>` renders, the JSX
 * that used to be there is gone, and the slot renders whatever the document says
 * — which, on day one, is nothing. The page goes blank.
 *
 * The fix is to seed the document so it describes what the code used to render,
 * and this builds that seed from the rendered page rather than by hand. Run it
 * once against a real render, commit the JSON it produces, and the slot comes up
 * on day one looking exactly like the region it replaced.
 *
 * It only emits what a slot can actually render: components you have registered,
 * plus text and image nodes. Anything else is reported rather than guessed at,
 * because a seed that silently drops half a page is worse than one that refuses.
 */

/** How to recognise a registered component in the rendered DOM. */
export interface SeedComponentRule {
  /** The name the document should store — a key of your component registry. */
  component: string
  /** Elements matching this are emitted as that component. */
  selector: string
  /**
   * Optional: read the component's props off the element. Whatever this returns
   * is stored as the node's props, so a seeded Hero keeps its real heading.
   */
  props?: (element: Element) => Record<string, unknown> | undefined
}

export interface SeedOptions {
  /** The rendered region that is about to become a slot. */
  root: Element
  /** The slot's id — every emitted node hangs off this. */
  slotId: string
  /** How to map elements to your registered components, tried in order. */
  components: SeedComponentRule[]
  /**
   * Emit plain text and image nodes for content that matches no component rule.
   * Off by default: for most migrations, anything unmatched is a missing rule.
   */
  includeLooseContent?: boolean
}

export interface SeedResult {
  /** Ready to merge into a document's `inserted` array. */
  inserted: InsertedNode[]
  /** Props per node id, to merge into the document's `nodes`. */
  props: Record<string, { props: Record<string, unknown> }>
  /**
   * Elements directly under the root that matched nothing. Each one is content
   * that will not appear in the slot — read this before trusting the seed.
   */
  unmatched: Array<{ tag: string; label: string }>
}

/**
 * Ids are derived from position, not random, so running this twice on the same
 * page produces the same document — a seed script has to be re-runnable, and its
 * output has to be diffable when the page it describes changes.
 */
function seedId(slotId: string, index: number, component: string): string {
  return `${slotId}::seed-${index}-${component.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
}

function labelOf(element: Element): string {
  const text = (element.textContent ?? '').trim().replace(/\s+/g, ' ')
  if (text) return text.length > 48 ? `${text.slice(0, 48)}…` : text
  const className = typeof element.className === 'string' ? element.className.split(/\s+/)[0] : ''
  return className ? `.${className}` : element.tagName.toLowerCase()
}

/**
 * Describe a rendered region as the `inserted` nodes that would recreate it.
 *
 * ```ts
 * const seed = seedFromDom({
 *   root: document.querySelector('#home-body')!,
 *   slotId: 'home.body',
 *   components: [
 *     { component: 'Hero', selector: '[data-block="hero"]',
 *       props: (el) => ({ title: el.querySelector('h1')?.textContent ?? '' }) },
 *     { component: 'Pricing', selector: '[data-block="pricing"]' },
 *   ],
 * })
 * if (seed.unmatched.length) throw new Error('unmapped blocks: ' + JSON.stringify(seed.unmatched))
 * ```
 */
export function seedFromDom(options: SeedOptions): SeedResult {
  const { root, slotId, components, includeLooseContent = false } = options
  const inserted: InsertedNode[] = []
  const props: SeedResult['props'] = {}
  const unmatched: SeedResult['unmatched'] = []

  const children = [...root.children]
  children.forEach((element) => {
    const index = inserted.length
    const rule = components.find((candidate) => element.matches(candidate.selector))

    if (rule) {
      const id = seedId(slotId, index, rule.component)
      inserted.push({ id, parentId: slotId, kind: 'component', component: rule.component, index })
      const values = rule.props?.(element)
      if (values && Object.keys(values).length) props[id] = { props: values }
      return
    }

    if (includeLooseContent) {
      const kind = looseKind(element)
      if (kind) {
        inserted.push({ id: seedId(slotId, index, kind), parentId: slotId, kind, index })
        return
      }
    }

    unmatched.push({ tag: element.tagName.toLowerCase(), label: labelOf(element) })
  })

  return { inserted, props, unmatched }
}

/** Only the kinds a slot can render on its own, without a registered component. */
function looseKind(element: Element): Extract<NodeKind, 'text' | 'image'> | null {
  const tag = element.tagName.toLowerCase()
  if (tag === 'img' || tag === 'picture') return 'image'
  if ((element.textContent ?? '').trim()) return 'text'
  return null
}

/**
 * Merge a seed into a document. Existing content wins: running a seed against a
 * document people have already edited must never overwrite their work, so this
 * is a no-op for any slot that already has nodes in it.
 */
export function applySeed(doc: VeditDocument, seed: SeedResult): VeditDocument {
  const slotIds = new Set(seed.inserted.map((node) => node.parentId))
  const alreadyFilled = doc.inserted.some((node) => slotIds.has(node.parentId))
  if (alreadyFilled || !seed.inserted.length) return doc

  return {
    ...doc,
    inserted: [...doc.inserted, ...seed.inserted],
    nodes: { ...doc.nodes, ...seed.props },
  }
}
