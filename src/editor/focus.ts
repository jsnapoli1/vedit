import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE =
  'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export function focusableIn(container: HTMLElement | null): HTMLElement[] {
  if (!container) return []
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.offsetParent !== null || element === container.ownerDocument.activeElement,
  )
}

/**
 * Keep Tab inside a popover while it is open, and give focus back to whatever had
 * it when the popover closes.
 *
 * A comment thread appears over the page: without this, tabbing out of it walks
 * into the page behind, and closing it leaves focus nowhere. Both are the kind of
 * thing you only notice without a mouse, which is exactly when it matters.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement>,
  options: { onEscape?: () => void; active?: boolean } = {},
) {
  const { active = true } = options
  // The callback is held in a ref so the effect's dependencies stay stable: this
  // runs inside a layer that re-renders every animation frame, and re-running it
  // would steal focus back to the first field on every frame.
  const onEscape = useRef(options.onEscape)
  onEscape.current = options.onEscape

  useEffect(() => {
    const container = ref.current
    if (!container || !active) return
    const doc = container.ownerDocument
    const previous = doc.activeElement as HTMLElement | null

    const first = focusableIn(container)[0]
    first?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onEscape.current?.()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = focusableIn(container)
      if (!focusable.length) return
      const edge = event.shiftKey ? focusable[0] : focusable[focusable.length - 1]
      if (doc.activeElement === edge) {
        event.preventDefault()
        ;(event.shiftKey ? focusable[focusable.length - 1] : focusable[0]).focus()
      }
    }

    container.addEventListener('keydown', onKeyDown)
    return () => {
      container.removeEventListener('keydown', onKeyDown)
      // Only take focus back if it is still inside what we're unmounting; the user
      // may have clicked somewhere else entirely.
      if (previous?.isConnected && container.contains(doc.activeElement)) previous.focus()
    }
  }, [ref, active])
}

/**
 * Arrow-key movement across a group of controls that should be one tab stop —
 * a tab strip, a tree. `items` are read fresh on each key, so the group can change
 * shape underneath it.
 */
export function moveFocus(
  event: React.KeyboardEvent,
  items: HTMLElement[],
  options: { orientation?: 'vertical' | 'horizontal' } = {},
): boolean {
  const orientation = options.orientation ?? 'vertical'
  const next = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight'
  const previous = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft'

  const at = items.indexOf(event.currentTarget as HTMLElement)
  let to = -1
  if (event.key === next) to = at + 1
  else if (event.key === previous) to = at - 1
  else if (event.key === 'Home') to = 0
  else if (event.key === 'End') to = items.length - 1
  if (to === -1 || !items.length) return false

  event.preventDefault()
  items[Math.max(0, Math.min(to, items.length - 1))]?.focus()
  return true
}
