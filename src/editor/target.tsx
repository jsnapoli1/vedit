import { createContext, useContext, type ReactNode } from 'react'

/** How the page being edited is placed on screen. */
export interface Viewport {
  /** Screen coordinates of the page's top-left corner. */
  originX: number
  originY: number
  zoom: number
}

export interface Rect {
  top: number
  left: number
  width: number
  height: number
}

/**
 * Where the page being edited actually lives. In overlay mode that's this very
 * document; on the canvas it's an iframe that can be zoomed and panned, so every
 * measurement has to be mapped through a viewport before it is drawn.
 */
export interface EditorTarget {
  getWindow(): Window
  getDocument(): Document
  getViewport(): Viewport
}

const SAME_DOCUMENT: EditorTarget = {
  getWindow: () => window,
  getDocument: () => document,
  getViewport: () => ({ originX: 0, originY: 0, zoom: 1 }),
}

const TargetContext = createContext<EditorTarget>(SAME_DOCUMENT)

export function useEditorTarget(): EditorTarget {
  return useContext(TargetContext)
}

export function EditorTargetProvider({ value, children }: { value: EditorTarget; children: ReactNode }) {
  return <TargetContext.Provider value={value}>{children}</TargetContext.Provider>
}

/** Page coordinates to screen coordinates. */
export function toScreen(rect: Rect, viewport: Viewport): Rect {
  return {
    top: viewport.originY + rect.top * viewport.zoom,
    left: viewport.originX + rect.left * viewport.zoom,
    width: rect.width * viewport.zoom,
    height: rect.height * viewport.zoom,
  }
}
