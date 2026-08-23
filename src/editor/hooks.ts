import { useCallback, useEffect, useMemo, useState } from 'react'
import { useVeditState, useVeditStore } from '../core/context'
import type { NodeOverride, RegisteredNode, StyleMap } from '../core/types'

/** The node the inspector is pointed at, if exactly one is selected. */
export function useSelectedNode(): { id: string | null; node: RegisteredNode | undefined } {
  const store = useVeditStore()
  const selection = useVeditState((state) => state.selection)
  const id = selection.length === 1 ? selection[0] : null
  return { id, node: store.getNode(id) }
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
  /** The override at the active breakpoint, if any. */
  value: string | number | undefined
  /** What the browser currently renders — shown as the field placeholder. */
  computed: string
  overridden: boolean
  set: (next: string | number | undefined) => void
  clear: () => void
}

export function useStyleValue(id: string | null, property: string): StyleValue {
  const store = useVeditStore()
  const breakpoint = useVeditState((state) => state.breakpoint)
  const override = useVeditState((state) => (id ? state.doc.nodes[id] : undefined))
  const computedStyle = useComputedStyle(id)

  const value =
    breakpoint === 'base' ? override?.style?.[property] : override?.responsive?.[breakpoint]?.[property]

  const set = useCallback(
    (next: string | number | undefined) => {
      if (!id) return
      if (next === undefined || next === '') store.clearStyle(id, property)
      else store.setStyle(id, { [property]: next })
    },
    [store, id, property],
  )

  const clear = useCallback(() => {
    if (id) store.clearStyle(id, property)
  }, [store, id, property])

  return {
    value,
    computed: computedStyle?.getPropertyValue(kebab(property)) ?? '',
    overridden: value !== undefined,
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
  const setValue = useCallback(
    (next: NodeOverride[K] | undefined) => {
      if (id) store.update(id, { [key]: next } as NodeOverride)
    },
    [store, id, key],
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
