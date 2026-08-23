import { useEffect, useState } from 'react'
import { useVeditState, useVeditStore } from '../core/context'
import type { VeditStore } from '../core/store'

interface Measured {
  id: string
  label: string
  rect: DOMRect
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

/** Measures on every frame so the outlines track scrolling, animation and reflow. */
function useMeasured(ids: string[], store: VeditStore): Measured[] {
  const [measured, setMeasured] = useState<Measured[]>([])

  useEffect(() => {
    let frame = 0
    // Not '' — an empty id list has to be able to clear a previous measurement.
    let previous = '\u0000'
    const tick = () => {
      const next: Measured[] = []
      for (const id of ids) {
        const node = store.getNode(id)
        if (!node?.element.isConnected) continue
        next.push({ id, label: node.label, rect: node.element.getBoundingClientRect() })
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
  }, [ids.join('|'), store])

  return measured
}

function round(rect: DOMRect): string {
  return [rect.top, rect.left, rect.width, rect.height].map((n) => Math.round(n)).join(',')
}

export function Overlay() {
  const store = useVeditStore()
  const hovered = useVeditState((state) => state.hovered)
  const selection = useVeditState((state) => state.selection)
  const inlineEditing = useVeditState((state) => state.inlineEditing)

  const hoverIds = hovered && !selection.includes(hovered) ? [hovered] : []
  const hoverRects = useMeasured(hoverIds, store)
  const selectedRects = useMeasured(selection, store)

  return (
    <div className="vedit-overlay">
      {hoverRects.map((measured) => (
        <div key={measured.id}>
          <div className="vedit-rect vedit-rect-hover" style={boxStyle(measured.rect)} />
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
          <div className="vedit-rect vedit-rect-selected" style={boxStyle(measured.rect)} />
          {selection.length === 1 && inlineEditing !== measured.id ? (
            <>
              <div
                className="vedit-size"
                style={{ top: measured.rect.bottom, left: measured.rect.left + measured.rect.width / 2 }}
              >
                {Math.round(measured.rect.width)} × {Math.round(measured.rect.height)}
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
                  onPointerDown={(event) => startResize(event, store, measured.id, handle.key)}
                />
              ))}
            </>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function boxStyle(rect: DOMRect) {
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
}

function startResize(
  event: React.PointerEvent,
  store: VeditStore,
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
    const styles: Record<string, string> = {}
    if (horizontal) {
      const width = Math.max(8, rect.width + (moveEvent.clientX - startX) * horizontal)
      styles.width = `${Math.round(width)}px`
    }
    if (vertical) {
      const height = Math.max(8, rect.height + (moveEvent.clientY - startY) * vertical)
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
