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
  type CSSProperties,
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
import { VeditErrorBoundary, type VeditErrorBoundaryProps } from './ErrorBoundary'
import { componentManifest, type ComponentRegistry, type ComponentSummary } from './registry'
import { RealtimeSession, type SessionSnapshot } from './session'
import type { Peer, VeditRealtime } from './realtime'

export interface VeditConfig {
  breakpoints: BreakpointWidths
  auto: boolean
  autoSelector: string
  enabled: boolean
  /** Artboards to show on the canvas. */
  pages: Array<{ path: string; label?: string }>
  /**
   * The components the editor may place, without the components themselves. The
   * panels run in the parent window while the page runs in an artboard, so what
   * they share has to survive being read across that boundary.
   */
  components: ComponentSummary[]
}

export interface VeditContextValue {
  store: VeditStore
  config: VeditConfig
  /** The real components, for rendering. Empty in the window that only draws chrome. */
  registry: ComponentRegistry
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

/** Presence and comments for the document being edited, or null when off. */
export function useVeditSession(): SessionSnapshot & { session: RealtimeSession | null } {
  const store = useVeditStore()
  // Re-reads when the provider swaps the session in or out.
  useVeditState((state) => state.sessionId)
  const session = store.session
  const snapshot = useSyncExternalStore(
    session ? session.subscribe : NO_SESSION.subscribe,
    session ? session.getSnapshot : NO_SESSION.getSnapshot,
    session ? session.getSnapshot : NO_SESSION.getSnapshot,
  )
  return { ...snapshot, session }
}

const EMPTY_SNAPSHOT: SessionSnapshot = { peers: [], comments: [], staleSince: null }
const NO_SESSION = {
  subscribe: () => () => undefined,
  getSnapshot: () => EMPTY_SNAPSHOT,
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
  /**
   * Turns on presence and comments. `broadcastChannelRealtime()` works across
   * tabs with no backend; `sseRealtime({ endpoint })` pairs with
   * `createRealtimeHandler` for people on different machines.
   */
  realtime?: VeditRealtime
  /** Who is editing. Without it, everyone shows up as a named anonymous animal. */
  user?: Partial<Peer>
  /** Which room to join. One room can carry several documents; defaults to `vedit`. */
  realtimeRoom?: string
  /**
   * Called when any part of the editor throws while rendering. The failing part
   * is unmounted rather than taking your page with it; this is how you hear
   * about it. Without it, failures go to `console.error`.
   */
  onError?: (error: Error, info: { part: string; componentStack?: string }) => void
  /** Save automatically this many ms after the last change. 0 disables it. */
  autosaveMs?: number
  onSave?: (doc: VeditDocument) => void
  /**
   * Components the editor may place on a page, keyed by the name stored in the
   * document. Declare them with `defineComponents`. Without this the editor can
   * still change what your code renders; with it, people can compose pages out of
   * your components.
   */
  components?: ComponentRegistry
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

/** Stable identity, so a provider with no components doesn't churn the context. */
const EMPTY_REGISTRY: ComponentRegistry = {}

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
  realtime,
  user,
  realtimeRoom,
  autosaveMs = 0,
  onError,
  onSave,
  components,
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
  const registry = components ?? EMPTY_REGISTRY
  const manifest = useMemo(() => componentManifest(registry), [registry])
  const config = useMemo<VeditConfig>(
    () => ({
      breakpoints,
      auto,
      autoSelector,
      enabled: isEnabled,
      pages: pages ?? [
        { path: typeof window === 'undefined' ? '/' : window.location.pathname, label: 'This page' },
      ],
      components: manifest,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [breakpoints, auto, autoSelector, isEnabled, pagesKey, manifest],
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
      // The manifest travels with the store: the chrome in the parent window can
      // then offer this page's components without importing the app that has them.
      publishCanvasBridge({
        store,
        breakpoints,
        path: window.location.pathname,
        components: manifest,
      })
    }
  }, [framedByEditor, store, breakpoints, manifest])

  // Collaboration belongs to whichever store is actually being edited: the framed
  // page on the canvas, or this one when editing in place. Attaching it to both
  // would put the same person in the room twice.
  // Read straight from the store: this component *is* the provider, so the
  // context hooks aren't available to it yet.
  const editing = useSyncExternalStore(
    store.subscribe,
    () => store.getState().editing,
    () => store.getState().editing,
  )
  const collaborating = !!realtime && (framedByEditor || (editing && !canvas))
  const userKey = user ? JSON.stringify(user) : ''

  useEffect(() => {
    if (!collaborating || !realtime) return
    const session = new RealtimeSession(
      store,
      realtime,
      adapter ?? store.adapter,
      user,
      realtimeRoom ?? 'vedit',
    )
    store.setSession(session)
    void session.start()
    const untrack = session.trackPointer(document)
    return () => {
      untrack()
      session.stop()
      if (store.session === session) store.setSession(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collaborating, realtime, store, realtimeRoom, userKey])

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

  const value = useMemo<VeditContextValue>(
    () => ({ store, config, registry }),
    [store, config, registry],
  )

  // Each piece is guarded separately: a broken panel shouldn't cost you the
  // override styles, and none of it should cost the host their page.
  const guard = (part: string, node: ReactNode, fallback?: VeditErrorBoundaryProps['fallback']) => (
    <VeditErrorBoundary part={part} onError={onError} fallback={fallback}>
      {node}
    </VeditErrorBoundary>
  )

  return (
    <VeditContext.Provider value={value}>
      {guard('override styles', <OverrideStyles />)}
      {children}
      {auto ? guard('the DOM scanner', <AutoScanner />) : null}
      {isEnabled && !framedByEditor
        ? guard('the editor', <EditorHost canvas={canvas} />, (error, retry) => (
            <EditorCrashed store={store} error={error} onRetry={retry} />
          ))
        : null}
    </VeditContext.Provider>
  )
}

/**
 * Shown in place of the editor after it throws. Deliberately styled inline: the
 * editor's stylesheet lives in the chunk that just failed.
 */
function EditorCrashed({
  store,
  error,
  onRetry,
}: {
  store: VeditStore
  error: Error
  onRetry: () => void
}) {
  const button: CSSProperties = {
    font: 'inherit',
    color: '#fff',
    background: 'rgba(255,255,255,.14)',
    border: 0,
    borderRadius: 6,
    padding: '5px 10px',
    cursor: 'pointer',
  }

  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        zIndex: 2147483001,
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        maxWidth: 'min(560px, calc(100vw - 32px))',
        padding: '10px 14px',
        borderRadius: 10,
        background: '#2c2c2c',
        color: '#e8e8e8',
        border: '1px solid #b4443a',
        boxShadow: '0 10px 26px rgba(0,0,0,.4)',
        font: '12px/1.45 ui-sans-serif, system-ui, sans-serif',
      }}
    >
      <span style={{ flex: 1 }}>
        The editor hit an error and closed. Your page is fine; unsaved edits are not.
        <br />
        <code style={{ opacity: 0.7 }}>{error.message}</code>
      </span>
      <button type="button" style={button} onClick={onRetry}>
        Reopen
      </button>
      <button
        type="button"
        style={button}
        onClick={() => {
          store.setEditing(false)
          onRetry()
        }}
      >
        Dismiss
      </button>
    </div>
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
