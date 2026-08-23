import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useVeditState, useVeditStore } from '../core/context'
import { useEditorInteractions } from './interactions'
import { Overlay } from './Overlay'
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
  const pageDocument = target.getDocument()

  useEditorStyles(interactive ? pageDocument : document)
  useEditorInteractions(store, target, { enabled: interactive })

  useEffect(() => {
    if (!interactive) return
    const root = pageDocument.documentElement
    root.classList.add('vedit-editing')
    return () => root.classList.remove('vedit-editing')
  }, [pageDocument, interactive])

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
    <div className="vedit-root" data-vedit-ui="" data-collapsed={collapsed ? 'true' : 'false'}>
      <Overlay />
      {indicator ? <div className="vedit-drop" style={indicator} /> : null}
      <Toolbar
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((value) => !value)}
        extras={toolbarExtras}
      />
      <LeftPanel />
      <Inspector />
      {tool !== 'select' && tool !== 'hand' ? (
        <div className="vedit-toast" data-vedit-ui="">
          Click a container to drop the new {tool} in — Esc or V to cancel
        </div>
      ) : null}
      {notice && tool === 'select' ? (
        <div className="vedit-toast" data-vedit-ui="">
          {notice}
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
