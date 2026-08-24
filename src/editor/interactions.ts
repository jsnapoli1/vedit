import { useEffect } from 'react'
import type { VeditStore } from '../core/store'
import type { EditorTool, StyleMap } from '../core/types'
import { parseTransform, withTransform } from '../runtime/transform'
import type { EditorTarget, Rect } from './target'

const TEXTUAL = new Set(['text', 'link', 'button'])

/**
 * `instanceof Element` is useless here: on the canvas the event target comes from
 * the frame's realm, where `Element` is a different constructor. Duck-type instead.
 */
function asElement(target: EventTarget | null): Element | null {
  const candidate = target as Element | null
  return candidate && typeof candidate.closest === 'function' ? candidate : null
}

function nodeIdFrom(target: EventTarget | null): string | null {
  const element = asElement(target)
  if (!element || element.closest('[data-vedit-ui]')) return null
  return element.closest<HTMLElement>('[data-vedit-id]')?.getAttribute('data-vedit-id') ?? null
}

function isEditorSurface(target: EventTarget | null): boolean {
  return !!asElement(target)?.closest('[data-vedit-ui]')
}

// `[tabindex="-1"]` is deliberately not a control here: the toolbar carries one as
// a place for focus to land when the editor opens, and it must not swallow the
// single-letter shortcuts while it holds focus.
const CONTROLS = 'button,a[href],input,select,textarea,summary,[role="button"],[tabindex]:not([tabindex="-1"])'

/** Focus is on something in the editor's chrome that handles its own keys. */
function isChromeControl(target: EventTarget | null): boolean {
  const element = asElement(target)
  return !!element && !!element.closest('[data-vedit-ui]') && !!element.closest(CONTROLS)
}

/**
 * Nearest ancestor (or self) that can host a new element. Scanner-found nodes are
 * skipped: nothing renders their children, so dropping something inside one would
 * silently do nothing.
 */
function containerFor(store: VeditStore, id: string): string | null {
  let current: string | null = id
  while (current) {
    const node = store.getNode(current)
    if (!node) return null
    if (node.container && !node.auto) return node.id
    current = node.parentId
  }
  return null
}

export function startInlineEdit(store: VeditStore, target: EditorTarget, id: string) {
  const element = store.getNode(id)?.element
  if (!element) return
  const view = target.getWindow()
  const doc = target.getDocument()
  const originalHtml = element.innerHTML

  element.setAttribute('contenteditable', 'true')
  element.setAttribute('data-vedit-inline', 'true')
  element.focus()

  const selection = view.getSelection()
  const range = doc.createRange()
  range.selectNodeContents(element)
  selection?.removeAllRanges()
  selection?.addRange(range)
  store.setInlineEditing(id)

  let cancelled = false

  const finish = () => {
    element.removeEventListener('blur', finish)
    element.removeEventListener('keydown', onKeyDown)
    element.removeAttribute('contenteditable')
    element.removeAttribute('data-vedit-inline')
    store.setInlineEditing(null)

    if (cancelled) {
      element.innerHTML = originalHtml
      return
    }
    const html = element.innerHTML.trim()
    const text = (element.innerText ?? element.textContent ?? '').replace(/\n+$/, '')
    if (/<[a-z][\s\S]*>/i.test(html)) store.update(id, { html, text: undefined })
    else store.update(id, { text, html: undefined })
  }

  const onKeyDown = (event: KeyboardEvent) => {
    event.stopPropagation()
    if (event.key === 'Escape') {
      cancelled = true
      element.blur()
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      element.blur()
    }
    if ((event.metaKey || event.ctrlKey) && ['b', 'i', 'u'].includes(event.key.toLowerCase())) {
      event.preventDefault()
      const command = { b: 'bold', i: 'italic', u: 'underline' }[event.key.toLowerCase() as 'b' | 'i' | 'u']
      doc.execCommand(command)
    }
  }

  element.addEventListener('blur', finish)
  element.addEventListener('keydown', onKeyDown)
}

/* ------------------------------------------------------------------ dragging */

export type DragMode = 'absolute' | 'reorder' | 'nudge'

