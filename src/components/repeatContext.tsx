import { createContext, useContext } from 'react'

/** The item of a repeat the tree below is rendering, and its key. */
export interface RepeatItem {
  /** The host's own array element. */
  item: unknown
  /** Its stable key — what item ids are built from. */
  key: string
  /** Position in the array, for `nth`-style copy and for keyless data. */
  index: number
}

/**
 * Which item of a repeat the tree below is rendering.
 *
 * Its own module because both `Editable` (which provides it) and `useEditable`
 * (which reads it) need it, and having either import the other would make a
 * cycle.
 *
 * A child `Editable` doesn't take an item id — it keeps the plain id its author
 * wrote, and this is how it learns to resolve that against one item. Nesting a
 * repeat inside a repeat replaces the value rather than stacking it: one level
 * is what this promises, and a second would need an id scheme that composes.
 */
export const RepeatItemContext = createContext<RepeatItem | null>(null)

/**
 * The repeat item being rendered, or `null` outside a repeat.
 *
 * The item is the host's own object, handed straight back. That is what lets a
 * repeated card show its own name and price: pass them through `vars`, exactly
 * as you would outside a repeat, and the document still stores only the
 * template.
 *
 * ```jsx
 * function PlanName() {
 *   const plan = useRepeatItem()?.item
 *   return <EditableText id="plan.name" vars={{ name: plan.name }}>{'{name}'}</EditableText>
 * }
 * ```
 */
export function useRepeatItem(): RepeatItem | null {
  return useContext(RepeatItemContext)
}
