import { useState } from 'react'
import { useVeditState, useVeditStore } from '../../core/context'
import type { DesignToken } from '../../core/types'
import { tokenReference, tokenVariable } from '../../runtime/css'
import { TextField } from '../controls'
import { IconPlus, IconTrash } from '../icons'

const KINDS: Array<{ kind: DesignToken['kind']; label: string; sample: string }> = [
  { kind: 'color', label: 'Colors', sample: '#4f46e5' },
  { kind: 'length', label: 'Spacing & sizes', sample: '16px' },
  { kind: 'font', label: 'Fonts', sample: 'Inter, sans-serif' },
  { kind: 'shadow', label: 'Shadows', sample: '0 4px 12px rgba(0,0,0,.1)' },
]

export function useTokens(kind?: DesignToken['kind']): DesignToken[] {
  const tokens = useVeditState((state) => state.doc.tokens)
  const all = tokens ?? []
  return kind ? all.filter((token) => token.kind === kind) : all
}

/** `var(--vedit-x)` back to the token it names. */
export function tokenFromValue(value: unknown, tokens: DesignToken[]): DesignToken | undefined {
  if (typeof value !== 'string') return undefined
  const match = /^var\(\s*--vedit-([a-z0-9-]+)\s*\)$/i.exec(value.trim())
  return match ? tokens.find((token) => token.id === match[1]) : undefined
}

/**
 * The site's shared values. Editing one here changes every element that
 * references it, which is the whole point of naming a color instead of typing it
 * in forty places.
 */
export function TokensPanel() {
  const store = useVeditStore()
  const tokens = useTokens()

  return (
    <div className="vedit-panel-body">
      {KINDS.map((group) => {
        const rows = tokens.filter((token) => token.kind === group.kind)
        return (
          <div className="vedit-section" key={group.kind}>
            <div className="vedit-section-title" style={{ cursor: 'default' }}>
              {group.label}
              <button
                type="button"
                className="vedit-btn vedit-btn-icon"
                title={`Add a ${group.kind} token`}
                onClick={() => store.addToken({ name: `New ${group.kind}`, kind: group.kind, value: group.sample })}
              >
                <IconPlus width={12} height={12} />
              </button>
            </div>
            {rows.length ? (
              rows.map((token) => <TokenRow key={token.id} token={token} />)
            ) : (
              <div className="vedit-hint">None yet.</div>
            )}
          </div>
        )
      })}
      <div className="vedit-section vedit-hint">
        Tokens are published as CSS custom properties on <code>:root</code>, so your own
        stylesheets can use them too — <code>var(--vedit-brand)</code>.
      </div>
    </div>
  )
}

function TokenRow({ token }: { token: DesignToken }) {
  const store = useVeditStore()
  const [open, setOpen] = useState(false)

  return (
    <div style={{ marginBottom: 6 }}>
      <div className="vedit-row">
        {token.kind === 'color' ? (
          <span className="vedit-swatch">
            <span style={{ background: token.value }} />
            <input
              type="color"
              value={/^#[0-9a-f]{6}$/i.test(token.value) ? token.value : '#000000'}
              onChange={(event) => store.updateToken(token.id, { value: event.target.value })}
              aria-label={`${token.name} color`}
            />
          </span>
        ) : null}
        <button
          type="button"
          className="vedit-btn"
          style={{ flex: 1, justifyContent: 'space-between', paddingLeft: 6 }}
          onClick={() => setOpen(!open)}
          title={tokenVariable(token)}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{token.name}</span>
          <span className="vedit-hint" style={{ maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {token.value}
          </span>
        </button>
        <button
          type="button"
          className="vedit-btn vedit-btn-icon"
          title="Delete token"
          onClick={() => store.removeToken(token.id)}
        >
          <IconTrash width={12} height={12} />
        </button>
      </div>
      {open ? (
        <>
          <div className="vedit-row">
            <span className="vedit-label">Name</span>
            <TextField value={token.name} onChange={(name) => store.updateToken(token.id, { name })} />
          </div>
          <div className="vedit-row">
            <span className="vedit-label">Value</span>
            <TextField value={token.value} onChange={(value) => store.updateToken(token.id, { value })} />
          </div>
          <div className="vedit-hint" style={{ marginBottom: 4 }}>
            Referenced as <code>{tokenReference(token)}</code>
          </div>
        </>
      ) : null}
    </div>
  )
}

/**
 * The chip on the end of a colour or length field. Picking a token stores a
 * reference rather than a literal, so the value stays linked.
 */
export function TokenPicker({
  kind,
  value,
  onChange,
}: {
  kind: DesignToken['kind']
  value: string | number | undefined
  onChange: (next: string | undefined) => void
}) {
  const store = useVeditStore()
  const tokens = useTokens(kind)
  const linked = tokenFromValue(value, tokens)
  const [open, setOpen] = useState(false)

  if (!tokens.length && !linked) {
    // Offer to promote the current literal into a reusable token.
    if (typeof value !== 'string' || !value) return null
    return (
      <button
        type="button"
        className="vedit-token-chip"
        title="Save this value as a token"
        onClick={() => onChange(tokenReference(store.addToken({ name: value, kind, value })))}
      >
        +
      </button>
    )
  }

  return (
    <span style={{ position: 'relative', flex: 'none' }}>
      <button
        type="button"
        className="vedit-token-chip"
        data-linked={linked ? 'true' : 'false'}
        title={linked ? `Linked to ${linked.name}` : 'Use a token'}
        onClick={() => setOpen(!open)}
      >
        {linked ? linked.name.slice(0, 1).toUpperCase() : 'T'}
      </button>
      {open ? (
        <div className="vedit-token-menu" onMouseLeave={() => setOpen(false)}>
          {linked ? (
            <button type="button" onClick={() => { onChange(linked.value); setOpen(false) }}>
              Detach from {linked.name}
            </button>
          ) : null}
          {tokens.map((token) => (
            <button
              key={token.id}
              type="button"
              onClick={() => {
                onChange(tokenReference(token))
                setOpen(false)
              }}
            >
              {token.kind === 'color' ? (
                <span className="vedit-token-dot" style={{ background: token.value }} />
              ) : null}
              {token.name}
            </button>
          ))}
          {typeof value === 'string' && value && !linked ? (
            <button
              type="button"
              onClick={() => {
                onChange(tokenReference(store.addToken({ name: value, kind, value })))
                setOpen(false)
              }}
            >
              + Save “{value}” as a token
            </button>
          ) : null}
        </div>
      ) : null}
    </span>
  )
}
