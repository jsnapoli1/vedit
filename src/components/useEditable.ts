import { useCallback, useEffect, useState } from 'react'
import { useVeditContext, useVeditState } from '../core/context'
import type { NodeKind, NodeOverride } from '../core/types'

const EMPTY: NodeOverride = {}

export interface UseEditableOptions {
  id: string
  kind?: NodeKind
  /** Name shown in the layers panel. Defaults to the id's last segment. */
  label?: string
  /** Allow the editor to insert new elements inside this node. */
  container?: boolean
  /** Text as written in source, shown as the placeholder value in the inspector. */
  sourceText?: string
  /** Skip registration entirely, e.g. for a node rendered in a portal you don't own. */
  disabled?: boolean
}

export interface UseEditableResult {
  ref: (element: HTMLElement | null) => void
  /** Spread onto the element you want to make editable. */
  veditProps: { 'data-vedit-id': string; 'data-vedit-kind': NodeKind }
  override: NodeOverride
  /** True while this node is being typed into. */
  inlineEditing: boolean
}

export function labelFromId(id: string): string {
  const last = id.split(/[.:/]/).filter(Boolean).at(-1) ?? id
  return last.replace(/[-_]/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

/**
 * Registers an element with the editor and hands back the override the editor has
 * recorded for it. Use this when you need full control over rendering; otherwise
 * reach for `<Editable>`.
 */
export function useEditable(options: UseEditableOptions): UseEditableResult {
  const { id, kind = 'box', label, container = false, sourceText, disabled = false } = options
  const { store } = useVeditContext()
  const [element, setElement] = useState<HTMLElement | null>(null)
  const override = useVeditState((state) => state.doc.nodes[id]) ?? EMPTY
  const inlineEditing = useVeditState((state) => state.inlineEditing === id)

  useEffect(() => {
    if (!element || disabled) return
    const parent = element.parentElement?.closest<HTMLElement>('[data-vedit-id]') ?? null
    store.register({
      id,
      kind,
      label: label ?? labelFromId(id),
      element,
      parentId: parent?.getAttribute('data-vedit-id') ?? null,
      auto: false,
      container,
      sourceText,
    })
    return () => store.unregister(id)
  }, [store, element, id, kind, label, container, sourceText, disabled])

  const ref = useCallback((next: HTMLElement | null) => setElement(next), [])

  return {
    ref,
    veditProps: { 'data-vedit-id': id, 'data-vedit-kind': kind },
    override,
    inlineEditing,
  }
}
