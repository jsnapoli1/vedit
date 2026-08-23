import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { VeditContext, useVeditStore, type VeditConfig } from '../../core/context'
import { canvasUrl, readCanvasBridge, type CanvasBridge } from '../../core/canvas'
import type { VeditStore } from '../../core/store'
import { BREAKPOINT_ORDER, type Breakpoint, type VeditState } from '../../core/types'
import { EditorRoot } from '../EditorRoot'
import { useEditorInteractions } from '../interactions'
import { IconFit, IconMinus, IconPlus } from '../icons'
import { EDITOR_CSS } from '../styles'
import { EditorTargetProvider, type EditorTarget } from '../target'

const EDITOR_STYLE_ID = 'vedit-editor-styles'

const MIN_ZOOM = 0.05
const MAX_ZOOM = 4
/** Space kept clear for the floating panels when fitting the artboards. */
const INSETS = { top: 96, right: 296, bottom: 24, left: 292 }
/** Gap between artboards, in page pixels. */
const GAP = 64

interface View {
  zoom: number
  panX: number
  panY: number
}

export interface PageSpec {
  path: string
  label?: string
}

export interface CanvasShellProps {
  /** Called when the editor should close and hand control back to the page. */
  onClose: () => void
  /** Called when the frames can't be reached, so the host can fall back. */
  onUnavailable: () => void
  config: VeditConfig
  /** One artboard per entry. Defaults to just the page you opened the editor on. */
  pages: PageSpec[]
}

/**
 * The Figma-style canvas: each page is loaded into a same-origin frame and laid
 * out as an artboard you can zoom and pan, with the editor chrome floating above.
 * Because every frame has its own viewport, the site's own media queries respond
 * to the artboard width — so a breakpoint is genuinely previewed, not just
 * targeted. Several artboards can sit side by side, each editing its own
 * document; the panels follow whichever one you last selected in.
 */
