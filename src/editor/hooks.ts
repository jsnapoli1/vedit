import { useCallback, useEffect, useMemo, useState } from 'react'
import { useVeditNodes, useVeditState, useVeditStore } from '../core/context'
import { readStyleValue } from '../core/layers'
import type { VeditStore } from '../core/store'
import type { NodeOverride, RegisteredNode, StyleMap } from '../core/types'
import { parseItemId } from '../runtime/repeat'

/**
 * The node the inspector points at. With several selected this is the most
 * recently clicked one — the panels show its values and write to all of them.
 */
export function useSelectedNode(): {
  id: string | null
  node: RegisteredNode | undefined
  count: number
} {
  const store = useVeditStore()
  const selection = useVeditState((state) => state.selection)
  const id = selection.length ? selection[selection.length - 1] : null
  return { id, node: store.getNode(id), count: selection.length }
}

/**
 * A snapshot of the browser's computed style for a node, refreshed whenever the
 * document changes. Used to show real values as placeholders, so a field that
 * says `24px` is telling you what the site actually renders today.
 */
export function useComputedStyle(id: string | null): CSSStyleDeclaration | null {
  const store = useVeditStore()
  const doc = useVeditState((state) => state.doc)
  const [, setTick] = useState(0)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setTick((t) => t + 1))
    return () => cancelAnimationFrame(frame)
  }, [doc, id])

  return useMemo(() => {
    if (!id || typeof window === 'undefined') return null
    const element = store.getNode(id)?.element
    return element ? window.getComputedStyle(element) : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, doc, store])
}

/**
 * Every node a write from the inspector should reach: the whole selection when
 * the primary is part of it, otherwise just the primary.
 *
 * `useStyleValue` fans a single value out over these. A control whose value is a
 * patch on what is already there — a filter function, one part of the animation
 * shorthand — has to read and write each of them separately instead, or one
 * node's own value ends up overwritten with the primary's.
 */
export function useSelectionTargets(id: string | null): string[] {
  const selection = useVeditState((state) => state.selection)
  const targets = id ? (selection.includes(id) ? selection : [id]) : []
  const targetsKey = targets.join('|')
  return useMemo(() => (targetsKey ? targetsKey.split('|') : []), [targetsKey])
}

export interface StyleValue {
  /** The override in the active cell for the primary selection, if any. */
  value: string | number | undefined
  /** What the browser currently renders — shown as the field placeholder. */
  computed: string
  overridden: boolean
  /** True when the selected nodes don't agree on this property. */
  mixed: boolean
  /** Writes to every selected node. */
  set: (next: string | number | undefined) => void
  clear: () => void
}

/**
 * A style property across the current selection. Reads come from the primary
 * node; writes fan out to everything selected, which is what makes editing
 * several elements at once work without a second set of controls.
 */
export function useStyleValue(id: string | null, property: string): StyleValue {
  const store = useVeditStore()
  const breakpoint = useVeditState((state) => state.breakpoint)
  const styleState = useVeditState((state) => state.styleState)
  const doc = useVeditState((state) => state.doc)
  const selection = useVeditState((state) => state.selection)
  const computedStyle = useComputedStyle(id)

  const targets = id ? (selection.includes(id) ? selection : [id]) : []
  const value = readStyleValue(doc.nodes[id ?? ''], styleState, breakpoint, property)
  const mixed = targets.some(
    (target) => readStyleValue(doc.nodes[target], styleState, breakpoint, property) !== value,
  )

  const targetsKey = targets.join('|')
  const set = useCallback(
    (next: string | number | undefined) => {
      const ids = targetsKey ? targetsKey.split('|') : []
      if (!ids.length) return
      if (next === undefined || next === '') store.clearStylesMany(ids, [property])
      else store.setStyleMany(ids.map((target) => [target, { ...flexPin(store, target, property), [property]: next }]))
    },
    [store, targetsKey, property],
  )

  const clear = useCallback(() => {
    const ids = targetsKey ? targetsKey.split('|') : []
    if (ids.length) store.clearStylesMany(ids, [property])
  }, [store, targetsKey, property])

  return {
    value,
    computed: computedStyle?.getPropertyValue(kebab(property)) ?? '',
    overridden: value !== undefined,
    mixed,
    set,
    clear,
  }
}

/**
 * A width or height on a child its flex row sizes is a wish until the row is
 * told to stop: the row grows or shrinks the child regardless. So a size set
 * on such a child pins it (`flex: 0 0 auto`), the same as the resize handles do.
 */
