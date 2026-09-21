import { useEffect, useRef, useState } from 'react'
import { useVeditState, useVeditStore } from '../../core/context'
import type {
  EditableField,
  FormField,
  FormFieldType,
  FormRule,
  PatternPreset,
  VeditAsset,
} from '../../core/types'
import type { VeditRecord } from '../../content/types'
import { assetUrl, isAsset } from '../../content/assets'
import { ColorField, LengthField, Row, Segmented, TextField } from '../controls'
import { autoCompleteFor } from '../../runtime/forms'
import { isFileHref } from '../../runtime/fileHref'
import { sanitizeHtml } from '../../runtime/sanitize'

/**
 * The editors for a declared field, by type. Shared between the Properties
 * section of the inspector (a component's props) and the Data panel (a record's
 * fields), so a `relation` or an `image` is the same control wherever it turns up.
 */

export type AssetKind = 'image' | 'file' | 'video'

/** What the file dialog offers when a field does not say. */
const DEFAULT_ACCEPT: Record<AssetKind, string> = { image: 'image/*', file: '*/*', video: 'video/*' }

function isAssetKind(type: EditableField['type']): type is AssetKind {
  return type === 'image' || type === 'file' || type === 'video'
}

export function PropField({
  field,
  value,
  source,
  onChange,
  record = false,
}: {
  field: EditableField
  value: unknown
  source: unknown
  onChange: (next: unknown) => void
  /**
   * True when the value lives on a record rather than a component prop. An
   * asset field then stores the whole `VeditAsset` — the server knows its name
   * and size — where a prop only ever wanted the url.
   */
  record?: boolean
}) {
  const label = field.label ?? field.name.replace(/([A-Z])/g, ' $1').replace(/^\w/, (c) => c.toUpperCase())
  const current = value ?? source
  // A record field has no source value underneath it, so there is nothing to
  // reset to and the override marks would only say "this has a value".
  const overridden = value !== undefined && !record
  const reset = () => onChange(undefined)

  const options = (field.options ?? []).map((option) =>
    typeof option === 'string' ? { value: option, label: option } : option,
  )

  const control = () => {
    switch (field.type) {
      case 'boolean':
        return (
          <Segmented
            value={current === undefined ? undefined : current ? 'on' : 'off'}
            options={[
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ]}
            onChange={(next) => onChange(next === undefined ? undefined : next === 'on')}
          />
        )
      case 'select':
        return options.length <= 3 ? (
          <Segmented
            value={current === undefined ? undefined : String(current)}
            options={options.map((option) => ({ value: option.value, label: option.label }))}
            onChange={(next) => onChange(next)}
          />
        ) : (
          <select
            className="vedit-select"
            value={current === undefined ? '' : String(current)}
            onChange={(event) => onChange(event.target.value || undefined)}
          >
            <option value="">default</option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )
      case 'number':
        return (
          <LengthField
            value={current === undefined ? undefined : String(current)}
            computed={source === undefined ? undefined : String(source)}
            defaultUnit=""
            step={field.step}
            min={field.min}
            onChange={(next) => onChange(next === undefined ? undefined : Number.parseFloat(next))}
          />
        )
      case 'color':
        return (
          <ColorField
            value={typeof current === 'string' ? current : undefined}
            computed={typeof source === 'string' ? source : undefined}
            onChange={(next) => onChange(next)}
          />
        )
      case 'textarea':
        return (
          <textarea
            className="vedit-textarea"
            value={current === undefined ? '' : String(current)}
            onChange={(event) => onChange(event.target.value || undefined)}
          />
        )
      case 'fields':
        return (
          <FieldListEditor
            value={Array.isArray(current) ? (current as FormField[]) : []}
            onChange={(next) => onChange(next.length ? next : undefined)}
          />
        )
      case 'image':
      case 'file':
      case 'video':
        return (
          <AssetPicker
            kind={field.type}
            accept={field.accept}
            value={current}
            placeholder={source === undefined ? undefined : assetUrl(source)}
            onChange={(next) => onChange(next === undefined || record ? next : assetUrl(next))}
          />
        )
      case 'relation':
        return (
          <RelationField
            to={field.to ?? ''}
            many={!!field.many}
            value={current}
            onChange={(next) => onChange(next)}
          />
        )
      case 'richtext':
        return (
          <RichTextField
            value={typeof current === 'string' ? current : ''}
            onChange={(next) => onChange(next)}
          />
        )
      default:
        return (
          <TextField
            value={current === undefined ? '' : String(current)}
            placeholder={source === undefined ? field.type : String(source)}
            overridden={overridden}
            onChange={(next) => onChange(next || undefined)}
          />
        )
    }
  }

  // Controls that take more than one line get their label above them; a row's
  // label sits beside a single control and would leave a textarea hanging. The
  // newer ones also get a way back to the source value, which a row carries as
  // its reset icon.
  const stacked = field.type === 'richtext' || isAssetKind(field.type) || (field.type === 'relation' && !!field.many)

  return (
    <>
      {field.type === 'textarea' || field.type === 'fields' ? (
        <>
          <div className="vedit-label" style={{ width: 'auto', marginBottom: 4 }}>
            {label}
          </div>
          {control()}
        </>
      ) : stacked ? (
        <>
          <div className="vedit-label vedit-label-stacked">
            <span>{label}</span>
            {overridden ? (
              <button type="button" className="vedit-link" onClick={reset}>
                Reset
              </button>
            ) : null}
          </div>
          {control()}
        </>
      ) : (
        <Row label={label} overridden={overridden} onReset={overridden ? reset : undefined}>
          {control()}
        </Row>
      )}
      {field.help ? <div className="vedit-hint" style={{ marginBottom: 6 }}>{field.help}</div> : null}
    </>
  )
}

