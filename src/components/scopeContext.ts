import { createContext, useContext } from 'react'

/**
 * The shared document the tree below belongs to, or `null` for the page's own.
 *
 * Provided by an `Editable` with a `scope`, read by `useEditable`. The store
 * already routes a write from a node inside a scoped ancestor to that
 * ancestor's document; this is what makes the read side agree, so a link in a
 * site-wide nav renders the override the editor just wrote. Kept apart from
 * `Editable` and `useEditable` for the same reason `RepeatItemContext` is:
 * either importing the other would be a cycle.
 */
export const ScopeContext = createContext<string | null>(null)

export function useScope(): string | null {
  return useContext(ScopeContext)
}