/**
 * How a drag should move this element:
 *
 * - `absolute` — it is already out of flow, so move it by `left`/`top`.
 * - `reorder`  — it sits in a flex or grid parent whose children all have ids, so
 *                it can be re-ordered for real with the `order` property.
 * - `nudge`    — anything else. A `transform` offset shifts it visually without
 *                disturbing the layout around it.
 */
export function dragModeFor(store: VeditStore, id: string, element: HTMLElement): DragMode {
  const view = element.ownerDocument.defaultView
  const position = view?.getComputedStyle(element).position
  if (position === 'absolute' || position === 'fixed') return 'absolute'
  return reorderableSiblings(element) ? 'reorder' : 'nudge'
}

/** Why an element can't be re-ordered, for the inspector to explain. */
export function reorderBlocker(element: HTMLElement): 'none' | 'not-flex' | 'missing-ids' | 'only-child' {
  const parent = element.parentElement
  const view = element.ownerDocument.defaultView
  if (!parent || !view) return 'not-flex'
  if (!/flex|grid/.test(view.getComputedStyle(parent).display)) return 'not-flex'
  const children = [...parent.children] as HTMLElement[]
  if (children.some((child) => !child.getAttribute('data-vedit-id'))) return 'missing-ids'
  return children.length > 1 ? 'none' : 'only-child'
}

/** Siblings in document order, or null when this parent can't be re-ordered. */
export function reorderableSiblings(element: HTMLElement): HTMLElement[] | null {
  const parent = element.parentElement
  const view = element.ownerDocument.defaultView
  if (!parent || !view) return null
  const display = view.getComputedStyle(parent).display
  if (!/flex|grid/.test(display)) return null
  const children = [...parent.children] as HTMLElement[]
  // Every sibling needs an id: `order` only makes sense if we can set it on all of them.
  if (children.some((child) => !child.getAttribute('data-vedit-id'))) return null
  return children.length > 1 ? children : null
}

function dominantAxis(rects: Rect[]): 'x' | 'y' {
  const spread = (values: number[]) => Math.max(...values) - Math.min(...values)
  const x = spread(rects.map((r) => r.left + r.width / 2))
  const y = spread(rects.map((r) => r.top + r.height / 2))
  return x >= y ? 'x' : 'y'
}

/** Where the dragged element would land if it were dropped at this point. */
function dropIndexAt(siblings: HTMLElement[], dragged: HTMLElement, x: number, y: number) {
  const rects = siblings.map((el) => el.getBoundingClientRect())
  const axis = dominantAxis(rects)
  const others = siblings.map((el, index) => ({ el, rect: rects[index] })).filter((entry) => entry.el !== dragged)

  let index = others.length
  for (let i = 0; i < others.length; i += 1) {
    const rect = others[i].rect
    const center = axis === 'x' ? rect.left + rect.width / 2 : rect.top + rect.height / 2
    if ((axis === 'x' ? x : y) < center) {
      index = i
      break
    }
  }

  const marker = others[Math.min(index, others.length - 1)]?.rect
  const before = index < others.length
  const indicator: Rect | null = marker
    ? axis === 'x'
      ? { top: marker.top, left: before ? marker.left - 2 : marker.left + marker.width - 2, width: 4, height: marker.height }
      : { top: before ? marker.top - 2 : marker.top + marker.height - 2, left: marker.left, width: marker.width, height: 4 }
    : null

  return { index, indicator }
}

function applyOrder(store: VeditStore, siblings: HTMLElement[], dragged: HTMLElement, index: number) {
  const ordered = siblings.filter((el) => el !== dragged)
  ordered.splice(index, 0, dragged)
  const entries: Array<[string, StyleMap]> = []
  ordered.forEach((element, position) => {
    const id = element.getAttribute('data-vedit-id')
    if (id) entries.push([id, { order: position + 1 }])
  })
  store.setStyleMany(entries, { history: false })
}

/**
 * All page-level editing gestures: selection, dragging, inline text and keyboard
 * shortcuts. Everything runs in the capture phase so the host site's own click
 * handlers and links stay inert while the editor is open.
 */
