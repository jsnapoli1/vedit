import { useCallback, useEffect, useMemo, useState } from 'react'
import { useVeditContext, useVeditState } from '../core/context'
import { migrateProps, type AnyComponentDefinition } from '../core/registry'
import type { EditableField, NodeKind, NodeOverride } from '../core/types'

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
  /** Props the editor may change, and the controls to offer for them. */
  fields?: EditableField[]
  /** The prop values your code passed in. Overrides are layered on top. */
  props?: Record<string, unknown>
  /**
   * For a placed component: its registry entry, so stored props written against
   * an older schema are brought forward before the component sees them.
   */
  definition?: Pick<AnyComponentDefinition, 'version' | 'migrate'>
}

export interface UseEditableResult<P = Record<string, unknown>> {
  ref: (element: HTMLElement | null) => void
  /** Spread onto the element you want to make editable. */
  veditProps: { 'data-vedit-id': string; 'data-vedit-kind': NodeKind }
  override: NodeOverride
  /** True while this node is being typed into. */
  inlineEditing: boolean
  /** Your props with the editor's overrides applied. Render with these. */
  props: P
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
export function useEditable<P extends Record<string, unknown> = Record<string, unknown>>(
  options: UseEditableOptions,
): UseEditableResult<P> {
  const {
    id,
    kind = 'box',
    label,
    container = false,
    sourceText,
    disabled = false,
    fields,
    props: sourceProps,
    definition,
  } = options
  const { store } = useVeditContext()
  const [element, setElement] = useState<HTMLElement | null>(null)
  const override = useVeditState((state) => state.doc.nodes[id]) ?? EMPTY
  const inlineEditing = useVeditState((state) => state.inlineEditing === id)

  // Serialized so that re-rendering with equal-but-new objects doesn't churn
  // the registry on every keystroke.
  const fieldsKey = fields ? JSON.stringify(fields) : ''
  const propsKey = sourceProps ? JSON.stringify(sourceProps) : ''

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
      fields,
      props: sourceProps,
    })
    return () => store.unregister(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, element, id, kind, label, container, sourceText, disabled, fieldsKey, propsKey])

  const ref = useCallback((next: HTMLElement | null) => setElement(next), [])

  // Stored props are migrated on the way out, so a page written against an older
  // schema renders correctly straight away. The migrated shape is written back on
  // the next save rather than here: rendering a page should never write to it.
  const stored = useMemo(
    () =>
      definition
        ? migrateProps(definition, override.props, override.propsVersion)
        : { props: override.props ?? {}, version: 0, changed: false },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [definition, override.props, override.propsVersion],
  )

  useEffect(() => {
    if (!stored.changed || disabled) return
    store.stageMigratedProps(id, stored.props, stored.version)
  }, [store, id, stored, disabled])

  const props = useMemo(
    () => ({ ...(sourceProps ?? {}), ...stored.props }) as P,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [propsKey, stored.props],
  )

  return {
    ref,
    veditProps: { 'data-vedit-id': id, 'data-vedit-kind': kind },
    override,
    inlineEditing,
    props,
  }
}
