import { useEffect, useState, type FormEvent } from 'react'
import { useVeditStore } from '../core/context'
import { EDITOR_CSS } from './styles'

const STYLE_ID = 'vedit-editor-styles'

/**
 * The form shown instead of the editor while the content client says signing
 * in would let this person edit. Nothing else of the chrome mounts behind it —
 * no artboards, no panels — so a page is never loaded into a frame on behalf of
 * someone who turns out not to be allowed to change it.
 */
export function SignIn({ onCancel }: { onCancel: () => void }) {
  const store = useVeditStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The chrome's stylesheet is installed by EditorRoot, which is exactly what
  // has not mounted yet.
  useEffect(() => {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = EDITOR_CSS
    document.head.appendChild(style)
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await store.login(email.trim(), password)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="vedit-root vedit-signin-backdrop" data-vedit-ui="" role="region" aria-label="vedit editor">
      <form className="vedit-panel vedit-signin" onSubmit={(event) => void submit(event)} aria-label="Sign in">
        <div className="vedit-panel-head">Sign in to edit</div>
        <div className="vedit-signin-body">
          <label className="vedit-signin-field">
            <span>Email</span>
            <input
              className="vedit-signin-input"
              type="email"
              name="email"
              autoComplete="username"
              autoFocus
              required
              value={email}
              disabled={pending}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="vedit-signin-field">
            <span>Password</span>
            <input
              className="vedit-signin-input"
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              disabled={pending}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error ? (
            <div className="vedit-signin-error" role="alert">
              {error}
            </div>
          ) : null}
          <div className="vedit-signin-actions">
            <button type="button" className="vedit-btn" disabled={pending} onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="vedit-btn vedit-btn-primary" disabled={pending}>
              {pending ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