/* ------------------------------------------------------------------- assets */

/**
 * A url you can type, a file you can upload, or something already stored. The
 * value handed back is a string when it was typed and a `VeditAsset` when it
 * came through the store, so a record can keep the name and size and a prop
 * can take the url. Upload and Library go away for someone who may not upload;
 * the url field stays, because it stores nothing.
 */
export function AssetPicker({
  kind,
  accept,
  value,
  placeholder,
  onChange,
}: {
  kind: AssetKind
  /** MIME types for the file dialog; defaults by kind. */
  accept?: string[]
  value: unknown
  placeholder?: string
  onChange: (next: VeditAsset | string | undefined) => void
}) {
  const store = useVeditStore()
  const canUpload = useVeditState(() => store.can('upload'))
  const fileInput = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [browsing, setBrowsing] = useState(false)

  const url = assetUrl(value)
  const asset = isAsset(value) ? value : null

  return (
    <div className="vedit-asset">
      {kind === 'image' && url ? (
        <div className="vedit-asset-thumb" style={{ backgroundImage: `url("${url.replace(/"/g, '%22')}")` }} />
      ) : null}
      <Row>
        <TextField
          value={url}
          placeholder={placeholder || 'https://…'}
          overridden={value !== undefined}
          onChange={(next) => onChange(next || undefined)}
        />
      </Row>
      {asset && (asset.name || asset.size !== undefined) ? (
        <div className="vedit-file" style={{ marginTop: 6 }}>
          <span className="vedit-file-name" title={asset.url}>
            {asset.name ?? fileNameOf(asset.url)}
          </span>
          {asset.size !== undefined ? <span className="vedit-hint">{formatBytes(asset.size)}</span> : null}
        </div>
      ) : null}
      {canUpload ? (
        <Row>
          <button
            type="button"
            className="vedit-btn"
            style={{ flex: 1, background: 'var(--vedit-panel-2)' }}
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
          >
            {uploading ? 'Uploading…' : 'Upload…'}
          </button>
          {store.canListAssets ? (
            <button
              type="button"
              className="vedit-btn"
              style={{ flex: 1, background: 'var(--vedit-panel-2)' }}
              onClick={() => setBrowsing(!browsing)}
            >
              {browsing ? 'Close library' : 'Library…'}
            </button>
          ) : null}
          <input
            ref={fileInput}
            type="file"
            accept={accept?.length ? accept.join(',') : DEFAULT_ACCEPT[kind]}
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0]
              if (!file) return
              setUploading(true)
              try {
                const uploaded = await store.uploadAsset(file, { kind })
                if (uploaded) onChange(uploaded)
              } finally {
                setUploading(false)
                event.target.value = ''
              }
            }}
          />
        </Row>
      ) : null}
      {browsing ? (
        <AssetLibrary
          kind={kind}
          onPick={(picked) => {
            onChange(picked)
            setBrowsing(false)
          }}
        />
      ) : null}
    </div>
  )
}