export function CanvasShell({ onClose, onUnavailable, config, pages }: CanvasShellProps) {
  const hostStore = useVeditStore()
  const frames = useRef(new Map<string, HTMLIFrameElement>())
  const [bridges, setBridges] = useState<Record<string, CanvasBridge>>({})
  const [activePath, setActivePath] = useState(pages[0]?.path ?? '/')
  const [heights, setHeights] = useState<Record<string, number>>({})
  const [view, setView] = useState<View>({ zoom: 1, panX: 0, panY: 0 })
  const [frameWidth, setFrameWidth] = useState(() => defaultFrameWidth(config))
  const [spacePanning, setSpacePanning] = useState(false)

  const viewRef = useRef(view)
  viewRef.current = view
  const activeRef = useRef(activePath)
  activeRef.current = activePath

  const bridgeList = useMemo(
    () => pages.map((page) => bridges[page.path]).filter(Boolean),
    [pages, bridges],
  )
  const active = bridges[activePath]

  useEffect(() => {
    document.documentElement.classList.add('vedit-canvas-host')
    return () => document.documentElement.classList.remove('vedit-canvas-host')
  }, [])

  /* ------------------------------------------------------------- handshake */

  useEffect(() => {
    const globals = window as unknown as { __veditOnCanvasReady?: (bridge: CanvasBridge) => void }
    const accept = (bridge: CanvasBridge) =>
      setBridges((current) => (current[bridge.path] === bridge ? current : { ...current, [bridge.path]: bridge }))
    globals.__veditOnCanvasReady = accept

    // A frame may have finished before this ran; check them directly too.
    const poll = setInterval(() => {
      for (const frame of frames.current.values()) {
        const ready = readCanvasBridge(frame)
        if (ready) accept(ready)
      }
    }, 120)
    const timeout = setTimeout(() => {
      const anyReady = [...frames.current.values()].some((frame) => readCanvasBridge(frame))
      if (!anyReady) onUnavailable()
    }, 6000)

    return () => {
      clearInterval(poll)
      clearTimeout(timeout)
      delete globals.__veditOnCanvasReady
    }
  }, [onUnavailable])

  /* -------------------------------------------------- driving the artboards */

  useEffect(() => {
    for (const bridge of bridgeList) {
      bridge.store.setEditing(true)
      bridge.store.setBreakpoint(breakpointForWidth(frameWidth, config))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridgeList])

  // Only the artboard being worked in speaks for you in the room, so one person
  // with three pages open still shows up once. Sessions start asynchronously, so
  // re-apply as each one appears.
  useEffect(() => {
    const apply = () => {
      for (const [path, bridge] of Object.entries(bridges)) {
        bridge.store.session?.setBroadcastPresence(path === activePath)
      }
    }
    apply()
    const unsubscribes = Object.values(bridges).map((bridge) => bridge.store.subscribe(apply))
    return () => unsubscribes.forEach((off) => off())
  }, [bridges, activePath])

  // Selecting inside an artboard makes it the one the panels are pointed at.
  useEffect(() => {
    const unsubscribes = Object.entries(bridges).map(([path, bridge]) =>
      bridge.store.subscribe(() => {
        if (!bridge.store.getState().selection.length) return
        if (activeRef.current === path) return
        activeRef.current = path
        setActivePath(path)
        for (const [otherPath, other] of Object.entries(bridges)) {
          if (otherPath !== path) other.store.select(null)
        }
      }),
    )
    return () => unsubscribes.forEach((off) => off())
  }, [bridges])

  // Closing is the active artboard's decision, but no artboard's work is lost.
  useEffect(() => {
    if (!active) return
    return active.store.subscribe(() => {
      if (active.store.getState().editing) return
      const dirty = bridgeList.filter((bridge) => bridge.store.dirty)
      if (dirty.length && !window.confirm(unsavedMessage(dirty.length))) {
        active.store.setEditing(true)
        return
      }
      // Carry the saved document back so the page behind the canvas is up to date.
      const own = bridges[hostPath()]
      if (own) hostStore.hydrate(own.store.getState().saved)
      onClose()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, bridgeList, onClose])

  /* ------------------------------------------------- artboard size tracking */

  useEffect(() => {
    const observers: ResizeObserver[] = []
    const timers: Array<ReturnType<typeof setInterval>> = []

    for (const page of pages) {
      const doc = frames.current.get(page.path)?.contentDocument
      if (!bridges[page.path] || !doc) continue

      // One tall artboard rather than a scrolling viewport: the whole page is
      // visible at once, which is the point of being able to zoom out.
      const measure = () => {
        const height = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0, 400)
        setHeights((current) =>
          Math.abs((current[page.path] ?? 0) - height) > 1 ? { ...current, [page.path]: height } : current,
        )
      }
      measure()
      const observer = new ResizeObserver(measure)
      observer.observe(doc.documentElement)
      if (doc.body) observer.observe(doc.body)
      observers.push(observer)
      timers.push(setInterval(measure, 500))
    }

    return () => {
      observers.forEach((observer) => observer.disconnect())
      timers.forEach((timer) => clearInterval(timer))
    }
  }, [pages, bridges, frameWidth])

  /* -------------------------------------------------------------- viewport */

  const targets = useRef(new Map<string, EditorTarget>())
  const targetFor = useCallback((path: string): EditorTarget => {
    const existing = targets.current.get(path)
    if (existing) return existing
    const target: EditorTarget = {
      getWindow: () => frames.current.get(path)?.contentWindow ?? window,
      getDocument: () => frames.current.get(path)?.contentDocument ?? document,
      getViewport: () => {
        const frame = frames.current.get(path)
        if (!frame) return { originX: 0, originY: 0, zoom: 1 }
        const rect = frame.getBoundingClientRect()
        return { originX: rect.left, originY: rect.top, zoom: viewRef.current.zoom }
      },
    }
    targets.current.set(path, target)
    return target
  }, [])

  const totalWidth = pages.length * frameWidth + (pages.length - 1) * GAP
  const maxHeight = Math.max(600, ...pages.map((page) => heights[page.path] ?? 0))

  const fit = useCallback(() => {
    const availableWidth = window.innerWidth - INSETS.left - INSETS.right
    const availableHeight = window.innerHeight - INSETS.top - INSETS.bottom
    const zoom = clamp(Math.min(availableWidth / totalWidth, availableHeight / maxHeight), MIN_ZOOM, 1)
    setView({
      zoom,
      panX: INSETS.left + (availableWidth - totalWidth * zoom) / 2,
      panY: INSETS.top,
    })
  }, [totalWidth, maxHeight])

  // Dragging the artboard edge should not yank the zoom around.
  const resizing = useRef(false)
  const ready = bridgeList.length > 0

  // Fit when the canvas opens, and again whenever the artboards change width —
  // you switched to a breakpoint to look at it, so put it in front of you.
  useEffect(() => {
    if (!ready) return
    if (resizing.current) {
      resizing.current = false
      return
    }
    fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, frameWidth, pages.length])

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
      else
        setView((current) => ({
          ...current,
          panX: current.panX - event.deltaX,
          panY: current.panY - event.deltaY,
        }))
    }

    const onHostWheel = (event: WheelEvent) => onWheel(event, { x: 0, y: 0 })
    window.addEventListener('wheel', onHostWheel, { passive: false })

    // Wheel events over an artboard go to its frame, whose coordinates are
    // relative to that frame's own origin.
    const detach: Array<() => void> = []
    for (const [path, frame] of frames.current) {
      const frameWindow = frame.contentWindow
      if (!bridges[path] || !frameWindow) continue
      const onFrameWheel = (event: WheelEvent) => {
        const rect = frame.getBoundingClientRect()
        const zoom = viewRef.current.zoom
        onWheel(event, {
          x: rect.left + event.clientX * (zoom - 1),
          y: rect.top + event.clientY * (zoom - 1),
        })
      }
      frameWindow.addEventListener('wheel', onFrameWheel, { passive: false })
      detach.push(() => frameWindow.removeEventListener('wheel', onFrameWheel))
    }

    return () => {
      window.removeEventListener('wheel', onHostWheel)
      detach.forEach((off) => off())
    }
  }, [bridges, zoomAt])

  // Hold space to pan, like every canvas tool.
  useEffect(() => {
    const documents = new Set<Document>([document])
    for (const frame of frames.current.values()) {
      if (frame.contentDocument) documents.add(frame.contentDocument)
    }
    const down = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement | null
      const typing = !!element && (element.isContentEditable || ['INPUT', 'TEXTAREA'].includes(element.tagName))
      if (typing) return
      if (event.code === 'Space') {
        event.preventDefault()
        setSpacePanning(true)
      }
      if (event.key === '!' || (event.shiftKey && event.code === 'Digit1')) fit()
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
  }, [bridges, fit])

  const tool = useStoreValue(active?.store, (state) => state.tool, 'select' as const)
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

  // Picking a breakpoint resizes every artboard, so the site's media queries fire.
  const breakpoint = useStoreValue(active?.store, (state) => state.breakpoint, 'base' as Breakpoint)
  const breakpointRef = useRef(breakpoint)
  useEffect(() => {
    if (breakpointRef.current === breakpoint) return
    breakpointRef.current = breakpoint
    setFrameWidth(widthForBreakpoint(breakpoint, config))
    for (const bridge of bridgeList) bridge.store.setBreakpoint(breakpoint)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breakpoint, config])

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
      for (const bridge of bridgeList) bridge.store.setBreakpoint(next)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /* ------------------------------------------------------------------ render */

  const dirtyCount = bridgeList.filter((bridge) => bridge.store.dirty).length

  const zoomControls = (
    <>
      <button
        type="button"
        className="vedit-btn vedit-btn-icon"
        title="Zoom out"
        onClick={() => zoomAt(1 / 1.2, window.innerWidth / 2, window.innerHeight / 2)}
      >
        <IconMinus />
      </button>
      <button
        type="button"
        className="vedit-btn"
        style={{ minWidth: 46 }}
        title="Reset to 100%"
        onClick={() => setView((current) => ({ ...current, zoom: 1 }))}
      >
        {Math.round(view.zoom * 100)}%
      </button>
      <button
        type="button"
        className="vedit-btn vedit-btn-icon"
        title="Zoom in"
        onClick={() => zoomAt(1.2, window.innerWidth / 2, window.innerHeight / 2)}
      >
        <IconPlus />
      </button>
      <button type="button" className="vedit-btn vedit-btn-icon" title="Fit to screen — ⇧1" onClick={fit}>
        <IconFit />
      </button>
      {pages.length > 1 && dirtyCount > 1 ? (
        <button
          type="button"
          className="vedit-btn"
          title="Save every artboard with unsaved changes"
          onClick={() => {
            for (const bridge of bridgeList) {
              if (bridge.store.dirty) void bridge.store.save().catch(() => undefined)
            }
          }}
        >
          Save all ({dirtyCount})
        </button>
      ) : null}
    </>
  )

  return createPortal(
    <div
      className="vedit-canvas"
      data-vedit-ui=""
      data-panning={panning ? 'true' : 'false'}
      onPointerDown={startPan}
    >
      <div
        className="vedit-artboards"
        style={{ transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})` }}
      >
        {pages.map((page, index) => (
          <div
            key={page.path}
            className="vedit-artboard"
            data-active={page.path === activePath ? 'true' : 'false'}
            style={{ left: index * (frameWidth + GAP) }}
          >
            <div
              className="vedit-artboard-label"
              style={{ fontSize: 11 / view.zoom, transform: `translateY(${-8 / view.zoom}px)` }}
              onPointerDown={(event) => {
                event.stopPropagation()
                setActivePath(page.path)
              }}
            >
              {page.label ?? page.path} — {frameWidth} × {heights[page.path] ?? '…'}
            </div>
            <iframe
              ref={(element) => {
                if (element) frames.current.set(page.path, element)
                else frames.current.delete(page.path)
              }}
              title={page.label ?? page.path}
              src={canvasUrl(page.path)}
              style={{
                width: frameWidth,
                height: heights[page.path] ?? 900,
                pointerEvents: panning ? 'none' : 'auto',
              }}
            />
            {index === pages.length - 1 ? (
              <div
                className="vedit-frame-handle"
                style={{ width: 10 / view.zoom }}
                title="Drag to change the artboard width"
                onPointerDown={startFrameResize}
              />
            ) : null}
          </div>
        ))}
      </div>

      {/* Every artboard listens for its own edits, so a click anywhere is live. */}
      {Object.entries(bridges).map(([path, bridge]) => (
        <ArtboardWiring key={path} store={bridge.store} target={targetFor(path)} />
      ))}

      {active ? (
        <VeditContext.Provider value={{ store: active.store, config }}>
          <EditorTargetProvider value={targetFor(activePath)}>
            <EditorRoot toolbarExtras={zoomControls} interactive={false} />
          </EditorTargetProvider>
        </VeditContext.Provider>
      ) : (
        <div className="vedit-canvas-loading">Loading the page into the canvas…</div>
      )}
    </div>,
    document.body,
  )
}

/**
 * Installs editing gestures — and the editing styles — for one artboard, whether
 * or not it is the one the panels are pointed at, so a click anywhere is live.
 */
function ArtboardWiring({ store, target }: { store: VeditStore; target: EditorTarget }) {
  useEditorInteractions(store, target)
  const doc = target.getDocument()

  useEffect(() => {
    if (!doc.getElementById(EDITOR_STYLE_ID)) {
      const style = doc.createElement('style')
      style.id = EDITOR_STYLE_ID
      style.textContent = EDITOR_CSS
      doc.head.appendChild(style)
    }
    const root = doc.documentElement
    root.classList.add('vedit-editing')
    return () => root.classList.remove('vedit-editing')
  }, [doc])

  return null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function isChrome(target: EventTarget | null): boolean {
  const element = target as Element | null
  return !!element && typeof element.closest === 'function' && !!element.closest('.vedit-panel, .vedit-toast')
}

function hostPath(): string {
  return typeof window === 'undefined' ? '/' : window.location.pathname
}

function unsavedMessage(count: number): string {
  return count === 1
    ? 'You have unsaved changes. Close the editor and lose them?'
    : `${count} artboards have unsaved changes. Close the editor and lose them?`
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
