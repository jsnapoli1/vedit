import { createElement, forwardRef, useMemo, type ElementType, type ReactNode, type Ref } from 'react'
import { useEditable } from './useEditable'
import { useVeditState } from '../core/context'
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
export const Editable = forwardRef<HTMLElement, EditableProps>(function Editable(
  { id, as, kind, label, container = false, fields, children, className, ...rest },
  forwardedRef,
) {
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

  let content: ReactNode = children
  if (override.html !== undefined) {
    props.dangerouslySetInnerHTML = { __html: sanitizeHtml(override.html) }
    content = undefined
  } else if (override.text !== undefined) {
    content = override.text
  }

  if (isVoidElement(Component) || props.dangerouslySetInnerHTML) return createElement(Component, props)

  return createElement(
    Component,
    props,
    content,
    isContainer ? <InsertedChildren key="vedit-inserted" parentId={id} /> : null,
  )
})

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
