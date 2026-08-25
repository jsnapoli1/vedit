import { useCallback, useEffect, useMemo, useState } from 'react'
import { useVeditState, useVeditStore } from '../core/context'
import { readStyleValue } from '../core/layers'
import type { NodeOverride, RegisteredNode, StyleMap } from '../core/types'

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
      else store.setStyleMany(ids.map((target) => [target, { [property]: next }]))
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
