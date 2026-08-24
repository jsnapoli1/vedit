import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useVeditSession, useVeditState, useVeditStore } from '../core/context'
import { useEditorInteractions } from './interactions'
import { Overlay } from './Overlay'
import { CommentsLayer } from './CommentsLayer'
import { PresenceLayer } from './PresenceLayer'
import { Inspector } from './panels/Inspector'
import { LeftPanel } from './panels/LeftPanel'
import { Toolbar } from './panels/Toolbar'
import { EDITOR_CSS } from './styles'
import { toScreen, useEditorTarget } from './target'

const STYLE_ID = 'vedit-editor-styles'

/** The chrome's stylesheet, and the page's own copy when it lives in a frame. */
function useEditorStyles(pageDocument: Document) {
  useEffect(() => {
    for (const doc of new Set([document, pageDocument])) {
      if (doc.getElementById(STYLE_ID)) continue
      const style = doc.createElement('style')
      style.id = STYLE_ID
      style.textContent = EDITOR_CSS
      doc.head.appendChild(style)
    }
  }, [pageDocument])
}

export interface EditorRootProps {
  /** Extra controls for the toolbar, e.g. the canvas zoom widget. */
  toolbarExtras?: React.ReactNode
  /**
   * Whether this instance installs the page-level gestures. The canvas wires each
   * artboard up separately, so its chrome is drawing and panels only.
   */
  interactive?: boolean
}

/**
 * The editor chrome. Rendered into a portal on this document's body so it sits
 * above everything, while the page it edits may be this document or a framed one.
 */
export function EditorRoot({ toolbarExtras, interactive = true }: EditorRootProps = {}) {
  const store = useVeditStore()
  const target = useEditorTarget()
  const [collapsed, setCollapsed] = useState(false)
  const status = useVeditState((state) => state.status)
  const error = useVeditState((state) => state.error)
  const tool = useVeditState((state) => state.tool)
  const notice = useVeditState((state) => state.notice)
  const dropIndicator = useVeditState((state) => state.dropIndicator)
  const { staleSince } = useVeditSession()
  const pageDocument = target.getDocument()

  const root = useRef<HTMLDivElement>(null)

  useEditorStyles(interactive ? pageDocument : document)

  // Opening the editor puts the tab sequence at the toolbar, and closing it gives
  // focus back to whatever had it. Without this, opening from the keyboard leaves
  // focus on the page and every panel is several dozen tabs away — the chrome is
  // portalled to the end of <body>, behind everything the site renders.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    root.current?.querySelector<HTMLElement>('.vedit-toolbar')?.focus()
    return () => {
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  useEditorInteractions(store, target, { enabled: interactive })

  useEffect(() => {
    if (!interactive) return
    const root = pageDocument.documentElement
    root.classList.add('vedit-editing')
    return () => root.classList.remove('vedit-editing')
  }, [pageDocument, interactive])

  // The comment tool changes the cursor over the whole page.
  useEffect(() => {
    const root = pageDocument.documentElement
    root.classList.toggle('vedit-commenting', tool === 'comment')
    return () => root.classList.remove('vedit-commenting')
  }, [pageDocument, tool])

  // `\` hides the panels so you can reach whatever they're covering.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement | null
      const typing = !!element && (element.isContentEditable || ['INPUT', 'TEXTAREA'].includes(element.tagName))
      if (event.key === '\\' && !typing) {
        event.preventDefault()
        setCollapsed((value) => !value)
      }
    }
    for (const doc of new Set([document, pageDocument])) doc.addEventListener('keydown', onKeyDown)
    return () => {
      for (const doc of new Set([document, pageDocument])) doc.removeEventListener('keydown', onKeyDown)
    }
  }, [pageDocument])

  // Warn before losing unsaved work.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (store.dirty) event.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [store])

  if (typeof document === 'undefined') return null

  const indicator = dropIndicator ? toScreen(dropIndicator, target.getViewport()) : null

  return createPortal(
    <div
      className="vedit-root"
      data-vedit-ui=""
      data-collapsed={collapsed ? 'true' : 'false'}
      ref={root}
      role="region"
      aria-label="vedit editor"
    >
      <Overlay />
      <PresenceLayer />
      <CommentsLayer />
      {indicator ? <div className="vedit-drop" style={indicator} /> : null}
      <Toolbar
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((value) => !value)}
        extras={toolbarExtras}
      />
      <LeftPanel />
      <Inspector />
      {tool === 'comment' ? (
        <div className="vedit-toast" data-vedit-ui="">
          Click anywhere to leave a note — Esc to cancel
        </div>
      ) : null}
      {tool !== 'select' && tool !== 'hand' && tool !== 'comment' ? (
        <div className="vedit-toast" data-vedit-ui="">
          Click a container to drop the new {tool} in — Esc or V to cancel
        </div>
      ) : null}
      {notice && tool === 'select' ? (
        <div className="vedit-toast" data-vedit-ui="">
          {notice}
        </div>
      ) : null}
      {staleSince ? (
        <div className="vedit-toast" data-tone="warn" data-vedit-ui="">
          Someone else saved since you loaded. Saving now replaces their version.
          <button
            type="button"
            className="vedit-btn"
            style={{ marginLeft: 8, height: 22 }}
            onClick={() => void store.load('draft').catch(() => undefined)}
          >
            Load theirs
          </button>
        </div>
      ) : null}
      {status === 'error' && error ? (
        <div className="vedit-toast" data-tone="error" data-vedit-ui="">
          {error}
        </div>
      ) : null}
    </div>,
    document.body,
  )
}
