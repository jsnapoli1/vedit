import { useEffect, useState } from 'react'
import { useVeditState, useVeditStore } from '../core/context'
import type { VeditStore } from '../core/store'
import { toScreen, useEditorTarget, type EditorTarget, type Rect } from './target'
import { warnOnce } from '../core/env'

interface Measured {
  id: string
  label: string
  /** Already mapped into screen coordinates. */
  rect: Rect
}

const HANDLES = [
  { key: 'nw', x: 0, y: 0, cursor: 'nwse-resize' },
  { key: 'n', x: 0.5, y: 0, cursor: 'ns-resize' },
  { key: 'ne', x: 1, y: 0, cursor: 'nesw-resize' },
  { key: 'e', x: 1, y: 0.5, cursor: 'ew-resize' },
  { key: 'se', x: 1, y: 1, cursor: 'nwse-resize' },
  { key: 's', x: 0.5, y: 1, cursor: 'ns-resize' },
  { key: 'sw', x: 0, y: 1, cursor: 'nesw-resize' },
  { key: 'w', x: 0, y: 0.5, cursor: 'ew-resize' },
] as const

/**
 * Measures on every frame so outlines track scrolling, animation, reflow — and,
 * on the canvas, zooming and panning.
 */
function useMeasured(ids: string[], store: VeditStore, target: EditorTarget): Measured[] {
  const [measured, setMeasured] = useState<Measured[]>([])

  useEffect(() => {
    let frame = 0
    // Not '' — an empty id list has to be able to clear a previous measurement.
    let previous = ' '
    const tick = () => {
      const viewport = target.getViewport()
      const next: Measured[] = []
      for (const id of ids) {
        const node = store.getNode(id)
        if (!node?.element.isConnected) continue
        const box = node.element.getBoundingClientRect()
        // A node with no box draws no outline, which reads as the editor
        // ignoring the selection. It doesn't — there is simply nothing to draw
        // around. Say which node and why, once.
        if (!box.width || !box.height) {
          warnOnce(
            `zero-size:${id}`,
            `"${id}" is selected but has no box (0 × 0), so it can't be outlined, dragged or resized. ` +
              'An element with `display: contents` generates no box of its own — put the id on the child ' +
              'that actually renders, or give this one a display that boxes.',
            node.element,
          )
        }
        next.push({ id, label: node.label, rect: toScreen(box, viewport) })
      }
      const signature = next.map((m) => `${m.id}:${round(m.rect)}`).join('|')
      if (signature !== previous) {
        previous = signature
        setMeasured(next)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [ids.join('|'), store, target])

  return measured
}

function round(rect: Rect): string {
  return [rect.top, rect.left, rect.width, rect.height].map((n) => Math.round(n)).join(',')
}

export function Overlay() {
  const store = useVeditStore()
  const target = useEditorTarget()
  const hovered = useVeditState((state) => state.hovered)
  const selection = useVeditState((state) => state.selection)
  const inlineEditing = useVeditState((state) => state.inlineEditing)

  const hoverIds = hovered && !selection.includes(hovered) ? [hovered] : []
  const hoverRects = useMeasured(hoverIds, store, target)
  const selectedRects = useMeasured(selection, store, target)
  const zoom = target.getViewport().zoom || 1

  return (
    <div className="vedit-overlay">
      {hoverRects.map((measured) => (
        <div key={measured.id}>
          <div className="vedit-rect vedit-rect-hover" style={measured.rect} />
          <div
            className="vedit-tag"
            style={{ top: Math.max(measured.rect.top, 18), left: measured.rect.left }}
          >
            {measured.label}
          </div>
        </div>
      ))}

      {selectedRects.map((measured) => (
        <div key={measured.id}>
          <div className="vedit-rect vedit-rect-selected" style={measured.rect} />
          {selection.length === 1 && inlineEditing !== measured.id ? (
            <>
              <div
                className="vedit-size"
                style={{
                  top: measured.rect.top + measured.rect.height,
                  left: measured.rect.left + measured.rect.width / 2,
                }}
              >
                {formatSize(measured.rect, zoom)}
              </div>
              {HANDLES.map((handle) => (
                <div
                  key={handle.key}
                  className="vedit-handle"
                  style={{
                    top: measured.rect.top + measured.rect.height * handle.y,
                    left: measured.rect.left + measured.rect.width * handle.x,
                    cursor: handle.cursor,
                  }}
                  onPointerDown={(event) => startResize(event, store, target, measured.id, handle.key)}
                />
              ))}
            </>
          ) : null}
        </div>
      ))}
    </div>
  )
}

/** The badge reports page pixels, not zoomed screen pixels. */
function formatSize(rect: Rect, zoom: number): string {
  return `${Math.round(rect.width / zoom)} × ${Math.round(rect.height / zoom)}`
}

function startResize(
  event: React.PointerEvent,
  store: VeditStore,
  target: EditorTarget,
  id: string,
  handle: (typeof HANDLES)[number]['key'],
) {
  const element = store.getNode(id)?.element
  if (!element) return
  event.preventDefault()
  event.stopPropagation()

  const rect = element.getBoundingClientRect()
  const startX = event.clientX
  const startY = event.clientY
  const horizontal = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0
  const vertical = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0
  store.beginHistory()

  const move = (moveEvent: PointerEvent) => {
    // Screen pixels are zoomed pixels; the element is sized in page pixels.
    const zoom = target.getViewport().zoom || 1
    const styles: Record<string, string> = {}
    if (horizontal) {
      const width = Math.max(8, rect.width + ((moveEvent.clientX - startX) / zoom) * horizontal)
      styles.width = `${Math.round(width)}px`
    }
    if (vertical) {
      const height = Math.max(8, rect.height + ((moveEvent.clientY - startY) / zoom) * vertical)
      styles.height = `${Math.round(height)}px`
    }
    if (Object.keys(styles).length) store.setStyle(id, styles, { history: false })
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
