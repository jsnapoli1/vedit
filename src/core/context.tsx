import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from 'react'
import { localStorageAdapter } from './adapters/localStorage'
import { VeditStore } from './store'
import {
  DEFAULT_BREAKPOINTS,
  type BreakpointWidths,
  type RegisteredNode,
  type VeditAdapter,
  type VeditDocument,
  type VeditState,
} from './types'
import { documentToCss } from '../runtime/css'
import { AutoScanner } from '../auto/scanner'
import { isCanvasChild, publishCanvasBridge } from './canvas'

export interface VeditConfig {
  breakpoints: BreakpointWidths
  auto: boolean
  autoSelector: string
  enabled: boolean
  /** Artboards to show on the canvas. */
  pages: Array<{ path: string; label?: string }>
}

export interface VeditContextValue {
  store: VeditStore
  config: VeditConfig
}

/** Exported so the canvas can point the editor UI at the framed page's store. */
export const VeditContext = createContext<VeditContextValue | null>(null)

export function useVeditContext(): VeditContextValue {
  const context = useContext(VeditContext)
  if (!context) throw new Error('Vedit components must be rendered inside <VeditProvider>')
  return context
}

/** Optional variant for components that should work with or without a provider. */
export function useOptionalVeditContext(): VeditContextValue | null {
  return useContext(VeditContext)
}

/** Subscribe to a slice of editor state. */
export function useVeditState<T>(selector: (state: VeditState) => T): T {
  const { store } = useVeditContext()
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  )
}

/** Subscribe to the set of nodes currently mounted on the page. */
export function useVeditNodes(): RegisteredNode[] {
  const { store } = useVeditContext()
  return useSyncExternalStore(store.subscribeNodes, store.getNodes, store.getNodes)
}

export function useVeditStore(): VeditStore {
  return useVeditContext().store
}

/** `[editing, setEditing]` — handy for a "Edit this page" button in your own chrome. */
export function useVeditEditing(): [boolean, (editing: boolean) => void] {
  const store = useVeditStore()
  const editing = useVeditState((state) => state.editing)
  const setEditing = useCallback((next: boolean) => store.setEditing(next), [store])
  return [editing, setEditing]
}

export interface VeditProviderProps {
  children: ReactNode
  /** Which document to load. Defaults to the current pathname. */
  documentKey?: string
  /** Where overrides are stored. Defaults to `localStorage`. */
  adapter?: VeditAdapter
  /**
   * Whether the editor may be opened at all. Defaults to true in development or
   * when the URL carries `?vedit=1`, so production visitors never load the UI.
   */
  enabled?: boolean
  /** Open the editor immediately. */
  defaultEditing?: boolean
  /** Let the editor target elements that aren't wrapped in `<Editable>`. */
  auto?: boolean
  /** Which elements the DOM scanner considers editable. */
  autoSelector?: string
  breakpoints?: BreakpointWidths
  /** Server-rendered overrides, so the first paint already includes them. */
  initialDocument?: VeditDocument | null
  /**
   * Edit on a zoomable canvas, with the page loaded into a same-origin frame.
   * Turn it off to edit the page in place instead (the editor falls back to that
   * automatically when the page refuses to be framed).
   */
  canvas?: boolean
  /**
   * Pages to lay out side by side on the canvas, so several routes can be edited
   * in one session. Defaults to whichever page the editor was opened on.
   */
  pages?: Array<{ path: string; label?: string }>
  /** Save automatically this many ms after the last change. 0 disables it. */
  autosaveMs?: number
  onSave?: (doc: VeditDocument) => void
}

/**
 * Broad on purpose: an element the scanner skips can't be selected, and — more
 * subtly — can't be re-ordered either, because `order` has to be set on every
 * child of a container for the result to be predictable.
 */
const DEFAULT_AUTO_SELECTOR = [
  'h1,h2,h3,h4,h5,h6,p,span,a,li,dt,dd,blockquote,figcaption,td,th,label,button',
  'img,svg,picture,video,canvas,figure',
  'div,section,article,header,footer,main,aside,nav,form,ul,ol,dl,table,pre',
].join(',')

const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\]|.*\.local)$/

/**
 * Production visitors should never be able to open the editor, so it stays off
 * unless something says otherwise: an explicit `?vedit` in the URL, a development
 * build, or a local hostname. Pass `enabled` to wire it to your own auth instead.
 */