/**
 * What the adapter already stores, so you rarely need to upload twice. Images
 * are shown as thumbnails; files and videos by name, since a thumbnail of a
 * PDF says nothing.
 */
export function AssetLibrary({ kind, onPick }: { kind: AssetKind; onPick: (asset: VeditAsset) => void }) {
  const store = useVeditStore()
  const [assets, setAssets] = useState<VeditAsset[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    store
      .listAssets({ kind })
      // An adapter from before there was a filter answers with its whole
      // library, which by its old contract is images — so anything it did not
      // label is sorted by what its url ends in.
      .then((result) => !cancelled && setAssets(result.filter((asset) => kindOfAsset(asset) === kind)))
      .catch((cause) => !cancelled && setError(cause instanceof Error ? cause.message : String(cause)))
    return () => {
      cancelled = true
    }
  }, [store, kind])

  if (error) return <div className="vedit-hint">Could not load the library: {error}</div>
  if (!assets) return <div className="vedit-hint">Loading…</div>
  if (!assets.length) {
    return <div className="vedit-hint">{kind === 'image' ? 'The library is empty.' : `No ${kind}s stored yet.`}</div>
  }

  if (kind === 'image') {
    return (
      <div className="vedit-assets">
        {assets.map((asset) => (
          <button
            key={asset.url}
            type="button"
            title={asset.name ?? asset.url}
            style={{ backgroundImage: `url("${asset.url.replace(/"/g, '%22')}")` }}
            onClick={() => onPick(asset)}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="vedit-files">
      {assets.map((asset) => (
        <button key={asset.url} type="button" title={asset.url} onClick={() => onPick(asset)}>
          <span className="vedit-file-name">{asset.name ?? fileNameOf(asset.url)}</span>
          {asset.size !== undefined ? <span className="vedit-hint">{formatBytes(asset.size)}</span> : null}
        </button>
      ))}
    </div>
  )
}

/** Which library an unlabelled asset belongs in, judged by its url. */
function kindOfAsset(asset: VeditAsset): AssetKind {
  if (asset.kind) return asset.kind
  if (/\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i.test(asset.url)) return 'video'
  return isFileHref(asset.url) ? 'file' : 'image'
}

export function fileNameOf(url: string): string {
  const path = url.split(/[?#]/)[0]
  const last = path.split('/').filter(Boolean).at(-1) ?? ''
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

/* ---------------------------------------------------------------- relation */

/**
 * A record in another source, chosen by name. The rows are fetched once when
 * the control appears; the source's `titleField` from the schema is what each
 * option says, falling back to the id when the schema has not said which.
 */
export function RelationField({
  to,
  many,
  value,
  onChange,
}: {
  to: string
  many: boolean
  value: unknown
  onChange: (next: string | string[] | undefined) => void
}) {
  const store = useVeditStore()
  const schema = useVeditState((state) => state.schema)
  const [rows, setRows] = useState<VeditRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!to) return
    const loads: Promise<unknown>[] = [store.loadRecords(to).then((result) => !cancelled && setRows(result))]
    // The labels come from the schema, which nothing else may have asked for yet.
    if (!store.getState().schema && store.supportsContent) loads.push(store.loadSchema())
    Promise.all(loads).catch((cause) => !cancelled && setError(cause instanceof Error ? cause.message : String(cause)))
    return () => {
      cancelled = true
    }
  }, [store, to])

  const titleField = schema?.find((source) => source.name === to)?.titleField
  const labelOf = (row: VeditRecord) => {
    const title = titleField ? row[titleField] : undefined
    return (typeof title === 'string' && title) || typeof title === 'number' ? String(title) : row.id
  }

  const selected = many
    ? Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string')
      : []
    : typeof value === 'string'
      ? value
      : ''

  // A value pointing at a row that did not come back still has to be shown, or
  // the select would silently display something other than what is stored.
  const known = rows ?? []
  const missing = (Array.isArray(selected) ? selected : selected ? [selected] : []).filter(
    (id) => !known.some((row) => row.id === id),
  )

  if (!to) return <div className="vedit-hint">This relation does not say which source it points into.</div>
  if (error) return <div className="vedit-hint">Could not load {to}: {error}</div>

  const optionsOf = () => (
    <>
      {missing.map((id) => (
        <option key={id} value={id}>
          {id}
        </option>
      ))}
      {known.map((row) => (
        <option key={row.id} value={row.id}>
          {labelOf(row)}
        </option>
      ))}
    </>
  )

  if (many) {
    if (rows && !known.length && !missing.length) {
      return <div className="vedit-hint" style={{ marginBottom: 6 }}>Nothing in {to} to choose from yet.</div>
    }
    return (
      <select
        className="vedit-select vedit-select-multiple"
        multiple
        aria-label={to}
        value={selected as string[]}
        onChange={(event) => {
          const next = Array.from(event.target.selectedOptions, (option) => option.value)
          onChange(next.length ? next : undefined)
        }}
      >
        {optionsOf()}
      </select>
    )
  }

  return (
    <select
      className="vedit-select"
      value={selected as string}
      onChange={(event) => onChange(event.target.value || undefined)}
    >
      <option value="">{rows ? 'none' : 'Loading…'}</option>
      {optionsOf()}
    </select>
  )
}

/* ---------------------------------------------------------------- richtext */

/**
 * HTML with structure, edited as source. Sanitised with the block profile when
 * focus leaves rather than on every keystroke: a half-typed `<scr` would be
 * stripped from under the cursor, and what is stored is what the page renders.
 */
export function RichTextField({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string | undefined) => void
}) {
  const [draft, setDraft] = useState(value)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setDraft(value)
  }, [value])

  return (
    <textarea
      className="vedit-textarea vedit-richtext"
      spellCheck={false}
      value={draft}
      placeholder="<p>Rich text, as HTML</p>"
      onFocus={() => (focused.current = true)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        focused.current = false
        const clean = sanitizeHtml(draft, { profile: 'block' })
        setDraft(clean)
        if (clean !== value) onChange(clean || undefined)
      }}
    />
  )
}

