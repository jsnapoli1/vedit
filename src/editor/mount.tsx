import { useCallback, useEffect, useState } from 'react'
import { useVeditContext, useVeditState } from '../core/context'
import { CanvasShell } from './canvas/CanvasShell'
import { EditorRoot } from './EditorRoot'
import { SignIn } from './SignIn'

/**
 * Chooses how to edit: on the canvas (the page in a frame you can zoom and pan)
 * or, when the page can't be framed, as an overlay on the page itself.
 */
export function EditorMount({ canvas }: { canvas: boolean }) {
  const { store, config } = useVeditContext()
  const [framed, setFramed] = useState(canvas)
  // Gated here, on the provider's own store, rather than inside the chrome: the
  // canvas would otherwise load every artboard before anyone had signed in.
  const auth = useVeditState((state) => state.auth)
  const signingIn = auth === 'required' && typeof store.content?.login === 'function'

  // Editing in place: swap the live document for the draft, unless there is
  // unsaved work that swapping would throw away.
  useEffect(() => {
    if (framed || signingIn || !store.supportsPublishing || store.dirty) return
    void store.load('draft').catch(() => undefined)
  }, [framed, signingIn, store])

  const onUnavailable = useCallback(() => {
    setFramed(false)
    store.notify("This page can't be framed — editing it in place instead")
  }, [store])

  const onClose = useCallback(() => store.setEditing(false), [store])

  if (signingIn) return <SignIn onCancel={onClose} />
  if (!framed) return <EditorRoot />
  return (
    <CanvasShell config={config} pages={config.pages} onClose={onClose} onUnavailable={onUnavailable} />
  )
}
