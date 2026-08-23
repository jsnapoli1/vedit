import { useCallback, useState } from 'react'
import { useVeditContext } from '../core/context'
import { CanvasShell } from './canvas/CanvasShell'
import { EditorRoot } from './EditorRoot'

/**
 * Chooses how to edit: on the canvas (the page in a frame you can zoom and pan)
 * or, when the page can't be framed, as an overlay on the page itself.
 */
export function EditorMount({ canvas }: { canvas: boolean }) {
  const { store, config } = useVeditContext()
  const [framed, setFramed] = useState(canvas)

  const onUnavailable = useCallback(() => {
    setFramed(false)
    store.notify("This page can't be framed — editing it in place instead")
  }, [store])

  const onClose = useCallback(() => store.setEditing(false), [store])

  if (!framed) return <EditorRoot />
  return <CanvasShell config={config} onClose={onClose} onUnavailable={onUnavailable} />
}
