import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { VeditContext, useVeditStore, type VeditConfig } from '../../core/context'
import { canvasUrl, readCanvasBridge, type CanvasBridge } from '../../core/canvas'
import type { VeditStore } from '../../core/store'
import { BREAKPOINT_ORDER, type Breakpoint, type VeditState } from '../../core/types'
import { EditorRoot } from '../EditorRoot'
import { IconFit, IconMinus, IconPlus } from '../icons'
import { EditorTargetProvider, type EditorTarget } from '../target'

const MIN_ZOOM = 0.05
const MAX_ZOOM = 4
/** Space kept clear for the floating panels when fitting the artboard. */
const INSETS = { top: 84, right: 296, bottom: 24, left: 256 }

interface View {
  zoom: number
  panX: number
  panY: number
}

export interface CanvasShellProps {
  /** Called when the editor should close and hand control back to the page. */
  onClose: () => void
  /** Called when the frame can't be reached, so the host can fall back. */
  onUnavailable: () => void
  config: VeditConfig
}

/**
 * The Figma-style canvas: the page is loaded into a same-origin frame that is
 * scaled and panned as a single artboard, with the editor chrome floating above
 * it in this document. Because the frame has its own viewport, the site's own
 * media queries respond to the artboard width — so a breakpoint is genuinely
 * previewed, not just targeted.
 */
