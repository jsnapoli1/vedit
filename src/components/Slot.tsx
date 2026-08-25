import { useMemo, type ElementType, type ReactNode } from 'react'
import { InsertedChildren } from './Editable'
import { useEditable } from './useEditable'
import { useVeditContext, useVeditState } from '../core/context'

export interface VeditSlotProps {
  /**
   * Stable identifier for this slot. Everything placed inside is stored against
   * it, so treat it like a route: `home.sections`, not `slot-2`.
   */
  id: string
  /** Element to render as. Defaults to `div`. */
  as?: ElementType
  /** Name shown in the layers tree and the insert panel. */
  label?: string
  className?: string
  /**
   * Rendered when the slot has nothing in it. Visitors see this; so does an
   * editor, above the invitation to add something.
   */
  children?: ReactNode
  /** Anything else is forwarded to the element. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [prop: string]: any
}

/**
 * A region of a page whose contents live in the document rather than in your JSX.
 *
 * This is the difference between editing a page and authoring one. Everywhere
 * else, vedit changes what your code already renders; inside a slot, the editor
 * decides which of your registered components appear, in what order, with what
 * props. Your components are still yours — the slot only composes them.
 *
 * ```tsx
 * <VeditProvider components={components}>
 *   <main>
 *     <Nav />
 *     <VeditSlot id="home.sections" />
 *     <Footer />
 *   </main>
 * </VeditProvider>
 * ```
 *
 * A whole page is a slot with nothing around it. A section of an existing page is
 * a slot in the middle of hand-written JSX. Both are the same mechanism, which is
 * what lets a site adopt this one region at a time instead of all at once.
 */
export function VeditSlot({ id, as, label, className, children, ...rest }: VeditSlotProps) {
  const { config, store } = useVeditContext()
  const editing = useVeditState((state) => state.editing)
  const count = useVeditState((state) => state.doc.inserted.filter((node) => node.parentId === id).length)

  const { ref, veditProps, override } = useEditable({
    id,
    kind: 'box',
    label: label ?? 'Slot',
    container: true,
  })

  const Component = (as ?? 'div') as ElementType
  const classes = useMemo(
    () => ['vedit-slot', className, override.className].filter(Boolean).join(' '),
    [className, override.className],
  )

  return (
    <Component ref={ref} {...rest} {...veditProps} data-vedit-slot="" className={classes}>
      {count === 0 ? children : null}
      <InsertedChildren parentId={id} />
      {editing && count === 0 ? (
        <EmptySlot registered={config.components.length} onSelect={() => store.select(id)} />
      ) : null}
    </Component>
  )
}

/**
 * What an editor sees in a slot with nothing in it. Deliberately part of the page
 * rather than the chrome: it has to sit where the content will go, at the size the
 * slot actually is, or it is telling you about somewhere else.
 */
function EmptySlot({ registered, onSelect }: { registered: number; onSelect: () => void }) {
  // `data-vedit-ui` keeps the scanner and the page gestures off it — it is the
  // editor's own furniture, not content — so selecting the slot it stands in has
  // to be wired up by hand.
  return (
    <button type="button" data-vedit-ui="" style={EMPTY_STYLE} onClick={onSelect}>
      {registered
        ? 'Empty slot — select it and use the Insert panel to place a component here.'
        : 'Empty slot — no components are registered. Pass `components` to VeditProvider.'}
    </button>
  )
}

const EMPTY_STYLE = {
  width: '100%',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 120,
  padding: 24,
  border: '1px dashed rgba(13, 153, 255, .55)',
  borderRadius: 8,
  background: 'rgba(13, 153, 255, .05)',
  color: '#0d6ebd',
  font: '13px/1.5 ui-sans-serif, system-ui, sans-serif',
  textAlign: 'center',
} as const
