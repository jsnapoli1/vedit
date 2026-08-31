import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { IconChevron, IconReset } from './icons'

export function Section({
  title,
  children,
  defaultOpen = true,
  action,
}: {
  title: string
  children: ReactNode
  defaultOpen?: boolean
  action?: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="vedit-section">
      <div className="vedit-section-title" onClick={() => setOpen(!open)}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <IconChevron style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform .12s' }} />
          {title}
        </span>
        <span onClick={(event) => event.stopPropagation()}>{action}</span>
      </div>
      {open ? children : null}
    </div>
  )
}

/**
 * The name of the group a control sits in — "Size", "Padding", "Position".
 *
 * The inspector's labels are laid out, not associated: a row's label is a span
 * beside the control, and a compact field carries its label as a prefix inside
 * itself. Both read fine and neither reaches a screen reader, which announces
 * "edit text" and leaves you to guess which of nine numeric fields you are in.
 *
 * Rather than have forty call sites each pass an `aria-label`, the row publishes
 * its own label and the controls inside compose their name from it. A control
 * that already names itself is left alone.
 */
const FieldGroup = createContext<string | undefined>(undefined)

/** Compose an accessible name from the row this control sits in and its own label. */
export function useFieldName(own?: ReactNode): string | undefined {
  const group = useContext(FieldGroup)
  const label = typeof own === 'string' ? own : undefined
  if (group && label) return `${group} ${label}`
  return group ?? label
}

export function Row({
  label,
  children,
  overridden,
  onReset,
}: {
  label?: string
  children: ReactNode
  overridden?: boolean
  onReset?: () => void
}) {
  return (
    <div className="vedit-row">
      {label ? <span className="vedit-label">{label}</span> : null}
      <FieldGroup.Provider value={label}>{children}</FieldGroup.Provider>
      {onReset ? (
        <button
          type="button"
          className="vedit-reset"
          data-visible={overridden ? 'true' : 'false'}
          title="Reset to the site's own styling"
          onClick={onReset}
        >
          <IconReset />
        </button>
      ) : null}
    </div>
  )
}

export function TextField({
  value,
  placeholder,
  onChange,
  prefix,
  overridden,
  type = 'text',
}: {
  value: string
  placeholder?: string
  onChange: (next: string) => void
  prefix?: ReactNode
  overridden?: boolean
  type?: string
}) {
  const [draft, setDraft] = useState(value)
  const focused = useRef(false)
  const name = useFieldName(prefix)
  useEffect(() => {
    if (!focused.current) setDraft(value)
  }, [value])

  return (
    <label className="vedit-field" data-overridden={overridden ? 'true' : 'false'}>
      {prefix ? <span className="vedit-field-prefix">{prefix}</span> : null}
      <input
        className="vedit-input"
        aria-label={name}
        type={type}
        value={draft}
        placeholder={placeholder}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false
          onChange(draft)
        }}
        onChange={(event) => {
          setDraft(event.target.value)
          if (type === 'text') onChange(event.target.value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
        }}
      />
    </label>
  )
}

const LENGTH = /^(-?[\d.]+)([a-z%]*)$/i

export function splitLength(value: string | number | undefined): { number: number | null; unit: string } {
  if (value === undefined || value === '') return { number: null, unit: '' }
  if (typeof value === 'number') return { number: value, unit: 'px' }
  const match = LENGTH.exec(value.trim())
  if (!match) return { number: null, unit: '' }
  return { number: Number(match[1]), unit: match[2] || '' }
}

/**
 * A length input with Figma's scrub gesture: drag the label sideways to nudge the
 * value, or type into it directly. Empty means "leave the site's own value alone".
 */