function defaultEnabled(): boolean {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  if (params.has('vedit')) return params.get('vedit') !== '0'
  if (LOCAL_HOSTS.test(window.location.hostname)) return true
  try {
    if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'development') return true
  } catch {
    // No `process` in the browser bundle — fall through.
  }
  return false
}

export function VeditProvider({
  children,
  documentKey,
  adapter,
  enabled,
  defaultEditing = false,
  auto = true,
  autoSelector = DEFAULT_AUTO_SELECTOR,
  breakpoints = DEFAULT_BREAKPOINTS,
  initialDocument = null,
  canvas = true,
  pages,
  autosaveMs = 0,
  onSave,
}: VeditProviderProps) {
  const key = documentKey ?? (typeof window !== 'undefined' ? window.location.pathname : 'default')
  const [store] = useState(
    () => new VeditStore({ key, adapter: adapter ?? localStorageAdapter(), autosaveMs }),
  )
  const isEnabled = enabled ?? defaultEnabled()
  // When this page is the artboard inside someone else's canvas it renders no
  // chrome of its own; it just hands its store to the editor in the parent window.
  const [framedByEditor] = useState(isCanvasChild)

  const pagesKey = pages ? JSON.stringify(pages) : ''
  const config = useMemo<VeditConfig>(
    () => ({
      breakpoints,
      auto,
      autoSelector,
      enabled: isEnabled,
      pages: pages ?? [
        { path: typeof window === 'undefined' ? '/' : window.location.pathname, label: 'This page' },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [breakpoints, auto, autoSelector, isEnabled, pagesKey],
  )

  const hydrated = useRef(false)
  if (!hydrated.current && initialDocument) {
    hydrated.current = true
    store.hydrate(initialDocument)
  }

  useEffect(() => {
    // The framed page is the editor's own copy, so it starts from the draft.
    if (!initialDocument) void store.load(framedByEditor ? 'draft' : 'published')
  }, [store, initialDocument, framedByEditor])

  useEffect(() => {
    if (defaultEditing && isEnabled) store.setEditing(true)
  }, [store, defaultEditing, isEnabled])

  useEffect(() => {
    if (framedByEditor) {
      publishCanvasBridge({ store, breakpoints, path: window.location.pathname })
    }
  }, [framedByEditor, store, breakpoints])

  // Notify the host app after every successful save.
  const savedRef = useRef<VeditDocument | null>(null)
  useEffect(
    () =>
      store.subscribe(() => {
        const { saved } = store.getState()
        if (onSave && savedRef.current && savedRef.current !== saved) onSave(saved)
        savedRef.current = saved
      }),
    [store, onSave],
  )

  const value = useMemo<VeditContextValue>(() => ({ store, config }), [store, config])

  return (
    <VeditContext.Provider value={value}>
      <OverrideStyles />
      {children}
      {auto ? <AutoScanner /> : null}
      {isEnabled && !framedByEditor ? <EditorHost canvas={canvas} /> : null}
    </VeditContext.Provider>
  )
}

/** Emits the override stylesheet. Rendered in view mode too — visitors see the edits. */
function OverrideStyles() {
  const { config } = useVeditContext()
  const doc = useVeditState((state) => state.doc)
  const css = useMemo(() => documentToCss(doc, config.breakpoints), [doc, config.breakpoints])
  if (!css) return null
  return <style data-vedit-overrides="" dangerouslySetInnerHTML={{ __html: css }} />
}

/**
 * Loads the editor chrome only once someone actually opens it, so the bundle a
 * visitor downloads stays small.
 */
function EditorHost({ canvas }: { canvas: boolean }) {
  const store = useVeditStore()
  const editing = useVeditState((state) => state.editing)
  const [Editor, setEditor] = useState<ComponentType<{ canvas: boolean }> | null>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Only opens. Closing goes through the editor itself, which knows to ask
      // about unsaved changes first.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'e') {
        if (store.getState().editing) return
        event.preventDefault()
        store.setEditing(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [store])

  useEffect(() => {
    if (!editing || Editor) return
    let cancelled = false
    void import('../editor/mount').then((module) => {
      if (!cancelled) setEditor(() => module.EditorMount as ComponentType<{ canvas: boolean }>)
    })
    return () => {
      cancelled = true
    }
  }, [editing, Editor])

  if (!editing || !Editor) return null
  return <Editor canvas={canvas} />
}
