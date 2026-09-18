import { createElement, forwardRef, useEffect, useMemo, type ElementType, type ReactNode, type Ref } from 'react'
import { useEditable } from './useEditable'
import { useVeditContext, useVeditState } from '../core/context'
import { findComponent, type AnyComponentDefinition } from '../core/registry'
import { interpolate } from '../runtime/interpolate'
import { itemKey } from '../runtime/repeat'
import { RepeatItemContext, useRepeatItem } from './repeatContext'
import { ScopeContext, useScope } from './scopeContext'
import { safeUrl, sanitizeHtml } from '../runtime/sanitize'
import { isFileHref } from '../runtime/fileHref'
import { assetUrl } from '../content/assets'
import { ShapeView } from './Shape'
import type { RecordBinding } from '../content/types'
import type { EditableField, InsertedNode, NodeKind } from '../core/types'

export interface EditableProps {
  /**
   * Stable identifier for this node. Overrides are keyed on it, so keep it the
   * same across deploys — think `home.hero.title`, not an array index.
   */
  id: string
  /** Element or component to render. Defaults to `div`. */
  as?: ElementType
  kind?: NodeKind
  label?: string
  /** Allow new text/images/boxes to be dropped inside. */
  container?: boolean
  /**
   * Values this element's text may interpolate, by name.
   *
   * Write the source text as a template and pass the current values:
   *
   * ```jsx
   * <Editable id="register.pay" vars={{ amount: money(quote.depositCents) }}>
   *   {`Pay {amount} deposit`}
   * </Editable>
   * ```
   *
   * Someone editing this in the browser sees `Pay {amount} deposit` and can move
   * the words around, but the number itself stays yours — it is substituted on
   * every render, so it can never go stale in the stored document.
   */
  vars?: Record<string, string>
  /**
   * Render the children once per item of this array.
   *
   * The array is yours and stays yours: it is passed in on every render and
   * never written to the document, exactly as `vars` is. vedit repeats the
   * template over it and stores overrides, so a repeat over `products` can't go
   * stale and can't freeze a price into saved content.
   *
   * ```jsx
   * <Editable id="cards" repeat={products}>
   *   <EditableText id="cards.title">Buy now</EditableText>
   * </Editable>
   * ```
   *
   * Editing a card in the browser changes every card, because that is nearly
   * always what someone means; the inspector offers "this card only" for when it
   * isn't. Each item is given a key from its own data (`id`, `key`, `slug` or
   * `uuid`), so edits stay attached to the right card when the list reorders.
   * Pass `repeatKey` when the key lives somewhere else.
   */
  repeat?: readonly unknown[]
  /** Where an item's stable key lives, when it isn't `id`/`key`/`slug`/`uuid`. */
  repeatKey?: (item: unknown, index: number) => string
  /**
   * Which content source the repeated items are rows of. Only meaningful with
   * `repeat`. Naming it is what lets the children bind to fields by name and the
   * editor add, remove and reorder rows.
   *
   * ```jsx
   * <Editable id="products" repeat={rows} source="products">
   *   <EditableText id="products.title" bind="title">Untitled</EditableText>
   * </Editable>
   * ```
   */
  source?: string
  /**
   * What a row added from this repeat starts with, on top of the schema's
   * defaults. A repeat that shows one column's links, or one category's
   * products, names that relation here, so the row an editor adds appears
   * where they added it instead of under nothing.
   *
   * ```jsx
   * <Editable id="column.links" repeat={links} source="links" newRow={{ column: column.id }}>
   * ```
   */
  newRow?: Record<string, unknown>
  /**
   * Show a record field instead of the children. A field name resolves against
   * the enclosing repeat's `source` and this item's key; a `{ source, id, field }`
   * object names the record outright, for a global or a row rendered on its own.
   *
   * What is bound is the content — the text, the image, the file — and edits to
   * it go to the record, not to the document. Styling stays with the document
   * as usual. Until the row is known the children render as they would unbound.
   */
  bind?: string | RecordBinding
  /**
   * Which shared document this node's overrides live in — `"site"` for a nav
   * that every page renders, so an edit made on one page shows on all of them.
   * Pass the same key to `VeditProvider`'s `sharedKeys`.
   */
  scope?: string
  /**
   * Props the editor may change. Only props named here are editable, and the
   * schema decides which control the inspector shows for each one.
   */
  fields?: EditableField[]
  children?: ReactNode
  className?: string
  /** Anything else is forwarded to the underlying element. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [prop: string]: any
}

/** What `forwardRef` hands the render function: `EditableProps` minus `ref`. */
type RenderProps = Omit<EditableProps, 'ref'>

/** Stable, so a shared document that has not loaded yet does not re-render on every read. */
const NO_INSERTED: InsertedNode[] = []

function mergeRefs<T>(...refs: Array<Ref<T> | undefined>) {
  return (value: T) => {
    for (const ref of refs) {
      if (typeof ref === 'function') ref(value)
      else if (ref && typeof ref === 'object') (ref as { current: T | null }).current = value
    }
  }
}

/**
 * Marks a piece of your UI as editable. In view mode it renders exactly what you
 * wrote, plus whatever the editor has overridden; in edit mode it becomes
 * clickable, selectable and inspectable.
 */
export const Editable = forwardRef<HTMLElement, EditableProps>(function Editable(props, forwardedRef) {
  // Split before any hook runs, so the two paths never share a hook order.
  // A repeat is a loop rather than an element: it registers nothing itself and
  // renders no box, because wrapping content the host laid out in a div of ours
  // is how a library breaks someone's grid.
  if (props.repeat) return <Repeat {...props} />
  return <EditableNode {...props} forwardedRef={forwardedRef} />
})

function Repeat({ repeat, repeatKey, source, newRow, children }: RenderProps) {
  return (
    <>
      {((repeat ?? []) as readonly unknown[]).map((item: unknown, index: number) => {
        const key = itemKey(item, index, repeatKey)
        return (
          <RepeatItemContext.Provider key={key} value={{ item, key, index, source, newRow }}>
            {children}
          </RepeatItemContext.Provider>
        )
      })}
    </>
  )
}

const EditableNode = function EditableNode({
  id,
  as,
  kind,
  label,
  container = false,
  vars,
  fields,
  children,
  className,
  forwardedRef,
  repeat: _repeat,
  repeatKey: _repeatKey,
  source: _source,
  newRow: _newRow,
  bind,
  scope,
  ...rest
}: RenderProps & { forwardedRef?: Ref<HTMLElement> }) {
  const resolvedKind: NodeKind = kind ?? inferKind(as, children, rest.href)
  const isContainer = container || resolvedKind === 'box'
  const sourceText = typeof children === 'string' ? children : undefined
  const schema = fields as EditableField[] | undefined
  const declared = schema
    ? Object.fromEntries(schema.map((field) => [field.name, rest[field.name]]))
    : undefined
  const { ref, veditProps, override, props: edited, binding } = useEditable({
    id,
    kind: resolvedKind,
    label,
    container: isContainer,
    sourceText,
    vars,
    fields: schema,
    props: declared,
    bind,
    scope,
  })
  const { bound, richtext } = useBoundValue(binding, bind)
  const inherited = useScope()

  const Component = (as ?? defaultTagFor(resolvedKind)) as ElementType
  const props: Record<string, unknown> = { ...rest, ...(schema ? edited : {}), ...veditProps }

  // A bound node shows its record, and which part of it depends on what the
  // node is: an image's source, a link's destination, everything else's text.
  // The document's own copy of that key is skipped — edits went to the record —
  // while a class, visibility and styling still apply as they do to any node.
  const bindsUrl = resolvedKind === 'image' || resolvedKind === 'link' || resolvedKind === 'file' || resolvedKind === 'button'
  const boundUrl = bindsUrl ? bound : undefined
  const boundText = bindsUrl ? undefined : bound

  props.ref = mergeRefs(ref, forwardedRef)
  props.className = [className, override.className].filter(Boolean).join(' ') || undefined
  // URLs come out of the stored document, so they get the same treatment as its
  // HTML: anything that would execute rather than navigate is dropped. A record
  // is no more trusted than the document: it went through the same editor.
  if (boundUrl !== undefined) {
    if (resolvedKind === 'image') {
      props.src = safeUrl(assetUrl(boundUrl), { allowDataImage: true }) ?? ''
      // Alt is the document's even on a bound image — it describes this use of
      // the asset — with the asset's own description standing in for it.
      const alt = override.alt ?? assetAlt(boundUrl)
      if (alt !== undefined) props.alt = alt
    } else {
      props.href = safeUrl(assetUrl(boundUrl)) ?? '#'
    }
  } else {
    if (override.src !== undefined) props.src = safeUrl(override.src, { allowDataImage: true }) ?? ''
    if (override.alt !== undefined) props.alt = override.alt
    if (override.href !== undefined) props.href = safeUrl(override.href) ?? '#'
  }
  if (override.target !== undefined) props.target = override.target
  if (props.target === '_blank' && props.rel === undefined) props.rel = 'noopener noreferrer'

  // Templates are resolved on the way out, never on the way in: what is stored
  // stays `Pay {amount} deposit`, and only what renders carries the number. The
  // source text goes through it too, so a component can be written as a template
  // and read correctly before anyone has edited it. A record value is data, not
  // a template, so it is shown as it is.
  let content: ReactNode = vars && sourceText !== undefined ? interpolate(sourceText, vars) : children
  if (boundText !== undefined) {
    if (richtext) {
      props.dangerouslySetInnerHTML = { __html: sanitizeHtml(textOf(boundText), { profile: 'block' }) }
      content = undefined
    } else {
      content = textOf(boundText)
    }
  } else if (override.html !== undefined) {
    props.dangerouslySetInnerHTML = { __html: sanitizeHtml(interpolate(override.html, vars)) }
    content = undefined
  } else if (override.text !== undefined) {
    content = interpolate(override.text, vars)
  }

  const element =
    isVoidElement(Component) || props.dangerouslySetInnerHTML
      ? createElement(Component, props)
      : createElement(
          Component,
          props,
          content,
          isContainer ? <InsertedChildren key="vedit-inserted" parentId={id} scope={scope ?? inherited ?? undefined} /> : null,
        )
  // Only a node that names a scope provides one; everything below it then reads
  // and writes the same shared document it does.
  return scope ? <ScopeContext.Provider value={scope}>{element}</ScopeContext.Provider> : element
}

/**
 * What a bound node shows. A pending edit or a fetched row comes first; failing
 * that, the row the repeat is rendering — the host's own copy, which on a server
 * render is the only one there is. `undefined` means no row is known yet, and
 * the node renders as if it were unbound.
 */
function useBoundValue(binding: RecordBinding | undefined, bind: string | RecordBinding | undefined) {
  const { store } = useVeditContext()
  const repeat = useRepeatItem()
  const stored = useVeditState(() => (binding ? store.recordValue(binding) : undefined))
  const richtext = useVeditState((state) =>
    binding
      ? state.schema
          ?.find((source) => source.name === binding.source)
          ?.fields.find((field) => field.name === binding.field)?.type === 'richtext'
      : false,
  )
  const item = typeof bind === 'string' && repeat?.source && isRecord(repeat.item) ? repeat.item[bind] : undefined
  // A node bound outside a repeat has no host row to fall back on, so it asks
  // for its source itself. Effects never run on the server, which is what keeps
  // a server render from fetching.
  const source = binding && item === undefined ? binding.source : undefined
  useEffect(() => {
    if (source) store.ensureRecords(source)
  }, [store, source])
  if (!binding) return { bound: undefined, richtext: false }
  if (stored !== undefined) return { bound: stored, richtext }
  return { bound: item, richtext }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** A field's value as text. A number or a boolean reads fine; an object would read as `[object Object]`. */
function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

/** The description an asset carries, when the editor gave it one. */
function assetAlt(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  return typeof value.alt === 'string' ? value.alt : undefined
}

function inferKind(as: ElementType | undefined, children: ReactNode, href?: unknown): NodeKind {
  if (as === 'img') return 'image'
  if (as === 'a') return isFileHref(href) ? 'file' : 'link'
  if (as === 'button') return 'button'
  if (typeof as === 'string' && /^(h[1-6]|p|span|li|label|blockquote|figcaption|strong|em)$/.test(as)) {
    return 'text'
  }
  if (typeof children === 'string' || typeof children === 'number') return 'text'
  return 'box'
}

function defaultTagFor(kind: NodeKind): ElementType {
  switch (kind) {
    case 'text':
      return 'span'
    case 'image':
      return 'img'
    case 'link':
    case 'file':
      return 'a'
    case 'button':
      return 'button'
    case 'shape':
      return 'svg'
    default:
      return 'div'
  }
}

function isVoidElement(component: ElementType): boolean {
  return typeof component === 'string' && (component === 'img' || component === 'br' || component === 'hr' || component === 'input')
}

/**
 * Renders the elements someone added through the editor inside a container.
 * `scope` names the shared document a scoped container's children were placed
 * in; without it they come from the page's own.
 */
export function InsertedChildren({ parentId, scope }: { parentId: string; scope?: string }) {
  const inserted = useVeditState((state) => (scope ? (state.shared[scope]?.inserted ?? NO_INSERTED) : state.doc.inserted))
  const children = useMemo(
    () => inserted.filter((node) => node.parentId === parentId).sort((a, b) => a.index - b.index),
    [inserted, parentId],
  )
  if (!children.length) return null
  return (
    <>
      {children.map((node) => (
        <InsertedView key={node.id} node={node} />
      ))}
    </>
  )
}

function InsertedView({ node }: { node: InsertedNode }) {
  if (node.kind === 'component') return <PlacedComponent node={node} />
  switch (node.kind) {
    case 'image':
      return <Editable id={node.id} as="img" kind="image" label="Image" src="" alt="" />
    case 'text':
      return (
        <Editable id={node.id} as="p" kind="text" label="Text">
          {''}
        </Editable>
      )
    case 'button':
      return (
        <Editable id={node.id} as="a" kind="button" label="Button" className="vedit-inserted-button">
          {''}
        </Editable>
      )
    case 'link':
      return (
        <Editable id={node.id} as="a" kind="link" label="Link">
          {''}
        </Editable>
      )
    case 'file':
      return (
        <Editable id={node.id} as="a" kind="file" label="File">
          {''}
        </Editable>
      )
    case 'shape':
      return <ShapeView node={node} />
    default:
      return <Editable id={node.id} as="div" kind="box" label="Box" container />
  }
}

/**
 * One of the host's own components, placed by the editor.
 *
 * The component is ordinary React and knows nothing about any of this. What it
 * gets is its declared props with the editor's overrides applied; what it gives
 * back is whatever it renders. By default it is wrapped in an element the editor
 * owns, so there is something to select, outline and style without the component
 * having to cooperate — `wrap: false` in the registry turns that off for a
 * component that spreads the props it is handed onto its own root.
 */
function PlacedComponent({ node }: { node: InsertedNode }) {
  const { registry } = useVeditContext()
  const definition = findComponent(registry, node.component)
  if (!definition) return <MissingComponent node={node} known={Object.keys(registry)} />
  if (definition.wrap === false) {
    // The component takes responsibility for the props it is handed, including
    // the ones that make it selectable.
    return (
      <Editable
        id={node.id}
        kind="component"
        label={definition.name ?? node.component}
        fields={definition.fields}
        container={definition.container}
        as={definition.component}
        {...definition.defaults}
      />
    )
  }
  return <WrappedComponent node={node} definition={definition} />
}

function WrappedComponent({
  node,
  definition,
}: {
  node: InsertedNode
  definition: AnyComponentDefinition
}) {
  const defaults = definition.defaults as Record<string, unknown> | undefined
  const { ref, veditProps, override, props } = useEditable({
    id: node.id,
    kind: 'component',
    label: definition.name ?? node.component,
    container: definition.container,
    fields: definition.fields,
    props: defaults,
    definition,
  })

  // The wrapper carries only the editor's own attributes. Whatever the component
  // wants — including props that aren't valid DOM attributes — goes to the
  // component, not onto an element React would complain about.
  return (
    <div
      ref={ref as unknown as Ref<HTMLDivElement>}
      {...veditProps}
      className={['vedit-placed', override.className].filter(Boolean).join(' ')}
    >
      {createElement(
        definition.component as ElementType,
        props,
        definition.container ? <InsertedChildren key="vedit-inserted" parentId={node.id} /> : undefined,
      )}
    </div>
  )
}

/**
 * A component the document names and the registry doesn't have — renamed,
 * removed, or simply not registered on this page. The page still renders, and the
 * placeholder says exactly what is missing, because deleting someone's content
 * because their code moved is the wrong answer.
 */
function MissingComponent({ node, known }: { node: InsertedNode; known: string[] }) {
  return (
    <Editable id={node.id} as="div" kind="box" label={`${node.component ?? 'Component'} (missing)`}>
      <span data-vedit-missing="" style={MISSING_STYLE}>
        <strong>{node.component}</strong> isn't registered on this page.
        {known.length ? ` Registered here: ${known.join(', ')}.` : ' No components are registered here.'}
      </span>
    </Editable>
  )
}

const MISSING_STYLE = {
  display: 'block',
  padding: '12px 14px',
  border: '1px dashed #f24822',
  borderRadius: 6,
  background: 'rgba(242, 72, 34, .06)',
  color: '#8a2a12',
  font: '12px/1.5 ui-sans-serif, system-ui, sans-serif',
} as const
