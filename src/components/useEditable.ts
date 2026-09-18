import { useCallback, useEffect, useMemo, useState } from 'react'
import { useVeditContext, useVeditState } from '../core/context'
import { warnOnce } from '../core/env'
import { migrateProps, type AnyComponentDefinition } from '../core/registry'
import { itemId, mergeOverrides, parseItemId } from '../runtime/repeat'
import { useRepeatItem } from './repeatContext'
import { useScope } from './scopeContext'
import type { RecordBinding } from '../content/types'
import type { EditableField, NodeKind, NodeOverride, VeditState } from '../core/types'

const EMPTY: NodeOverride = {}
const NO_NODES: Record<string, NodeOverride> = {}

export interface UseEditableOptions {
  id: string
  kind?: NodeKind
  /** Name shown in the layers panel. Defaults to the id's last segment. */
  label?: string
  /** Allow the editor to insert new elements inside this node. */
  container?: boolean
  /** Text as written in source, shown as the placeholder value in the inspector. */
  sourceText?: string
  /**
   * Values this node's text may interpolate, by name. The override stores
   * `Pay {amount} deposit`; the value of `amount` comes from here on every
   * render, so it is never frozen into the document.
   */
  vars?: Record<string, string>
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
  /**
   * The record field this node shows. A field name is resolved against the
   * enclosing repeat item's source and key; an object names the record itself.
   */
  bind?: string | RecordBinding
  /** The shared document this node's overrides live in. Defaults to the nearest scoped ancestor's. */
  scope?: string
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
  /** The record field this node shows, once `bind` has been resolved; undefined when unbound. */
  binding?: RecordBinding
}

export function labelFromId(id: string): string {
  // A repeat item's key is machinery, not a name: the layers panel should say
  // "Name", not "Name~team". Which card it is comes from the tree it sits in.
  const withoutItem = parseItemId(id)?.templateId ?? id
  const last = withoutItem.split(/[.:/]/).filter(Boolean).at(-1) ?? withoutItem
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
    id: templateId,
    kind = 'box',
    label,
    container = false,
    sourceText,
    vars,
    disabled = false,
    fields,
    props: sourceProps,
    definition,
    bind,
    scope: ownScope,
  } = options
  const { store } = useVeditContext()
  const [element, setElement] = useState<HTMLElement | null>(null)

  // Inside a repeat this node renders once per item, and each copy needs its own
  // identity: `cards.title` becomes `cards.title~sku-1`. The author's id stays
  // the template's, so an edit made to it reaches every item.
  const repeat = useRepeatItem()
  const id = repeat ? itemId(templateId, repeat.key) : templateId

  // The store routes a write from a node inside a scoped ancestor to that
  // ancestor's document, so the read has to follow the same rule or the edit
  // would land in one document and render from another.
  const inherited = useScope()
  const scope = ownScope ?? inherited ?? undefined

  const binding = useMemo(() => resolveBinding(templateId, bind, repeat?.source, repeat?.key), [
    templateId,
    bind,
    repeat?.source,
    repeat?.key,
  ])

  const nodesOf = (state: VeditState) => (scope ? (state.shared[scope]?.nodes ?? NO_NODES) : state.doc.nodes)
  const templateOverride = useVeditState((state) => nodesOf(state)[templateId])
  const itemOverride = useVeditState((state) => (repeat ? nodesOf(state)[id] : undefined))
  const override = useMemo(
    () => (repeat ? mergeOverrides(templateOverride, itemOverride) : (templateOverride ?? EMPTY)),
    [repeat, templateOverride, itemOverride],
  )
  const inlineEditing = useVeditState((state) => state.inlineEditing === id)

  // Serialized so that re-rendering with equal-but-new objects doesn't churn
  // the registry on every keystroke.
  const fieldsKey = fields ? JSON.stringify(fields) : ''
  const propsKey = sourceProps ? JSON.stringify(sourceProps) : ''
  // Values change on nearly every render (a price, a date), so the identity of
  // the object is useless as a dependency — compare what it says instead.
  const varsKey = vars ? JSON.stringify(vars) : ''
  const bindingKey = binding ? JSON.stringify(binding) : ''

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
      vars,
      fields,
      props: sourceProps,
      binding,
      scope,
    })
    return () => store.unregister(id, element)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, element, id, kind, label, container, sourceText, disabled, fieldsKey, propsKey, varsKey, bindingKey, scope])

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
    binding,
  }
}

/**
 * A field name means "this row's field", and there is only a row when the repeat
 * named a source. Outside one the name resolves to nothing, and the page says so
 * once rather than rendering the fallback with no clue why.
 */
function resolveBinding(
  templateId: string,
  bind: string | RecordBinding | undefined,
  source: string | undefined,
  key: string | undefined,
): RecordBinding | undefined {
  if (bind === undefined) return undefined
  if (typeof bind !== 'string') return bind
  if (source && key !== undefined) return { source, id: key, field: bind }
  warnOnce(
    `bind:${templateId}`,
    `<Editable id="${templateId}" bind="${bind}"> is not inside a repeat with a source, so there is no row ` +
      'to take the field from. Give the enclosing repeat a `source`, or bind with `{ source, id, field }`.',
  )
  return undefined
}