/* ------------------------------------------------------------- form fields */

const FORM_FIELD_TYPES: FormFieldType[] = [
  'text', 'textarea', 'email', 'tel', 'url', 'number', 'checkbox', 'select', 'radio', 'date',
]

/** Rules that mean something for a given control — no `minLength` on a checkbox. */
function rulesFor(type: FormFieldType): FormRule['kind'][] {
  const base: FormRule['kind'][] = ['required']
  if (type === 'checkbox') return base
  if (type === 'number') return [...base, 'min', 'max', 'integer']
  if (type === 'select' || type === 'radio' || type === 'date') return base
  const text: FormRule['kind'][] = [...base, 'minLength', 'maxLength', 'pattern', 'matches']
  if (type === 'email') return [...text, 'email']
  if (type === 'url') return [...text, 'url']
  if (type === 'tel') return [...text, 'tel']
  return text
}

const RULE_LABELS: Record<FormRule['kind'], string> = {
  required: 'Required',
  minLength: 'Min length',
  maxLength: 'Max length',
  min: 'Minimum',
  max: 'Maximum',
  email: 'Valid email',
  url: 'Valid URL',
  tel: 'Valid phone',
  integer: 'Whole number',
  pattern: 'Format',
  matches: 'Matches field',
}

const PATTERN_LABELS: Array<{ value: PatternPreset; label: string }> = [
  { value: 'usZip', label: 'US ZIP code' },
  { value: 'usPhone', label: 'US phone' },
  { value: 'postcodeUk', label: 'UK postcode' },
  { value: 'slug', label: 'Slug' },
  { value: 'hexColor', label: 'Hex colour' },
]

