import { useEffect } from 'react'
import type { VeditStore } from '../core/store'
import type { EditorTool } from '../core/types'

const TEXTUAL = new Set(['text', 'link', 'button'])

function nodeIdFrom(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null
  if (target.closest('[data-vedit-ui]')) return null
  const element = target.closest<HTMLElement>('[data-vedit-id]')
  return element?.getAttribute('data-vedit-id') ?? null
}

function isEditorSurface(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('[data-vedit-ui]')
}

function parseTranslate(transform: string | number | undefined): [number, number] {
  if (typeof transform !== 'string') return [0, 0]
  const match = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/.exec(transform)
  return match ? [Number(match[1]), Number(match[2])] : [0, 0]
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

export function startInlineEdit(store: VeditStore, id: string) {
  const element = store.getNode(id)?.element
  if (!element) return
  const originalHtml = element.innerHTML

  element.setAttribute('contenteditable', 'true')
  element.setAttribute('data-vedit-inline', 'true')
  element.focus()

  const selection = window.getSelection()
  const range = document.createRange()
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
      document.execCommand(command)
    }
  }

  element.addEventListener('blur', finish)
  element.addEventListener('keydown', onKeyDown)
}

/**
 * All page-level editing gestures live here: selection, moving, inline text and
 * keyboard shortcuts. Everything runs in the capture phase so the host site's own
 * click handlers and links stay inert while the editor is open.
 */
export function useEditorInteractions(store: VeditStore) {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (isEditorSurface(event.target)) return
      const state = store.getState()
      const id = nodeIdFrom(event.target)

      if (state.inlineEditing && id === state.inlineEditing) return

      event.preventDefault()
      event.stopPropagation()

      if (!id) {
        store.select(null)
        return
      }

      if (state.tool !== 'select') {
        const parent = containerFor(store, id)
        if (parent) {
          store.insert(parent, state.tool as Exclude<EditorTool, 'select'>)
          store.setTool('select')
        } else {
          store.notify('Nothing here can hold a new element — drop it inside an <Editable container>')
        }
        return
      }

      const alreadySelected = state.selection.includes(id)
      store.select(id, { additive: event.shiftKey })
      if (event.shiftKey) return

      // Drag the element to nudge it out of flow, Figma style.
      const startX = event.clientX
      const startY = event.clientY
      const override = store.getOverride(id)
      const [baseX, baseY] = parseTranslate(override.style?.transform)
      let moving = false

      const move = (moveEvent: PointerEvent) => {
        const dx = moveEvent.clientX - startX
        const dy = moveEvent.clientY - startY
        if (!moving && Math.hypot(dx, dy) < 4) return
        if (!moving) {
          moving = true
          store.beginHistory()
        }
        store.setStyle(
          id,
          { transform: `translate(${Math.round(baseX + dx)}px, ${Math.round(baseY + dy)}px)` },
          { history: false },
        )
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        if (!moving && alreadySelected) {
          const kind = store.kindOf(id)
          if (TEXTUAL.has(kind)) startInlineEdit(store, id)
        }
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
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
      if (TEXTUAL.has(store.kindOf(id))) startInlineEdit(store, id)
    }

    const onMouseOver = (event: MouseEvent) => {
      // Moving into a panel drops the page highlight, so no outline is left behind
      // while you work in the inspector. Layer rows re-assert it themselves.
      store.hover(isEditorSurface(event.target) ? null : nodeIdFrom(event.target))
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const state = store.getState()
      const target = event.target as HTMLElement | null
      const typing =
        !!target &&
        (target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

      if (event.key === 'Escape' && !state.inlineEditing) {
        store.select(null)
        return
      }
      if (typing) return

      const meta = event.metaKey || event.ctrlKey
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

      if (!typing && ['v', 't', 'i', 'r'].includes(event.key.toLowerCase())) {
        const tool = { v: 'select', t: 'text', i: 'image', r: 'box' }[
          event.key.toLowerCase() as 'v' | 't' | 'i' | 'r'
        ] as EditorTool
        store.setTool(tool)
        return
      }

      if (!id) return

      if (event.key === 'Enter') {
        event.preventDefault()
        if (TEXTUAL.has(store.kindOf(id))) startInlineEdit(store, id)
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
        const [x, y] = parseTranslate(store.getOverride(id).style?.transform)
        const dx = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0
        const dy = event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0
        store.setStyle(id, { transform: `translate(${x + dx}px, ${y + dy}px)` })
      }
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('click', swallow, true)
    document.addEventListener('submit', swallow, true)
    document.addEventListener('dblclick', onDoubleClick, true)
    document.addEventListener('mouseover', onMouseOver, true)
    document.addEventListener('keydown', onKeyDown, true)

    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('click', swallow, true)
      document.removeEventListener('submit', swallow, true)
      document.removeEventListener('dblclick', onDoubleClick, true)
      document.removeEventListener('mouseover', onMouseOver, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [store])
}