export function useEditorInteractions(
  store: VeditStore,
  target: EditorTarget,
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled !== false
  useEffect(() => {
    if (!enabled) return
    const doc = target.getDocument()
    const view = target.getWindow()

    const onPointerDown = (event: PointerEvent) => {
      if (isEditorSurface(event.target)) return
      const state = store.getState()
      const id = nodeIdFrom(event.target)

      if (state.inlineEditing && id === state.inlineEditing) return
      if (state.tool === 'hand') return

      event.preventDefault()
      event.stopPropagation()

      if (state.tool === 'comment') {
        // Pin to the element when there is one, as a fraction of its box, so the
        // note follows it when the element moves or resizes.
        const element = id ? store.getNode(id)?.element : null
        const rect = element?.getBoundingClientRect()
        store.setPendingComment(
          rect && rect.width && rect.height
            ? {
                nodeId: id ?? undefined,
                x: (event.clientX - rect.left) / rect.width,
                y: (event.clientY - rect.top) / rect.height,
              }
            : { x: event.clientX + view.scrollX, y: event.clientY + view.scrollY },
        )
        store.setTool('select')
        return
      }

      if (!id) {
        store.select(null)
        return
      }

      if (state.tool !== 'select') {
        const parent = containerFor(store, id)
        if (parent) {
          store.insert(parent, state.tool as Exclude<EditorTool, 'select' | 'hand' | 'comment'>)
          store.setTool('select')
        } else {
          store.notify('Nothing here can hold a new element — drop it inside an <Editable container>')
        }
        return
      }

      const alreadySelected = state.selection.includes(id)
      store.select(id, { additive: event.shiftKey })
      if (event.shiftKey) return

      const element = store.getNode(id)?.element
      if (!element) return

      const startX = event.clientX
      const startY = event.clientY
      const mode = dragModeFor(store, id, element)
      const siblings = mode === 'reorder' ? reorderableSiblings(element) : null
      const baseTransform = store.styleValue(id, 'transform')
      const base = parseTransform(baseTransform)
      const startLeft = element.offsetLeft
      const startTop = element.offsetTop
      let dragging = false
      let dropIndex: number | null = null

      const move = (moveEvent: PointerEvent) => {
        const dx = moveEvent.clientX - startX
        const dy = moveEvent.clientY - startY
        if (!dragging && Math.hypot(dx, dy) < 4) return
        if (!dragging) {
          dragging = true
          store.beginHistory()
        }

        if (mode === 'reorder' && siblings) {
          const { index, indicator } = dropIndexAt(siblings, element, moveEvent.clientX, moveEvent.clientY)
          dropIndex = index
          store.setDropIndicator(indicator)
          return
        }
        if (mode === 'absolute') {
          store.setStyle(
            id,
            { left: `${Math.round(startLeft + dx)}px`, top: `${Math.round(startTop + dy)}px` },
            { history: false },
          )
          return
        }
        // Keep any rotation or scale the element already has.
        const transform = withTransform(baseTransform, {
          translateX: Math.round(base.translateX + dx),
          translateY: Math.round(base.translateY + dy),
        })
        store.setStyle(id, { transform: transform ?? 'none' }, { history: false })
      }

      const up = () => {
        view.removeEventListener('pointermove', move)
        view.removeEventListener('pointerup', up)
        store.setDropIndicator(null)
        if (dragging && mode === 'reorder' && siblings && dropIndex !== null) {
          applyOrder(store, siblings, element, dropIndex)
        }
        if (!dragging && alreadySelected && TEXTUAL.has(store.kindOf(id))) {
          startInlineEdit(store, target, id)
        }
      }
      view.addEventListener('pointermove', move)
      view.addEventListener('pointerup', up)
    }

    // Stop the host site reacting to clicks it should not see while editing.
    const swallow = (event: Event) => {
      if (isEditorSurface(event.target)) return
      if (store.getState().inlineEditing && nodeIdFrom(event.target) === store.getState().inlineEditing) return
      event.preventDefault()
      event.stopPropagation()
    }

    const onDoubleClick = (event: MouseEvent) => {
      if (isEditorSurface(event.target)) return
      const id = nodeIdFrom(event.target)
      if (!id) return
      event.preventDefault()
      event.stopPropagation()
      if (TEXTUAL.has(store.kindOf(id))) startInlineEdit(store, target, id)
    }

    const onMouseOver = (event: MouseEvent) => {
      // Moving into a panel drops the page highlight, so no outline is left behind
      // while you work in the inspector. Layer rows re-assert it themselves.
      store.hover(isEditorSurface(event.target) ? null : nodeIdFrom(event.target))
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const state = store.getState()
      const element = event.target as HTMLElement | null
      const typing =
        !!element &&
        (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName))

      if (event.key === 'Escape' && !state.inlineEditing) {
        // Step out one level at a time, the way a canvas tool should.
        if (state.pendingComment) store.setPendingComment(null)
        else if (state.openComment) store.setOpenComment(null)
        else if (state.tool !== 'select') store.setTool('select')
        else if (state.selection.length === 1) {
          store.select(store.getNode(state.selection[0])?.parentId ?? null)
        } else store.select(null)
        return
      }
      if (typing) return

      // Focus is on a control in the editor's own chrome. Enter, Space, the arrow
      // keys and the single-letter tool shortcuts all belong to that control while
      // it has focus — stealing them is what makes an editor mouse-only. The
      // shortcuts below with a modifier still work everywhere.
      if (!event.metaKey && !event.ctrlKey && isChromeControl(event.target)) return

      const meta = event.metaKey || event.ctrlKey
      if (meta && event.key.toLowerCase() === 'e') {
        event.preventDefault()
        store.setEditing(false)
        return
      }
      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) store.redo()
        else store.undo()
        return
      }
      if (meta && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void store.save().catch(() => undefined)
        return
      }
      if (meta) return

      const id = state.selection.length === 1 ? state.selection[0] : null

      const tools: Record<string, EditorTool> = {
        v: 'select',
        h: 'hand',
        c: 'comment',
        t: 'text',
        i: 'image',
        r: 'box',
      }
      const tool = tools[event.key.toLowerCase()]
      if (tool) {
        store.setTool(tool)
        return
      }

      if (!id) return

      if (event.key === 'Enter') {
        event.preventDefault()
        if (TEXTUAL.has(store.kindOf(id))) startInlineEdit(store, target, id)
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        const inserted = state.doc.inserted.some((node) => node.id === id)
        if (inserted) store.removeInserted(id)
        else store.update(id, { hidden: !state.doc.nodes[id]?.hidden })
        return
      }
      if (event.key.startsWith('Arrow')) {
        event.preventDefault()
        const step = event.shiftKey ? 10 : 1
        const dx = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0
        const dy = event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0
        const node = store.getNode(id)
        if (node && dragModeFor(store, id, node.element) === 'absolute') {
          const style = store.getOverride(id).style ?? {}
          const left = Number.parseFloat(String(style.left ?? node.element.offsetLeft))
          const top = Number.parseFloat(String(style.top ?? node.element.offsetTop))
          store.setStyle(id, { left: `${left + dx}px`, top: `${top + dy}px` })
          return
        }
        const current = store.styleValue(id, 'transform')
        const parts = parseTransform(current)
        const transform = withTransform(current, {
          translateX: parts.translateX + dx,
          translateY: parts.translateY + dy,
        })
        if (transform) store.setStyle(id, { transform })
        else store.clearStyles(id, ['transform'])
      }
    }

    doc.addEventListener('pointerdown', onPointerDown, true)
    doc.addEventListener('click', swallow, true)
    doc.addEventListener('submit', swallow, true)
    doc.addEventListener('dblclick', onDoubleClick, true)
    doc.addEventListener('mouseover', onMouseOver, true)
    doc.addEventListener('keydown', onKeyDown, true)

    // Shortcuts have to work while focus sits in the panels, which are in the
    // editor's own document rather than the page's.
    const chromeDoc = typeof document !== 'undefined' ? document : null
    if (chromeDoc && chromeDoc !== doc) chromeDoc.addEventListener('keydown', onKeyDown, true)

    return () => {
      doc.removeEventListener('pointerdown', onPointerDown, true)
      doc.removeEventListener('click', swallow, true)
      doc.removeEventListener('submit', swallow, true)
      doc.removeEventListener('dblclick', onDoubleClick, true)
      doc.removeEventListener('mouseover', onMouseOver, true)
      doc.removeEventListener('keydown', onKeyDown, true)
      if (chromeDoc && chromeDoc !== doc) chromeDoc.removeEventListener('keydown', onKeyDown, true)
    }
  }, [store, target, enabled])
}
