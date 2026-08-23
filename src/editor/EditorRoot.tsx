import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useVeditState, useVeditStore } from '../core/context'
import { useEditorInteractions } from './interactions'
import { Overlay } from './Overlay'
import { Inspector } from './panels/Inspector'
import { LayersPanel } from './panels/Layers'
import { Toolbar } from './panels/Toolbar'
import { EDITOR_CSS } from './styles'

const STYLE_ID = 'vedit-editor-styles'

function useEditorStyles() {
  useEffect(() => {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = EDITOR_CSS
    document.head.appendChild(style)
  }, [])
}

/**
 * The editor chrome. Rendered into a portal on `document.body` so it sits above the
 * host site without inheriting any of its styles.
 */
export function EditorRoot() {
  const store = useVeditStore()
  const [collapsed, setCollapsed] = useState(false)
  const status = useVeditState((state) => state.status)
  const error = useVeditState((state) => state.error)
  const tool = useVeditState((state) => state.tool)
  const notice = useVeditState((state) => state.notice)

  useEditorStyles()
  useEditorInteractions(store)

  useEffect(() => {
    document.documentElement.classList.add('vedit-editing')
    return () => document.documentElement.classList.remove('vedit-editing')
  }, [])

  // `\` hides the panels so you can reach whatever they're covering.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = !!target && (target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(target.tagName))
      if (event.key === '\\' && !typing) {
        event.preventDefault()
        setCollapsed((value) => !value)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Warn before losing unsaved work.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (store.dirty) event.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [store])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="vedit-root" data-vedit-ui="" data-collapsed={collapsed ? 'true' : 'false'}>
      <Overlay />
      <Toolbar collapsed={collapsed} onToggleCollapsed={() => setCollapsed((value) => !value)} />
      <LayersPanel />
      <Inspector />
      {tool !== 'select' ? (
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