export function LengthField({
  label,
  name: spoken,
  value,
  computed,
  onChange,
  step = 1,
  min,
  allowKeywords = true,
  defaultUnit = 'px',
}: {
  label?: string
  /**
   * What to call this field out loud, when `label` is an abbreviation. "W" and
   * "min W" are clear enough to read in a two-column grid and useless to hear.
   */
  name?: string
  value: string | number | undefined
  computed?: string
  onChange: (next: string | undefined) => void
  step?: number
  min?: number
  allowKeywords?: boolean
  /** Unit appended to bare numbers. Pass `''` for unitless values like `opacity`. */
  defaultUnit?: string
}) {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value))
  const focused = useRef(false)
  const name = useFieldName(spoken ?? label)
  useEffect(() => {
    if (!focused.current) setDraft(value === undefined ? '' : String(value))
  }, [value])

  const commit = (raw: string) => {
    const text = raw.trim()
    if (!text) return onChange(undefined)
    if (/^-?[\d.]+$/.test(text)) return onChange(`${text}${defaultUnit}`)
    if (LENGTH.test(text) || allowKeywords) return onChange(text)
    onChange(undefined)
  }

  const startScrub = (event: React.PointerEvent) => {
    const parsed = splitLength(draft || computed || '')
    if (parsed.number === null) return
    event.preventDefault()
    const startX = event.clientX
    const startValue = parsed.number
    const unit = parsed.unit || defaultUnit
    const target = event.currentTarget as HTMLElement
    target.setPointerCapture(event.pointerId)

    const move = (moveEvent: PointerEvent) => {
      const delta = Math.round((moveEvent.clientX - startX) / 2) * step
      let next = startValue + delta
      if (min !== undefined) next = Math.max(min, next)
      const text = `${Math.round(next * 100) / 100}${unit}`
      setDraft(text)
      onChange(text)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="vedit-field" data-overridden={value !== undefined ? 'true' : 'false'}>
      {label ? (
        <span className="vedit-field-prefix" style={{ cursor: 'ew-resize' }} onPointerDown={startScrub}>
          {label}
        </span>
      ) : null}
      <input
        className="vedit-input"
        aria-label={name}
        value={draft}
        placeholder={computed ? shorten(computed) : 'auto'}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false
          commit(draft)
        }}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') return (event.target as HTMLInputElement).blur()
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
          const parsed = splitLength(draft || computed || '')
          if (parsed.number === null) return
          event.preventDefault()
          const amount = (event.shiftKey ? 10 : 1) * step * (event.key === 'ArrowUp' ? 1 : -1)
          const next = `${Math.round((parsed.number + amount) * 100) / 100}${parsed.unit || defaultUnit}`
          setDraft(next)
          onChange(next)
        }}
      />
    </div>
  )
}

export function SelectField({
  value,
  computed,
  options,
  onChange,
  name: spoken,
}: {
  value: string | number | undefined
  computed?: string
  options: Array<{ value: string; label: string }>
  onChange: (next: string | undefined) => void
  /** For a field that sits outside a labelled row and must name itself. */
  name?: string
}) {
  const name = useFieldName(spoken)
  return (
    <select
      className="vedit-select"
      aria-label={name}
      value={value === undefined ? '' : String(value)}
      onChange={(event) => onChange(event.target.value || undefined)}
    >
      <option value="">{computed ? `${shorten(computed)} (inherited)` : 'default'}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T | undefined
  options: Array<{ value: T; label: ReactNode; title?: string }>
  onChange: (next: T | undefined) => void
}) {
  const name = useFieldName()
  return (
    <div className="vedit-segmented" role="group" aria-label={name}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          data-active={value === option.value ? 'true' : 'false'}
          onClick={() => onChange(value === option.value ? undefined : option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function ColorField({
  value,
  computed,
  onChange,
}: {
  value: string | number | undefined
  computed?: string
  onChange: (next: string | undefined) => void
}) {
  const shown = typeof value === 'string' ? value : computed ?? ''
  const name = useFieldName()
  return (
    <>
      <span className="vedit-swatch">
        <span style={{ background: shown }} />
        <input
          type="color"
          value={toHex(shown)}
          onChange={(event) => onChange(event.target.value)}
          aria-label={name ?? 'Color'}
        />
      </span>
      <TextField
        value={typeof value === 'string' ? value : ''}
        placeholder={computed ? shorten(computed) : 'inherit'}
        overridden={value !== undefined}
        onChange={(next) => onChange(next || undefined)}
      />
    </>
  )
}

function shorten(value: string): string {
  const trimmed = value.trim()
  return trimmed.length > 18 ? `${trimmed.slice(0, 18)}…` : trimmed
}

/** `rgb(…)` from `getComputedStyle` has to become `#rrggbb` for `<input type=color>`. */
export function toHex(color: string): string {
  const match = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(color)
  if (match) {
    const hex = [1, 2, 3].map((i) => Number(match[i]).toString(16).padStart(2, '0')).join('')
    return `#${hex}`
  }
  return /^#[0-9a-f]{6}$/i.test(color.trim()) ? color.trim() : '#000000'
}

export function Slider({
  value,
  min = 0,
  max = 1,
  step = 0.01,
  fallback,
  onChange,
}: {
  value: string | number | undefined
  min?: number
  max?: number
  step?: number
  fallback: number
  onChange: (next: string) => void
}) {
  const current = value === undefined ? fallback : Number(value)
  const name = useFieldName()
  return (
    <input
      type="range"
      className="vedit-input"
      aria-label={name}
      style={{ accentColor: 'var(--vedit-accent)', cursor: 'pointer' }}
      min={min}
      max={max}
      step={step}
      value={Number.isFinite(current) ? current : fallback}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}
