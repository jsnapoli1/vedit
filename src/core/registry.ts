import type { ComponentType } from 'react'
import type { EditableField } from './types'

/**
 * A component the editor may place on a page.
 *
 * This is the whole idea of authoring mode: your components stay ordinary React
 * — no base class, no wrapper, nothing imported from here — and a small schema
 * next to them tells the editor what it may change. The editor composes; the
 * component renders. Neither one has to know much about the other.
 */
export interface ComponentDefinition<P = Record<string, unknown>> {
  /** The component itself. */
  component: ComponentType<P>
  /** Shown in the insert panel and the layers tree. Defaults to the registry key. */
  name?: string
  /** One line about when to use it. Read by people, and by an agent composing a page. */
  description?: string
  /** Group heading in the insert panel, e.g. `Marketing`. */
  group?: string
  /** Props the editor may change, and the control to offer for each. */
  fields?: EditableField[]
  /** Prop values a newly placed instance starts with. */
  defaults?: Partial<P>
  /**
   * Whether this component can hold other components. The editor renders their
   * slot as the component's `children`, so a layout component gets them for free.
   */
  container?: boolean
  /**
   * By default the editor renders your component inside a `<div>` it owns, so it
   * has something to select, outline and style — your component needs to know
   * nothing.
   *
   * Set `wrap: false` when the component spreads the props it is given onto its
   * own root element (`<section {...rest}>`). No extra element then, which
   * matters when the component is a flex or grid child whose own class carries
   * the sizing.
   */
  wrap?: boolean
}

/**
 * One registry holds components whose props have nothing to do with each other,
 * which is what this `any` is for. Per-component checking is available through
 * `defineComponent`, where the props type is known.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyComponentDefinition = ComponentDefinition<any>

export type ComponentRegistry = Record<string, AnyComponentDefinition>

/**
 * What the editor needs to know about a component in order to offer it, minus the
 * component itself. Serialisable on purpose: the panels run in the parent window
 * while the page runs inside an artboard, and the same list is what an agent reads
 * over MCP.
 */
export interface ComponentSummary {
  id: string
  name: string
  description?: string
  group?: string
  fields?: EditableField[]
  container?: boolean
}

/**
 * Declare the components the editor may place.
 *
 * ```tsx
 * export const components = defineComponents({
 *   Hero: {
 *     component: Hero,
 *     group: 'Sections',
 *     fields: [{ name: 'align', type: 'select', options: ['left', 'center'] }],
 *     defaults: { align: 'left' },
 *   },
 * })
 * ```
 *
 * A pass-through — it exists so the keys keep their literal types and the object
 * gets checked against the definition shape. To have one component's `defaults`
 * checked against its own props, wrap that entry in `defineComponent`.
 */
export function defineComponents<T extends ComponentRegistry>(registry: T): T {
  return registry
}

/** One entry, with its props type known, so `defaults` is checked against it. */
export function defineComponent<P>(definition: ComponentDefinition<P>): ComponentDefinition<P> {
  return definition
}

/** The serialisable half of a registry — what the editor and an agent work from. */
export function componentManifest(registry: ComponentRegistry | undefined): ComponentSummary[] {
  if (!registry) return []
  return Object.entries(registry)
    .map(([id, definition]) => ({
      id,
      name: definition.name ?? id,
      description: definition.description,
      group: definition.group,
      fields: definition.fields,
      container: definition.container,
    }))
    .sort((a, b) => (a.group ?? '').localeCompare(b.group ?? '') || a.name.localeCompare(b.name))
}

/**
 * Look a component up by the name stored in a document.
 *
 * Content outlives code: a component can be renamed or deleted while pages still
 * reference it. That is a miss, not an error — the editor draws a placeholder
 * saying which name is missing, so the page still renders and the fix is obvious.
 */
export function findComponent(
  registry: ComponentRegistry | undefined,
  name: string | undefined,
): AnyComponentDefinition | undefined {
  if (!registry || !name) return undefined
  return registry[name]
}
