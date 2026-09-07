import { createElement, forwardRef, useMemo, type ElementType, type ReactNode, type Ref } from 'react'
import { useEditable } from './useEditable'
import { useVeditContext, useVeditState } from '../core/context'
import { findComponent, type AnyComponentDefinition } from '../core/registry'
import { interpolate } from '../runtime/interpolate'
import { itemKey } from '../runtime/repeat'
import { RepeatItemContext } from './repeatContext'
import { safeUrl, sanitizeHtml } from '../runtime/sanitize'
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

function Repeat({ repeat, repeatKey, children }: RenderProps) {
  return (
    <>
      {((repeat ?? []) as readonly unknown[]).map((item: unknown, index: number) => {
        const key = itemKey(item, index, repeatKey)
        return (
          <RepeatItemContext.Provider key={key} value={{ item, key, index }}>
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
  ...rest
}: RenderProps & { forwardedRef?: Ref<HTMLElement> }) {
  const resolvedKind: NodeKind = kind ?? inferKind(as, children)
  const isContainer = container || resolvedKind === 'box'
  const sourceText = typeof children === 'string' ? children : undefined
  const schema = fields as EditableField[] | undefined
  const declared = schema
    ? Object.fromEntries(schema.map((field) => [field.name, rest[field.name]]))
    : undefined
  const { ref, veditProps, override, props: edited } = useEditable({
    id,
    kind: resolvedKind,
    label,
    container: isContainer,
    sourceText,
    vars,
    fields: schema,
    props: declared,
  })

  const Component = (as ?? defaultTagFor(resolvedKind)) as ElementType
  const props: Record<string, unknown> = { ...rest, ...(schema ? edited : {}), ...veditProps }

  props.ref = mergeRefs(ref, forwardedRef)
  props.className = [className, override.className].filter(Boolean).join(' ') || undefined
  // URLs come out of the stored document, so they get the same treatment as its
  // HTML: anything that would execute rather than navigate is dropped.
  if (override.src !== undefined) props.src = safeUrl(override.src, { allowDataImage: true }) ?? ''
  if (override.alt !== undefined) props.alt = override.alt
  if (override.href !== undefined) props.href = safeUrl(override.href) ?? '#'
  if (override.target !== undefined) props.target = override.target
  if (props.target === '_blank' && props.rel === undefined) props.rel = 'noopener noreferrer'

  // Templates are resolved on the way out, never on the way in: what is stored
  // stays `Pay {amount} deposit`, and only what renders carries the number. The
  // source text goes through it too, so a component can be written as a template
  // and read correctly before anyone has edited it.
  let content: ReactNode = vars && sourceText !== undefined ? interpolate(sourceText, vars) : children
  if (override.html !== undefined) {
    props.dangerouslySetInnerHTML = { __html: sanitizeHtml(interpolate(override.html, vars)) }
    content = undefined
  } else if (override.text !== undefined) {
    content = interpolate(override.text, vars)
  }

  if (isVoidElement(Component) || props.dangerouslySetInnerHTML) return createElement(Component, props)

  return createElement(
    Component,
    props,
    content,
    isContainer ? <InsertedChildren key="vedit-inserted" parentId={id} /> : null,
  )
}

function inferKind(as: ElementType | undefined, children: ReactNode): NodeKind {
  if (as === 'img') return 'image'
  if (as === 'a') return 'link'
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
      return 'a'
    case 'button':
      return 'button'
    default:
      return 'div'
  }
}

function isVoidElement(component: ElementType): boolean {
  return typeof component === 'string' && (component === 'img' || component === 'br' || component === 'hr' || component === 'input')
}

/** Renders the elements someone added through the editor inside a container. */
export function InsertedChildren({ parentId }: { parentId: string }) {
  const inserted = useVeditState((state) => state.doc.inserted)
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