export function CanvasShell({ onClose, onUnavailable, config }: CanvasShellProps) {
  const hostStore = useVeditStore()
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [bridge, setBridge] = useState<CanvasBridge | null>(null)
  const [view, setView] = useState<View>({ zoom: 1, panX: 0, panY: 0 })
  const [frameWidth, setFrameWidth] = useState(() => defaultFrameWidth(config))
  const [frameHeight, setFrameHeight] = useState(900)
  const [spacePanning, setSpacePanning] = useState(false)
  const viewRef = useRef(view)
  viewRef.current = view

  const src = useMemo(() => canvasUrl(window.location.href), [])

  useEffect(() => {
    document.documentElement.classList.add('vedit-canvas-host')
    return () => document.documentElement.classList.remove('vedit-canvas-host')
  }, [])

  /* ------------------------------------------------------------- handshake */

  useEffect(() => {
    const globals = window as unknown as { __veditOnCanvasReady?: (bridge: CanvasBridge) => void }
    globals.__veditOnCanvasReady = (ready) => setBridge(ready)

    // The frame may have finished before this ran; check directly too.
    const poll = setInterval(() => {
      if (frameRef.current) {
        const ready = readCanvasBridge(frameRef.current)
        if (ready) setBridge(ready)
      }
    }, 120)
    const timeout = setTimeout(() => {
      if (!frameRef.current || !readCanvasBridge(frameRef.current)) onUnavailable()
    }, 6000)

    return () => {
      clearInterval(poll)
      clearTimeout(timeout)
      delete globals.__veditOnCanvasReady
    }
  }, [onUnavailable])

  // The framed page owns the document being edited; drive it from here.
  useEffect(() => {
    if (!bridge) return
    bridge.store.setEditing(true)
    // Start with the breakpoint the artboard's width actually puts the site in,
    // so the toolbar and the frame never disagree.
    bridge.store.setBreakpoint(breakpointForWidth(frameWidth, config))
    return bridge.store.subscribe(() => {
      if (bridge.store.getState().editing) return
      if (bridge.store.dirty && !window.confirm('You have unsaved changes. Close the editor and lose them?')) {
        bridge.store.setEditing(true)
        return
      }
      // Carry the saved document back so the page behind the canvas is up to date.
      hostStore.hydrate(bridge.store.getState().saved)
      onClose()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, hostStore, onClose])

  /* ------------------------------------------------- artboard size tracking */

  useEffect(() => {
    const frame = frameRef.current
    const doc = frame?.contentDocument
    if (!bridge || !doc) return

    // One tall artboard rather than a scrolling viewport: the whole page is
    // visible at once, which is the point of being able to zoom out.
    const measure = () => {
      const height = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0, 400)
      setFrameHeight((current) => (Math.abs(current - height) > 1 ? height : current))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(doc.documentElement)
    if (doc.body) observer.observe(doc.body)
    const interval = setInterval(measure, 500)
    return () => {
      observer.disconnect()
      clearInterval(interval)
    }
  }, [bridge, frameWidth])

  /* -------------------------------------------------------------- viewport */

  const target = useMemo<EditorTarget>(
    () => ({
      getWindow: () => frameRef.current?.contentWindow ?? window,
      getDocument: () => frameRef.current?.contentDocument ?? document,
      getViewport: () => {
        const frame = frameRef.current
        if (!frame) return { originX: 0, originY: 0, zoom: 1 }
        const rect = frame.getBoundingClientRect()
        return { originX: rect.left, originY: rect.top, zoom: viewRef.current.zoom }
      },
    }),
    [],
  )

  const fit = useCallback(() => {
    const availableWidth = window.innerWidth - INSETS.left - INSETS.right
    const availableHeight = window.innerHeight - INSETS.top - INSETS.bottom
    const zoom = clamp(Math.min(availableWidth / frameWidth, availableHeight / frameHeight), MIN_ZOOM, 1)
    setView({
      zoom,
      panX: INSETS.left + (availableWidth - frameWidth * zoom) / 2,
      panY: INSETS.top,
    })
  }, [frameWidth, frameHeight])

  // Fit when the canvas opens, and again whenever the artboard changes width —
  // you switched to a breakpoint to look at it, so put it in front of you.
  useEffect(() => {
    if (!bridge) return
    if (resizing.current) {
      resizing.current = false
      return
    }
    fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, frameWidth])

  const zoomAt = useCallback((factor: number, clientX: number, clientY: number) => {
    setView((current) => {
      const zoom = clamp(current.zoom * factor, MIN_ZOOM, MAX_ZOOM)
      const scale = zoom / current.zoom
      return {
        zoom,
        panX: clientX - (clientX - current.panX) * scale,
        panY: clientY - (clientY - current.panY) * scale,
      }
    })
  }, [])

  /* ------------------------------------------------------ pointer + wheel */

  useEffect(() => {
    const onWheel = (event: WheelEvent, offset: { x: number; y: number }) => {
      if (isChrome(event.target)) return
      event.preventDefault()
      const clientX = event.clientX + offset.x
      const clientY = event.clientY + offset.y
      // Trackpad pinch arrives as a wheel event with ctrlKey set.
      if (event.ctrlKey || event.metaKey) zoomAt(Math.exp(-event.deltaY / 220), clientX, clientY)
      else setView((current) => ({ ...current, panX: current.panX - event.deltaX, panY: current.panY - event.deltaY }))
    }

    const onHostWheel = (event: WheelEvent) => onWheel(event, { x: 0, y: 0 })
    window.addEventListener('wheel', onHostWheel, { passive: false })

    // Wheel events over the artboard go to the frame, and its coordinates are
    // relative to the frame's own origin.
    let detachFrame: (() => void) | undefined
    const frameWindow = frameRef.current?.contentWindow
    if (bridge && frameWindow) {
      const onFrameWheel = (event: WheelEvent) => {
        const rect = frameRef.current?.getBoundingClientRect()
        const zoom = viewRef.current.zoom
        onWheel(event, { x: (rect?.left ?? 0) + event.clientX * (zoom - 1), y: (rect?.top ?? 0) + event.clientY * (zoom - 1) })
      }
      frameWindow.addEventListener('wheel', onFrameWheel, { passive: false })
      detachFrame = () => frameWindow.removeEventListener('wheel', onFrameWheel)
    }

    return () => {
      window.removeEventListener('wheel', onHostWheel)
      detachFrame?.()
    }
  }, [bridge, zoomAt])

  // Hold space to pan, like every canvas tool.
  useEffect(() => {
    const documents = new Set([document, frameRef.current?.contentDocument].filter(Boolean) as Document[])
    const down = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement | null
      const typing = !!element && (element.isContentEditable || ['INPUT', 'TEXTAREA'].includes(element.tagName))
      if (event.code === 'Space' && !typing) {
        event.preventDefault()
        setSpacePanning(true)
      }
      if (event.key === '!' || (event.shiftKey && event.code === 'Digit1')) {
        if (!typing) fit()
      }
    }
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpacePanning(false)
    }
    for (const doc of documents) {
      doc.addEventListener('keydown', down)
      doc.addEventListener('keyup', up)
    }
    return () => {
      for (const doc of documents) {
        doc.removeEventListener('keydown', down)
        doc.removeEventListener('keyup', up)
      }
    }
  }, [bridge, fit])

  const tool = useStoreValue(bridge?.store, (state) => state.tool, 'select' as const)
  const panning = spacePanning || tool === 'hand'

  const startPan = (event: React.PointerEvent) => {
    if (!panning && event.button !== 1) return
    event.preventDefault()
    const startX = event.clientX
    const startY = event.clientY
    const origin = viewRef.current
    const move = (moveEvent: PointerEvent) => {
      setView({
        zoom: origin.zoom,
        panX: origin.panX + (moveEvent.clientX - startX),
        panY: origin.panY + (moveEvent.clientY - startY),
      })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /* ---------------------------------------------- breakpoint <-> frame width */

  // Picking a breakpoint resizes the artboard, so the site's media queries fire.
  const breakpoint = useStoreValue(bridge?.store, (state) => state.breakpoint, 'base' as Breakpoint)
  const breakpointRef = useRef(breakpoint)
  useEffect(() => {
    if (breakpointRef.current === breakpoint) return
    breakpointRef.current = breakpoint
    setFrameWidth(widthForBreakpoint(breakpoint, config))
  }, [breakpoint, config])

  // Dragging the artboard edge should not yank the zoom around.
  const resizing = useRef(false)

  const startFrameResize = (event: React.PointerEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startWidth = frameWidth
    const move = (moveEvent: PointerEvent) => {
      const width = Math.max(240, Math.round(startWidth + (moveEvent.clientX - startX) / viewRef.current.zoom))
      resizing.current = true
      setFrameWidth(width)
      const next = breakpointForWidth(width, config)
      breakpointRef.current = next
      bridge?.store.setBreakpoint(next)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /* ------------------------------------------------------------------ render */

  const zoomControls = (
    <>
      <button type="button" className="vedit-btn vedit-btn-icon" title="Zoom out" onClick={() => zoomAt(1 / 1.2, window.innerWidth / 2, window.innerHeight / 2)}>
        <IconMinus />
      </button>
      <button type="button" className="vedit-btn" style={{ minWidth: 46 }} title="Reset to 100%" onClick={() => setView((c) => ({ ...c, zoom: 1, panX: centreX(frameWidth, 1) }))}>
        {Math.round(view.zoom * 100)}%
      </button>
      <button type="button" className="vedit-btn vedit-btn-icon" title="Zoom in" onClick={() => zoomAt(1.2, window.innerWidth / 2, window.innerHeight / 2)}>
        <IconPlus />
      </button>
      <button type="button" className="vedit-btn vedit-btn-icon" title="Fit to screen — ⇧1" onClick={fit}>
        <IconFit />
      </button>
    </>
  )

  return createPortal(
    <div
      className="vedit-canvas"
      data-vedit-ui=""
      data-panning={panning ? 'true' : 'false'}
      onPointerDown={startPan}
    >
      <div className="vedit-artboard" style={{ transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})` }}>
        <div className="vedit-artboard-label" style={{ fontSize: 11 / view.zoom, transform: `translateY(${-8 / view.zoom}px)` }}>
          {frameWidth} × {frameHeight}
        </div>
        <iframe
          ref={frameRef}
          title="Page being edited"
          src={src}
          style={{ width: frameWidth, height: frameHeight, pointerEvents: panning ? 'none' : 'auto' }}
        />
        <div
          className="vedit-frame-handle"
          style={{ width: 10 / view.zoom }}
          title="Drag to change the artboard width"
          onPointerDown={startFrameResize}
        />
      </div>

      {bridge ? (
        <VeditContext.Provider value={{ store: bridge.store, config }}>
          <EditorTargetProvider value={target}>
            <EditorRoot toolbarExtras={zoomControls} />
          </EditorTargetProvider>
        </VeditContext.Provider>
      ) : (
        <div className="vedit-canvas-loading">Loading the page into the canvas…</div>
      )}
    </div>,
    document.body,
  )
}

/** Subscribe to a slice of a store that isn't this tree's provider store. */
function useStoreValue<T>(store: VeditStore | undefined, selector: (state: VeditState) => T, fallback: T): T {
  const [value, setValue] = useState<T>(fallback)
  useEffect(() => {
    if (!store) return
    setValue(selector(store.getState()))
    return store.subscribe(() => setValue(selector(store.getState())))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store])
  return value
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function centreX(frameWidth: number, zoom: number): number {
  const available = window.innerWidth - INSETS.left - INSETS.right
  return INSETS.left + (available - frameWidth * zoom) / 2
}

function isChrome(target: EventTarget | null): boolean {
  const element = target as Element | null
  return !!element && typeof element.closest === 'function' && !!element.closest('.vedit-panel, .vedit-toast')
}

function widthForBreakpoint(breakpoint: Breakpoint, config: VeditConfig): number {
  if (breakpoint === 'base') return 390
  return config.breakpoints[breakpoint]
}

function breakpointForWidth(width: number, config: VeditConfig): Breakpoint {
  let match: Breakpoint = 'base'
  for (const breakpoint of BREAKPOINT_ORDER) {
    if (breakpoint === 'base') continue
    if (width >= config.breakpoints[breakpoint]) match = breakpoint
  }
  return match
}

function defaultFrameWidth(config: VeditConfig): number {
  const available = window.innerWidth - INSETS.left - INSETS.right
  return available >= config.breakpoints.lg ? config.breakpoints.xl : config.breakpoints.lg
}
