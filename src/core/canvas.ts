import type { VeditStore } from './store'

export const CANVAS_PARAM = 'vedit-canvas'

/** What the framed page hands to the editor running in the parent window. */
export interface CanvasBridge {
  store: VeditStore
  breakpoints: Record<string, number>
  /** Which artboard this is, so the editor can tell several frames apart. */
  path: string
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

export function readCanvasBridge(frame: HTMLIFrameElement): CanvasBridge | null {
  try {
    return (frame.contentWindow as unknown as CanvasGlobals | null)?.__veditCanvas ?? null
  } catch {
    return null
  }
}

/** The URL to load in an artboard: that page, flagged as the canvas child. */
export function canvasUrl(pathOrHref: string): string {
  const url = new URL(pathOrHref, typeof window === 'undefined' ? 'http://localhost' : window.location.href)
  url.searchParams.set(CANVAS_PARAM, '1')
  url.searchParams.delete('vedit')
  return url.toString()
}