export function flexPin(store: VeditStore, id: string, property: string): StyleMap {
  if (property !== 'width' && property !== 'height') return {}
  const element = store.getNode(id)?.element
  const view = element?.ownerDocument.defaultView
  if (!element || !view || !element.parentElement) return {}
  if (!view.getComputedStyle(element.parentElement).display.includes('flex')) return {}
  const own = view.getComputedStyle(element)
  if (own.position === 'absolute' || own.position === 'fixed') return {}
  if (parseFloat(own.flexGrow) > 0 || parseFloat(own.flexShrink) > 0) return { flex: '0 0 auto' }
  return {}
}

/** Read/write a non-style override field such as `text`, `src` or `href`. */
export function useContentValue<K extends keyof NodeOverride>(
  id: string | null,
  key: K,
): [NodeOverride[K] | undefined, (next: NodeOverride[K] | undefined) => void] {
  const store = useVeditStore()
  const value = useVeditState((state) => (id ? state.doc.nodes[id]?.[key] : undefined))
  const selection = useVeditState((state) => state.selection)
  const targetsKey = (id && selection.includes(id) ? selection : id ? [id] : []).join('|')
  const setValue = useCallback(
    (next: NodeOverride[K] | undefined) => {
      const ids = targetsKey ? targetsKey.split('|') : []
      if (ids.length) store.updateMany(ids, { [key]: next } as NodeOverride)
    },
    [store, targetsKey, key],
  )
  return [value, setValue]
}

/** The row of a content source that the selection is a rendering of. */
export interface BoundRepeat {
  source: string
  /** The record id — the item key, which is what `bind` resolves against. */
  rowId: string
  /** Every bound node of this item, by field, for reading the row back off the page. */
  fields: RegisteredNode[]
}

/**
 * The bound repeat the selection sits in, if any.
 *
 * A repeat registers nothing of its own — only its items' nodes exist, each with
 * an item id — so "inside a bound repeat" is read off those: the selection (or
 * an ancestor) carries an item key, and some node of that same item is bound to
 * a row with that key. The source is taken from that binding, which is where
 * `useEditable` put it.
 *
 * Two repeats can share keys (`0`, `1`, …) when their rows have no id, so the
 * bound nodes are only trusted when they hang off the same parent as the
 * selection's item does — every item of one repeat has the same parent, and a
 * neighbouring repeat's items have another.
 */
export function boundRepeatOf(store: VeditStore, nodes: RegisteredNode[], id: string | null): BoundRepeat | null {
  let key: string | null = null
  let root: RegisteredNode | undefined
  let current: string | null = id
  const seen = new Set<string>()
  while (current && !seen.has(current)) {
    seen.add(current)
    const node = store.getNode(current)
    if (!node) break
    const parsed = parseItemId(node.id)
    if (parsed && key === null) key = parsed.key
    if (key !== null) {
      if (parsed?.key !== key) break
      root = node
    }
    current = node.parentId
  }
  if (key === null || !root) return null

  const parent = root.parentId
  const fields = nodes.filter((node) => {
    const binding = node.binding
    if (!binding || binding.id !== key || parseItemId(node.id)?.key !== key) return false
    return itemRootOf(store, node, key)?.parentId === parent
  })
  const source = fields[0]?.binding?.source
  return source ? { source, rowId: key, fields } : null
}

/** The topmost node of an item: the last one up the chain still carrying its key. */
function itemRootOf(store: VeditStore, node: RegisteredNode, key: string): RegisteredNode | undefined {
  let root = node
  const seen = new Set<string>([node.id])
  while (root.parentId && !seen.has(root.parentId)) {
    seen.add(root.parentId)
    const parent = store.getNode(root.parentId)
    if (!parent || parseItemId(parent.id)?.key !== key) break
    root = parent
  }
  return root
}

/** `boundRepeatOf` for the current selection, following the registry as items mount. */
export function useBoundRepeat(id: string | null): BoundRepeat | null {
  const store = useVeditStore()
  const nodes = useVeditNodes()
  return useMemo(() => boundRepeatOf(store, nodes, id), [store, nodes, id])
}

/** Write several declarations at once, e.g. a whole shadow preset. */
export function useStyleWriter(id: string | null): (styles: StyleMap) => void {
  const store = useVeditStore()
  return useCallback(
    (styles: StyleMap) => {
      if (id) store.setStyle(id, styles)
    },
    [store, id],
  )
}

function kebab(property: string): string {
  return property.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
}
