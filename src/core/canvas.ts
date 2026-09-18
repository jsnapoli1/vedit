import type { ComponentSummary } from './registry'
import type { VeditStore } from './store'
import { CANVAS_VH_PARAM } from './viewportUnits'

export const CANVAS_PARAM = 'vedit-canvas'

/** What the framed page hands to the editor running in the parent window. */
export interface CanvasBridge {
  store: VeditStore
  breakpoints: Record<string, number>
  /** Which artboard this is, so the editor can tell several frames apart. */
  path: string
  /** Components this page's provider registered, so the chrome can offer them. */
  components?: ComponentSummary[]
}

interface CanvasGlobals {
  __veditCanvas?: CanvasBridge
  __veditOnCanvasReady?: (bridge: CanvasBridge) => void
}

/** True when this page is the artboard inside the editor's canvas. */
export function isCanvasChild(): boolean {
  if (typeof window === 'undefined' || window.parent === window) return false
  try {
    return new URLSearchParams(window.location.search).get(CANVAS_PARAM) === '1'
  } catch {
    return false
  }
}

/**
 * Hand this page's store to the editor. Parent and frame are the same origin, so
 * they can share the live object rather than serialising messages back and forth.
 */
export function publishCanvasBridge(bridge: CanvasBridge): void {
  const self = window as unknown as CanvasGlobals
  self.__veditCanvas = bridge
  try {
    const parent = window.parent as unknown as CanvasGlobals
    parent.__veditOnCanvasReady?.(bridge)
  } catch {
    // Cross-origin parent: the editor falls back to overlay mode on its own.
  }
}

/**
 * A page inside the canvas that navigates itself — a card's `navigate()`, a
 * router push — would drop the query that marks it as the canvas child and
 * carries the reference viewport height, and the artboard would then behave
 * like a visitor tab: no pinned `vh`, no bridge on the next page. Keep the
 * params on every history write for as long as the frame is a canvas child.
 */
export function keepCanvasParams(win: Window): () => void {
  const params = new URLSearchParams(win.location.search)
  const keep = [CANVAS_PARAM, CANVAS_VH_PARAM].filter((name) => params.has(name))
  if (!keep.length) return () => undefined
  const history = win.history
  const original = { pushState: history.pushState, replaceState: history.replaceState }
  const withParams = (url: string | URL | null | undefined) => {
    if (url == null) return url
    const next = new URL(String(url), win.location.href)
    for (const name of keep) if (!next.searchParams.has(name)) next.searchParams.set(name, params.get(name) as string)
    return next.pathname + next.search + next.hash
  }
  history.pushState = function (data, unused, url) {
    return original.pushState.call(this, data, unused, withParams(url))
  }
  history.replaceState = function (data, unused, url) {
    return original.replaceState.call(this, data, unused, withParams(url))
  }
  return () => {
    history.pushState = original.pushState
    history.replaceState = original.replaceState
  }
}

export function readCanvasBridge(frame: HTMLIFrameElement): CanvasBridge | null {
  try {
    return (frame.contentWindow as unknown as CanvasGlobals | null)?.__veditCanvas ?? null
  } catch {
    return null
  }
}

/**
 * The URL to load in an artboard: that page, flagged as the canvas child. The
 * host page's own query survives, so whatever it carries — a preview token, the
 * signed-in user, a feature flag — is still there inside the frame.
 */
export function canvasUrl(pathOrHref: string, viewportHeight?: number): string {
  const here = typeof window === 'undefined' ? 'http://localhost' : window.location.href
  const url = new URL(pathOrHref, here)
  for (const [name, value] of new URL(here).searchParams) {
    if (name === 'vedit' || name === CANVAS_PARAM || name === CANVAS_VH_PARAM) continue
    if (!url.searchParams.has(name)) url.searchParams.set(name, value)
  }
  url.searchParams.set(CANVAS_PARAM, '1')
  if (viewportHeight) url.searchParams.set(CANVAS_VH_PARAM, String(viewportHeight))
  url.searchParams.delete('vedit')
  return url.toString()
}