/**
 * Build a form by listing its controls.
 *
 * Validation is picked from a fixed set rather than typed as a pattern. A rule
 * is stored data that runs against every visitor's keystrokes, and an arbitrary
 * regex out of a document is a way to hang their tab — so the choice is a menu,
 * which also means every rule has a control and a name someone can read.
 */
function FieldListEditor({
  value,
  onChange,
}: {
  value: FormField[]
  onChange: (next: FormField[]) => void
}) {
  const [open, setOpen] = useState<number | null>(null)

  const update = (index: number, patch: Partial<FormField>) =>
    onChange(value.map((field, i) => (i === index ? { ...field, ...patch } : field)))

  const move = (index: number, by: number) => {
    const next = [...value]
    const target = index + by
    if (target < 0 || target >= next.length) return
    const moved = next[target]
    next[target] = next[index]
    next[index] = moved
    onChange(next)
  }

  const add = () => {
    onChange([...value, { name: `field${value.length + 1}`, type: 'text', label: 'New field', rules: [] }])
    setOpen(value.length)
  }

  const duplicates = new Set(
    value.map((field) => field.name).filter((name, i, all) => all.indexOf(name) !== i),
  )

  return (
    <div className="vedit-field-list">
      {value.map((field, index) => {
        const expanded = open === index
        const kinds = rulesFor(field.type)
        const rules = field.rules ?? []
        const has = (kind: FormRule['kind']) => rules.some((rule) => rule.kind === kind)

        const toggle = (kind: FormRule['kind']) => {
          if (has(kind)) {
            update(index, { rules: rules.filter((rule) => rule.kind !== kind) })
            return
          }
          let added: FormRule
          if (kind === 'minLength') added = { kind, value: 1 }
          else if (kind === 'maxLength') added = { kind, value: 200 }
          else if (kind === 'min' || kind === 'max') added = { kind, value: 0 }
          else if (kind === 'pattern') added = { kind, preset: 'usZip' }
          else if (kind === 'matches') {
            added = { kind, field: value.find((other) => other.name !== field.name)?.name ?? '' }
          } else added = { kind } as FormRule
          update(index, { rules: [...rules, added] })
        }

        const numeric = (kind: 'minLength' | 'maxLength' | 'min' | 'max') => {
          const rule = rules.find((entry) => entry.kind === kind)
          return rule && 'value' in rule ? String(rule.value) : ''
        }

        const setNumeric = (kind: 'minLength' | 'maxLength' | 'min' | 'max', next: string) => {
          const parsed = Number.parseFloat(next)
          if (Number.isNaN(parsed)) return
          update(index, {
            rules: rules.map((rule) => (rule.kind === kind ? { kind, value: parsed } : rule)),
          })
        }

        return (
          <div key={index} className="vedit-field-item">
            <div className="vedit-field-head">
              <button
                type="button"
                className="vedit-field-toggle"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : index)}
              >
                {field.label || field.name}
                <span className="vedit-hint"> · {field.type}</span>
              </button>
              <button type="button" className="vedit-btn vedit-btn-icon" aria-label={`Move ${field.label || field.name} up`} onClick={() => move(index, -1)}>
                ↑
              </button>
              <button type="button" className="vedit-btn vedit-btn-icon" aria-label={`Move ${field.label || field.name} down`} onClick={() => move(index, 1)}>
                ↓
              </button>
              <button
                type="button"
                className="vedit-btn vedit-btn-icon"
                aria-label={`Remove ${field.label || field.name}`}
                onClick={() => onChange(value.filter((_, i) => i !== index))}
              >
                ×
              </button>
            </div>

            {duplicates.has(field.name) ? (
              <div className="vedit-hint vedit-warn">
                Two fields are named “{field.name}”. They would submit under the same key, and one
                answer would be lost.
              </div>
            ) : null}
            {!field.label ? (
              <div className="vedit-hint vedit-warn">
                No label, so a screen reader announces nothing for this field.
              </div>
            ) : null}

            {expanded ? (
              <div className="vedit-field-body">
                <Row label="Label">
                  <TextField value={field.label ?? ''} onChange={(next) => update(index, { label: next })} />
                </Row>
                <Row label="Name">
                  <TextField value={field.name} onChange={(next) => update(index, { name: next.trim() })} />
                </Row>
                <Row label="Type">
                  <select
                    className="vedit-select"
                    value={field.type}
                    onChange={(event) => {
                      const type = event.target.value as FormFieldType
                      const allowed = rulesFor(type)
                      update(index, {
                        type,
                        rules: rules.filter((rule) => allowed.includes(rule.kind)),
                      })
                    }}
                  >
                    {FORM_FIELD_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </Row>
                <Row label="Placeholder">
                  <TextField
                    value={field.placeholder ?? ''}
                    onChange={(next) => update(index, { placeholder: next || undefined })}
                  />
                </Row>
                <Row label="Help">
                  <TextField
                    value={field.help ?? ''}
                    onChange={(next) => update(index, { help: next || undefined })}
                  />
                </Row>
                <Row label="Autofill">
                  <TextField
                    value={field.autoComplete ?? ''}
                    placeholder={autoCompleteFor(field) ?? 'off'}
                    onChange={(next) => update(index, { autoComplete: next || undefined })}
                  />
                </Row>

                {field.type === 'select' || field.type === 'radio' ? (
                  <Row label="Options">
                    <TextField
                      value={(field.options ?? [])
                        .map((option) => (typeof option === 'string' ? option : option.value))
                        .join(', ')}
                      onChange={(next) =>
                        update(index, {
                          options: next.split(',').map((part) => part.trim()).filter(Boolean),
                        })
                      }
                    />
                  </Row>
                ) : null}

                <div className="vedit-label" style={{ width: 'auto', margin: '8px 0 4px' }}>
                  Validation
                </div>
                {kinds.map((kind) => (
                  <div key={kind}>
                    <Row label={RULE_LABELS[kind]}>
                      <input
                        type="checkbox"
                        checked={has(kind)}
                        aria-label={RULE_LABELS[kind]}
                        onChange={() => toggle(kind)}
                      />
                    </Row>
                    {has(kind) && (kind === 'minLength' || kind === 'maxLength' || kind === 'min' || kind === 'max') ? (
                      <Row label="Value">
                        <TextField value={numeric(kind)} onChange={(next) => setNumeric(kind, next)} />
                      </Row>
                    ) : null}
                    {has(kind) && kind === 'pattern' ? (
                      <Row label="Format">
                        <select
                          className="vedit-select"
                          aria-label="Format"
                          value={
                            (rules.find((rule) => rule.kind === 'pattern') as
                              | { preset: PatternPreset }
                              | undefined)?.preset ?? 'usZip'
                          }
                          onChange={(event) =>
                            update(index, {
                              rules: rules.map((rule) =>
                                rule.kind === 'pattern'
                                  ? { kind: 'pattern', preset: event.target.value as PatternPreset }
                                  : rule,
                              ),
                            })
                          }
                        >
                          {PATTERN_LABELS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </Row>
                    ) : null}
                    {has(kind) && kind === 'matches' ? (
                      <Row label="Field">
                        <select
                          className="vedit-select"
                          aria-label="Field to match"
                          value={
                            (rules.find((rule) => rule.kind === 'matches') as
                              | { field: string }
                              | undefined)?.field ?? ''
                          }
                          onChange={(event) =>
                            update(index, {
                              rules: rules.map((rule) =>
                                rule.kind === 'matches'
                                  ? { kind: 'matches', field: event.target.value }
                                  : rule,
                              ),
                            })
                          }
                        >
                          {value
                            .filter((other) => other.name !== field.name)
                            .map((other) => (
                              <option key={other.name} value={other.name}>
                                {other.label || other.name}
                              </option>
                            ))}
                        </select>
                      </Row>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )
      })}
      <button type="button" className="vedit-btn" style={{ width: '100%' }} onClick={add}>
        Add field
      </button>
    </div>
  )
}
