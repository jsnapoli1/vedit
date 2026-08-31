import type { VeditStore } from '../core/store'
import type { NodeKind } from '../core/types'
import { containerFor } from './interactions'
import type { EditorTarget, Rect } from './target'

/**
 * Dragging something out of the Insert panel and onto the page.
 *
 * Placement already works by clicking — the panel puts a component in the
 * selected container and the inspector moves it up and down — and that stays.
 * This is the gesture people try first, and its job is to answer two questions
 * continuously while the pointer moves: which container is under it, and where
 * among that container's children the new element would land.
 *
 * Both answers already exist for re-ordering an element that is on the page, so
 * this reuses them rather than inventing a second set of rules: the same drop
 * index, drawn with the same indicator.
 */

export interface DropPoint {
  /** The container the element would be placed in. */
  parentId: string
  /** Where among that container's children it would land. */
  index: number
  /** Where to draw the insertion line, in page coordinates. */
  indicator: Rect | null
}

/**
 * Where a pointer at these *screen* coordinates would drop.
 *
 * The panel is in the parent window and the page is inside an artboard, so the
 * point has to cross that boundary: unproject it through the artboard's own
 * viewport before asking the framed document what is underneath.
 */
export function dropPointAt(
  store: VeditStore,
  target: EditorTarget,
  clientX: number,
  clientY: number,
): DropPoint | null {
  const viewport = target.getViewport()
  const doc = target.getDocument()
  const zoom = viewport.zoom || 1
  const x = (clientX - viewport.originX) / zoom
  const y = (clientY - viewport.originY) / zoom

  const element = doc.elementFromPoint(x, y) as HTMLElement | null
  if (!element) return null

  // The editor's own chrome is not a drop target, and neither is anything inside it.
  if (element.closest('[data-vedit-ui]')) return null

  const owner = element.closest<HTMLElement>('[data-vedit-id]')
  const parentId = owner ? containerFor(store, owner.getAttribute('data-vedit-id') ?? '') : null
  if (!parentId) return null

  const container = store.getNode(parentId)?.element
  if (!container) return { parentId, index: 0, indicator: null }

  // `instanceof HTMLElement` is useless here: these elements come from the
  // frame's realm, where HTMLElement is a different constructor, so the check
  // silently excludes every child and the drop collapses to "the whole slot".
  // Duck-type instead, exactly as the selection code does.
  const children = [...container.children].filter(
    (child): child is HTMLElement => !!(child as HTMLElement).getAttribute?.('data-vedit-id'),
  )
  if (!children.length) return { parentId, index: 0, indicator: insideOf(container) }

  const placement = placeAmong(children, x, y)
  return { parentId, index: placement.index, indicator: placement.indicator }
}

/**
 * Which gap between existing children the point falls in.
 *
 * Laid out the way the children are: a row is split vertically, a column
 * horizontally. Measuring rather than reading `flex-direction` covers grids and
 * wrapped rows, where the computed direction says little about what you see.
 */
function placeAmong(children: HTMLElement[], x: number, y: number): { index: number; indicator: Rect } {
  const rects = children.map((child) => child.getBoundingClientRect())
  const horizontal = isRow(rects)

  for (let i = 0; i < rects.length; i += 1) {
    const rect = rects[i]
    const middle = horizontal ? rect.left + rect.width / 2 : rect.top + rect.height / 2
    if ((horizontal ? x : y) < middle) return { index: i, indicator: lineBefore(rect, horizontal) }
  }

  const last = rects[rects.length - 1]
  return { index: rects.length, indicator: lineAfter(last, horizontal) }
}

/** Children laid out side by side rather than stacked. */
function isRow(rects: DOMRect[]): boolean {
  if (rects.length < 2) return false
  const spread = (values: number[]) => Math.max(...values) - Math.min(...values)
  return (
    spread(rects.map((rect) => rect.left + rect.width / 2)) >=
    spread(rects.map((rect) => rect.top + rect.height / 2))
  )
}

const THICKNESS = 4

function lineBefore(rect: DOMRect, horizontal: boolean): Rect {
  return horizontal
    ? { top: rect.top, left: rect.left - THICKNESS / 2, width: THICKNESS, height: rect.height }
    : { top: rect.top - THICKNESS / 2, left: rect.left, width: rect.width, height: THICKNESS }
}

function lineAfter(rect: DOMRect, horizontal: boolean): Rect {
  return horizontal
    ? { top: rect.top, left: rect.left + rect.width - THICKNESS / 2, width: THICKNESS, height: rect.height }
    : { top: rect.top + rect.height - THICKNESS / 2, left: rect.left, width: rect.width, height: THICKNESS }
}

/** An empty container: show the whole box, because there is no gap to point at. */
function insideOf(container: HTMLElement): Rect {
  const rect = container.getBoundingClientRect()
  return { top: rect.top, left: rect.left, width: rect.width, height: Math.max(rect.height, THICKNESS) }
}

export interface DragPayload {
  kind: NodeKind
  component?: string
}

/**
 * Run a drag from the panel to the page.
 *
 * Pointer events rather than HTML5 drag-and-drop: the page is in a same-origin
 * frame, and a pointer capture on the panel keeps every move coming to one
 * handler regardless of which document the pointer is over. `dragover` would
 * hand the drag to the frame the moment it crossed the boundary.
 */
export function startPlacementDrag(
  event: React.PointerEvent,
  store: VeditStore,
  target: EditorTarget,
  payload: DragPayload,
): void {
  event.preventDefault()
  const handle = event.currentTarget as HTMLElement
  handle.setPointerCapture(event.pointerId)

  const startX = event.clientX
  const startY = event.clientY
  let dragging = false
  let landing: DropPoint | null = null

  // A pointer-down that turns into a drag must not also fire the button's click,
  // or dropping somewhere invalid would warn *and* place into the selected
  // container. One gesture, one placement.
  const swallowClick = (clickEvent: Event) => {
    clickEvent.preventDefault()
    clickEvent.stopPropagation()
  }

  const move = (moveEvent: PointerEvent) => {
    // A drag starts only once the pointer has actually travelled, so a click
    // still reads as a click and places into the selected container.
    if (!dragging && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 4) return
    dragging = true
    landing = dropPointAt(store, target, moveEvent.clientX, moveEvent.clientY)
    store.setDropIndicator(landing?.indicator ?? null)
  }

  const finish = () => {
    handle.releasePointerCapture(event.pointerId)
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', finish)
    handle.removeEventListener('pointercancel', cancel)
    store.setDropIndicator(null)

    if (!dragging) return
    // Click fires after pointerup; take it out once, whatever happens below.
    handle.addEventListener('click', swallowClick, { capture: true, once: true })
    if (!landing) {
      store.notify('Dropped outside a container — nothing accepts an element there')
      return
    }
    store.insert(landing.parentId, payload.kind, { component: payload.component, index: landing.index })
  }

  const cancel = () => {
    dragging = false
    landing = null
    finish()
  }

  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', finish)
  handle.addEventListener('pointercancel', cancel)
}
