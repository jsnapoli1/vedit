import { useEffect, useMemo } from 'react'
import { isCanvasChild } from '../core/canvas'
import { useVeditContext, useVeditState } from '../core/context'
import { recordSetKey } from '../core/store'
import { warnOnce } from '../core/env'
import type { RecordQuery, VeditRecord } from '../content/types'

export interface UseVeditRecordsOptions extends Pick<RecordQuery, 'where' | 'orderBy' | 'populate'> {
  /**
   * Rows the host already has — fetched on the server, or passed down from a
   * loader. Visitors get exactly these back; editors see them with their own
   * pending edits applied, until the draft rows arrive.
   */
  rows?: VeditRecord[]
  /** What to render while nothing is known yet. Defaults to no rows. */
  fallback?: VeditRecord[]
}

const NONE: VeditRecord[] = []

/**
 * The rows of a source, as this person should see them.
 *
 * A visitor gets what is live: the `rows` the host passed, or the published
 * rows fetched once. Someone editing gets the draft, with what they have changed
 * on this page and not yet saved laid on top — so a title typed into a card
 * shows in that card, a row added shows as a card, and a row removed is gone,
 * all before anything has been saved. Pair it with `repeat` and `source`:
 *
 * ```jsx
 * const products = useVeditRecords('products', { rows })
 * <Editable id="products" repeat={products} source="products">…</Editable>
 * ```
 *
 * Never suspends: the first render returns `rows`, the fallback, or nothing,
 * and a fetch only ever happens in the browser.
 */
export function useVeditRecords(source: string, options: UseVeditRecordsOptions = {}): VeditRecord[] {
  const { rows, fallback, where, orderBy, populate } = options
  const { store } = useVeditContext()
  const editing = useVeditState((state) => state.editing)
  const data = useVeditState((state) => state.data)

  // Editing in place sets `editing`; on the canvas the page is framed and the
  // editor lives in the parent window, so the frame has to know it is one.
  const editor = editing || isCanvasChild()
  // Objects are rebuilt on every render; what matters is whether they changed.
  const queryKey = JSON.stringify({ where, orderBy, populate })
  // This query's own rows: two hooks on one source with different queries
  // must not hand each other their results.
  const setKey = recordSetKey(source, { where, orderBy, populate })
  const fetched = useVeditState((state) => state.recordSets[setKey])

  useEffect(() => {
    if (!store.supportsContent) return
    // Rows handed in are the live ones a visitor should see; only an editor
    // needs to look past them to the draft.
    if (rows && !editor) return
    const query: RecordQuery = JSON.parse(queryKey) as RecordQuery
    // Whichever stage the store decides on from the capabilities: the draft
    // for someone who may write, what is live for everyone else.
    void store.loadRecords(source, query).catch((error: unknown) => {
      // The page still has its rows or its fallback; a visitor is not shown a
      // notice for a fetch they never asked for, but a developer should hear.
      warnOnce(`records:${source}`, `could not load the rows of "${source}"`, error)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, source, queryKey, editor, rows === undefined])

  return useMemo(() => {
    if (!store.supportsContent) return rows ?? fallback ?? NONE
    if (!editor) return rows ?? fetched ?? fallback ?? NONE
    // Draft rows are fresher than anything the host rendered with; until they
    // arrive the host's rows carry the pending edits just as well.
    return store.recordsFor(source, fetched ?? rows ?? fallback ?? NONE)
    // `data` is what `recordsFor` reads; it is a dependency so an edit re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, source, rows, fallback, fetched, editor, data])
}
