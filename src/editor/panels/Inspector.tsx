import { useEffect, useRef, useState } from 'react'
import { useVeditNodes, useVeditState, useVeditStore } from '../../core/context'
import {
  STYLE_STATES,
  type EditableField,
  type FormField,
  type FormFieldType,
  type FormRule,
  type NodeKind,
  type PatternPreset,
  type RegisteredNode,
  type StyleMap,
  type StyleState,
  type VeditAsset,
} from '../../core/types'
import { ColorField, LengthField, Row, Section, Segmented, SelectField, Slider, TextField, toHex } from '../controls'
import {
  DEFAULT_GRADIENT,
  gradientPreview,
  parseGradient,
  serializeGradient,
  type Gradient,
} from '../../runtime/gradient'
import { unknownPlaceholders } from '../../runtime/interpolate'
import { parseItemId } from '../../runtime/repeat'
import { parseTransform, withTransform } from '../../runtime/transform'
import { TokenPicker } from './Tokens'
import { useComputedStyle, useContentValue, useSelectedNode, useStyleValue } from '../hooks'
import {
  IconAlignCenter,
  IconAlignJustify,
  IconAlignLeft,
  IconAlignRight,
  IconEye,
  IconEyeOff,
  IconTrash,
  IconUndo,
} from '../icons'
import { BoxSides, ColorRow, LengthRow, SegmentRow, SelectRow } from './rows'
import { dragModeFor, reorderBlocker } from '../interactions'

const FONT_STACKS = [
  { value: 'inherit', label: 'Inherit' },
  { value: 'ui-sans-serif, system-ui, sans-serif', label: 'System sans' },
  { value: 'Georgia, "Times New Roman", serif', label: 'Serif' },
  { value: 'ui-monospace, SFMono-Regular, Menlo, monospace', label: 'Mono' },
  { value: 'Inter, sans-serif', label: 'Inter' },
  { value: '"Helvetica Neue", Helvetica, Arial, sans-serif', label: 'Helvetica' },
]

const WEIGHTS = ['300', '400', '500', '600', '700', '800', '900'].map((w) => ({ value: w, label: w }))

const SHADOWS: Array<{ label: string; value: string }> = [
  { label: 'None', value: 'none' },
  { label: 'S', value: '0 1px 2px rgba(0,0,0,.08)' },
  { label: 'M', value: '0 4px 12px rgba(0,0,0,.10)' },
  { label: 'L', value: '0 12px 32px rgba(0,0,0,.16)' },
  { label: 'XL', value: '0 24px 60px rgba(0,0,0,.20)' },
]

export function Inspector() {
  const store = useVeditStore()
  const { id, node, count } = useSelectedNode()
  const override = useVeditState((state) => (id ? state.doc.nodes[id] : undefined))
  const isInserted = useVeditState((state) => !!id && state.doc.inserted.some((n) => n.id === id))
  // An inserted node always has something to remove; a source element only has
  // something to revert once someone has actually changed it.
  const hasOverride = isInserted || !!(override && Object.keys(override).length > 0)
  const multiple = count > 1

  if (!id) {
    return (
      <aside className="vedit-panel vedit-right" data-vedit-ui="" aria-label="Inspector">
        <div className="vedit-panel-head">Inspector</div>
        <div className="vedit-panel-body">
          <div className="vedit-section vedit-hint">
            Click anything on the page to select it. Double-click text to rewrite it.
            Shift-click to select several at once.
          </div>
        </div>
      </aside>
    )
  }

  const kind: NodeKind = node?.kind ?? store.kindOf(id)

  return (
    <aside className="vedit-panel vedit-right" data-vedit-ui="" aria-label="Inspector">
      <div className="vedit-panel-head">
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            textTransform: 'none',
            letterSpacing: 0,
            color: 'var(--vedit-text)',
          }}
        >
          {multiple ? `${count} elements` : node?.label ?? 'Element'}
        </span>
        <span style={{ display: 'flex', gap: 2 }}>
          <button
            type="button"
            className="vedit-btn vedit-btn-icon"
            title={override?.hidden ? 'Show' : 'Hide'}
            onClick={() => store.updateMany(store.getState().selection, { hidden: !override?.hidden })}
          >
            {override?.hidden ? <IconEyeOff /> : <IconEye />}
          </button>
          {/* Revert and delete are different questions — "put back what the code
              says" versus "take this off the page" — so they get a control each.
              One trash icon meaning both was the trap: on an element that came
              from source code with nothing overridden yet, clicking it reset
              nothing and looked broken. */}
          <button
            type="button"
            className="vedit-btn vedit-btn-icon"
            title={
              hasOverride
                ? 'Revert to what the code says'
                : 'Nothing to revert — this element is unchanged'
            }
            disabled={!hasOverride}
            onClick={() => store.reset(id)}
          >
            <IconUndo />
          </button>
          {/* Same disposition as Delete/Backspace: an element the editor placed
              is removed outright; one that comes from source code is hidden,
              because the code will render it again on the next load either way.
              Unlike the key, this only ever hides — a trash icon that puts the
              element back on a second press would be a strange thing to click.
              The eye beside it is the toggle, and revert brings it back. */}
          <button
            type="button"
            className="vedit-btn vedit-btn-icon"
            title={isInserted ? 'Delete element' : 'Remove from the page'}
            onClick={() =>
              isInserted
                ? store.removeInserted(id)
                : store.updateMany(store.getState().selection, { hidden: true })
            }
          >
            <IconTrash />
          </button>
        </span>
      </div>

      <div className="vedit-panel-body">
        {multiple ? (
          <div className="vedit-section vedit-hint">
            Editing {count} elements. Changes below apply to all of them; values shown are
            from the last one you clicked.
          </div>
        ) : (
          <>
            <Breadcrumb id={id} />
            <RepeatScope id={id} />
            <StateSwitch id={id} />
            <PropsSection id={id} />
            <ContentSection id={id} kind={kind} />
          </>
        )}
        <LayoutSection id={id} />
        {kind !== 'image' ? <TypographySection id={id} /> : null}
        <AppearanceSection id={id} />
        {multiple ? null : <CustomCssSection id={id} />}
        {multiple ? null : (
          <div className="vedit-section vedit-hint" style={{ wordBreak: 'break-all' }}>
            <div style={{ marginBottom: 4 }}>Node id</div>
            <code>{id}</code>
          </div>
        )}
      </div>
    </aside>
  )
}

/**
 * Which interaction state the panels below are editing. Selecting one also forces
 * that state on in the page, so you can style a hover without hovering.
 */
function StateSwitch({ id }: { id: string }) {
  const store = useVeditStore()
  const styleState = useVeditState((state) => state.styleState)
  const node = store.getNode(id)

  useEffect(() => {
    const element = node?.element
    if (!element) return
    if (styleState === 'default') element.removeAttribute('data-vedit-force')
    else element.setAttribute('data-vedit-force', styleState)
    return () => element.removeAttribute('data-vedit-force')
  }, [node, styleState])

  return (
    <div className="vedit-section" style={{ paddingBottom: 10 }}>
      <Row label="State">
        <Segmented
          value={styleState}
          options={STYLE_STATES.map((state) => ({
            value: state,
            label: state === 'default' ? 'Normal' : state[0].toUpperCase() + state.slice(1),
          }))}
          onChange={(next) => store.setStyleState((next ?? 'default') as StyleState)}
        />
      </Row>
      {styleState !== 'default' ? (
        <div className="vedit-hint">
          Changes below apply only while the element is {styleState === 'active' ? 'pressed' : styleState}ed.
          Add a transition under Appearance to make it ease.
        </div>
      ) : null}
    </div>
  )
}

/**
 * Whether an edit inside a repeat lands on every item or just this one.
 *
 * Only shown when the selection is actually inside a repeat, so the ordinary
 * case gains no extra chrome. "All" is the default because bulk-editing the
 * cards is the reason a repeat exists; "This card" is the exception, and when
 * one is set the row below says so rather than leaving a template edit to
 * silently do nothing.
 */
function RepeatScope({ id }: { id: string }) {
  const store = useVeditStore()
  const scope = useVeditState((state) => state.repeatScope)
  const nodes = useVeditNodes()
  const parsed = parseItemId(id)

  const itemOverride = useVeditState((state) => (parsed ? state.doc.nodes[id] : undefined))
  const hasItemEdit = !!itemOverride && Object.keys(itemOverride).length > 0

  if (!parsed) return null

  // Every rendered item of this template, so the label can say how many.
  const count = nodes.filter((node) => parseItemId(node.id)?.templateId === parsed.templateId).length

  return (
    <div className="vedit-section" style={{ paddingBottom: 10 }}>
      <Row label="Applies to">
        <Segmented
          value={scope}
          options={[
            { value: 'all', label: count > 1 ? `All ${count}` : 'All' },
            { value: 'item', label: 'This one' },
          ]}
          onChange={(next) => store.setRepeatScope((next ?? 'all') as 'all' | 'item')}
        />
      </Row>
      {scope === 'all' && hasItemEdit ? (
        <div className="vedit-hint">
          This one has its own edit, which wins over anything set here.{' '}
          <button
            type="button"
            className="vedit-link"
            onClick={() => store.resetRepeatItem(id)}
          >
            Reset it to the template
          </button>
        </div>
      ) : null}
      {scope === 'item' ? (
        <div className="vedit-hint">Changes below apply to this one only.</div>
      ) : null}
    </div>
  )
}

/** The path down to the selection — click a step to select that ancestor (or Esc). */
function Breadcrumb({ id }: { id: string }) {
  const store = useVeditStore()
  const chain: Array<{ id: string; label: string }> = []
  let current: string | null = id
  while (current) {
    const node = store.getNode(current)
    if (!node) break
    chain.unshift({ id: node.id, label: node.label })
    current = node.parentId
  }
  if (chain.length < 2) return null

  return (
    <div className="vedit-breadcrumb">
      {chain.map((entry, index) => (
        <span key={entry.id}>
          {index > 0 ? <span className="vedit-breadcrumb-sep">›</span> : null}
          <button
            type="button"
            data-current={entry.id === id ? 'true' : 'false'}
            onClick={() => store.select(entry.id)}
            onMouseEnter={() => store.hover(entry.id)}
            onMouseLeave={() => store.hover(null)}
          >
            {entry.label}
          </button>
        </span>
      ))}
    </div>
  )
}

/**
 * The props a component declared as editable. This is the one part of the
 * inspector your own code defines: the schema travels with the component, so the
 * editor offers the variants that actually exist instead of guessing.
 */
function PropsSection({ id }: { id: string }) {
  const store = useVeditStore()
  const nodes = useVeditNodes()
  const node = nodes.find((entry) => entry.id === id) ?? store.getNode(id)
  const override = useVeditState((state) => state.doc.nodes[id]?.props)
  const fields = node?.fields
  if (!fields?.length) return null

  return (
    <Section title={node?.kind === 'component' ? 'Component' : 'Properties'}>
      {fields.map((field) => (
        <PropField
          key={field.name}
          field={field}
          value={override?.[field.name]}
          source={node?.props?.[field.name]}
          onChange={(next) => store.setProp(id, field.name, next)}
        />
      ))}
    </Section>
  )
}

function PropField({
  field,
  value,
  source,
  onChange,
}: {
  field: EditableField
  value: unknown
  source: unknown
  onChange: (next: unknown) => void
}) {
  const label = field.label ?? field.name.replace(/([A-Z])/g, ' $1').replace(/^\w/, (c) => c.toUpperCase())
  const current = value ?? source
  const overridden = value !== undefined
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

  return (
    <>
      {field.type === 'textarea' || field.type === 'fields' ? (
        <>
          <div className="vedit-label" style={{ width: 'auto', marginBottom: 4 }}>
            {label}
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

/* ------------------------------------------------------------------ content */

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
  pattern: 'Matches a format',
  matches: 'Matches another field',
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
              <button type="button" className="vedit-icon-btn" aria-label={`Move ${field.label || field.name} up`} onClick={() => move(index, -1)}>
                ↑
              </button>
              <button type="button" className="vedit-icon-btn" aria-label={`Move ${field.label || field.name} down`} onClick={() => move(index, 1)}>
                ↓
              </button>
              <button
                type="button"
                className="vedit-icon-btn"
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

function ContentSection({ id, kind }: { id: string; kind: NodeKind }) {
  const store = useVeditStore()
  const node = store.getNode(id)
  const [text, setText] = useContentValue(id, 'text')
  const [href, setHref] = useContentValue(id, 'href')
  const [target, setTarget] = useContentValue(id, 'target')
  const [src, setSrc] = useContentValue(id, 'src')
  const [alt, setAlt] = useContentValue(id, 'alt')
  const fileInput = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [browsing, setBrowsing] = useState(false)

  if (kind === 'image') {
    // Falls back to whatever the page is rendering, so the preview works before
    // anything has been overridden.
    const current = src ?? node?.element.getAttribute('src') ?? null
    return (
      <Section title="Image">
        <ImagePreview id={id} src={current} />
        <Row label="Source">
          <TextField
            value={src ?? ''}
            placeholder={current ? 'Using the image from your code' : 'https://…'}
            onChange={(next) => setSrc(next || undefined)}
          />
        </Row>
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
            accept="image/*"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0]
              if (!file) return
              setUploading(true)
              try {
                setSrc(await store.uploadImage(file))
              } finally {
                setUploading(false)
                event.target.value = ''
              }
            }}
          />
        </Row>
        {browsing ? <AssetLibrary onPick={(url) => { setSrc(url); setBrowsing(false) }} /> : null}
        <Row label="Alt">
          <TextField value={alt ?? ''} placeholder="Describe the image" onChange={(next) => setAlt(next || undefined)} />
        </Row>
        <SelectRow
          id={id}
          label="Fit"
          property="objectFit"
          options={['cover', 'contain', 'fill', 'none', 'scale-down'].map((v) => ({ value: v, label: v }))}
        />
        <CropRow id={id} />
      </Section>
    )
  }

  const isLinkish = kind === 'link' || kind === 'button'
  if (kind !== 'text' && !isLinkish) return null

  return (
    <Section title="Content">
      <textarea
        className="vedit-textarea"
        aria-label="Copy for this element"
        value={text ?? node?.sourceText ?? ''}
        placeholder="Type the copy for this element"
        onChange={(event) => setText(event.target.value)}
      />
      <VariableHints node={node} value={text ?? node?.sourceText ?? ''} />
      {text !== undefined ? (
        <Row>
          <button type="button" className="vedit-btn" style={{ flex: 1 }} onClick={() => setText(undefined)}>
            Restore original copy
          </button>
        </Row>
      ) : null}
      {isLinkish ? (
        <>
          <Row label="Link">
            <TextField value={href ?? ''} placeholder="https://…" onChange={(next) => setHref(next || undefined)} />
          </Row>
          <Row label="Opens">
            <Segmented
              value={target as string | undefined}
              options={[
                { value: '_self', label: 'Same tab' },
                { value: '_blank', label: 'New tab' },
              ]}
              onChange={(next) => setTarget(next)}
            />
          </Row>
        </>
      ) : null}
    </Section>
  )
}

/**
 * What `{name}` means in this element's copy, and what it currently renders as.
 *
 * Shown only where the host offered values, so most elements are unaffected. The
 * live value is displayed but never written into the document — seeing that
 * `{amount}` is `$250` today is what makes the template legible, while storing
 * `$250` is exactly the staleness this feature exists to avoid.
 *
 * A name the host did not offer renders as literal text, which looks deliberate
 * on the page and is unrecoverable from a screenshot. Calling it out here is the
 * only place a typo like `{amonut}` becomes visible.
 */
function VariableHints({ node, value }: { node: RegisteredNode | undefined; value: string }) {
  const vars = node?.vars
  const unknown = vars ? unknownPlaceholders(value, vars) : []
  const names = vars ? Object.keys(vars) : []
  if (!names.length && !unknown.length) return null

  return (
    <>
      {names.length ? (
        <div className="vedit-section vedit-hint" style={{ paddingTop: 6 }}>
          Values you can use: {names.map((name) => `{${name}}`).join(', ')}. They are
          filled in when the page renders, so the current number is never saved.
        </div>
      ) : null}
      {unknown.length ? (
        <div
          className="vedit-section vedit-hint"
          style={{ paddingTop: 6, color: 'var(--vedit-danger, #f24822)' }}
        >
          {unknown.map((name) => `{${name}}`).join(', ')}{' '}
          {unknown.length === 1 ? 'is not a value here' : 'are not values here'} — it will
          show on the page exactly as written.
        </div>
      ) : null}
    </>
  )
}

/**
 * The image, with its focal point draggable on top. When an image is cropped by
 * `object-fit: cover`, this is the only control that decides what survives the
 * crop — so it is worth being able to point at it rather than type percentages.
 */
function ImagePreview({ id, src }: { id: string; src: string | null }) {
  const position = useStyleValue(id, 'objectPosition')
  const fit = useStyleValue(id, 'objectFit')
  const effectiveFit = (fit.value as string | undefined) ?? fit.computed
  const focal = parsePosition(typeof position.value === 'string' ? position.value : position.computed)
  const cover = effectiveFit === 'cover' || effectiveFit === 'none'

  if (!src) return null

  const setFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = Math.round(Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100)))
    const y = Math.round(Math.min(100, Math.max(0, ((event.clientY - rect.top) / rect.height) * 100)))
    position.set(`${x}% ${y}%`)
  }

  return (
    <>
      <div
        className="vedit-image-preview"
        style={{ backgroundImage: `url("${src.replace(/"/g, '%22')}")` }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          setFromPointer(event)
        }}
        onPointerMove={(event) => {
          if (event.buttons === 1) setFromPointer(event)
        }}
        title="Drag to set the focal point"
      >
        <span className="vedit-focal" style={{ left: `${focal.x}%`, top: `${focal.y}%` }} />
      </div>
      <div className="vedit-hint" style={{ marginBottom: 6 }}>
        {cover
          ? `Focal point ${focal.x}% ${focal.y}% — the part kept when the image is cropped.`
          : 'Set Fit to cover for the focal point to have an effect.'}
      </div>
    </>
  )
}

function parsePosition(value: string | undefined): { x: number; y: number } {
  const parts = (value ?? '50% 50%').trim().split(/\s+/)
  const toPercent = (part: string | undefined, fallback: number) => {
    if (!part) return fallback
    if (part.endsWith('%')) return Number.parseFloat(part)
    const keywords: Record<string, number> = { left: 0, top: 0, center: 50, right: 100, bottom: 100 }
    return keywords[part] ?? fallback
  }
  return { x: toPercent(parts[0], 50), y: toPercent(parts[1] ?? parts[0], 50) }
}

/** Crop by aspect ratio — the shape of the frame, with `cover` filling it. */
function CropRow({ id }: { id: string }) {
  const store = useVeditStore()
  const ratio = useStyleValue(id, 'aspectRatio')
  const presets = [
    { label: 'Auto', value: undefined },
    { label: '1:1', value: '1 / 1' },
    { label: '4:3', value: '4 / 3' },
    { label: '16:9', value: '16 / 9' },
    { label: '3:4', value: '3 / 4' },
  ]

  return (
    <Row label="Crop" overridden={ratio.overridden} onReset={ratio.clear}>
      <div className="vedit-segmented">
        {presets.map((preset) => (
          <button
            key={preset.label}
            type="button"
            data-active={(ratio.value ?? undefined) === preset.value ? 'true' : 'false'}
            onClick={() => {
              if (!preset.value) return store.clearStyles(id, ['aspectRatio'])
              // A ratio only crops if the image is told to fill the box.
              store.setStyle(id, { aspectRatio: preset.value, objectFit: 'cover' })
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </Row>
  )
}

/** Images the adapter already knows about, so you rarely need to upload twice. */
function AssetLibrary({ onPick }: { onPick: (url: string) => void }) {
  const store = useVeditStore()
  const [assets, setAssets] = useState<VeditAsset[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    store
      .listAssets()
      .then((result) => !cancelled && setAssets(result))
      .catch((cause) => !cancelled && setError(cause instanceof Error ? cause.message : String(cause)))
    return () => {
      cancelled = true
    }
  }, [store])

  if (error) return <div className="vedit-hint">Could not load the library: {error}</div>
  if (!assets) return <div className="vedit-hint">Loading…</div>
  if (!assets.length) return <div className="vedit-hint">The library is empty.</div>

  return (
    <div className="vedit-assets">
      {assets.map((asset) => (
        <button
          key={asset.url}
          type="button"
          title={asset.name ?? asset.url}
          style={{ backgroundImage: `url("${asset.url.replace(/"/g, '%22')}")` }}
          onClick={() => onPick(asset.url)}
        />
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------- layout */

function LayoutSection({ id }: { id: string }) {
  const display = useStyleValue(id, 'display')
  const computed = useComputedStyle(id)
  const effectiveDisplay = (display.value as string | undefined) ?? computed?.display ?? ''
  const isFlex = effectiveDisplay.includes('flex')
  const isGrid = effectiveDisplay.includes('grid')

  return (
    <Section title="Layout">
      <PositionControl id={id} />
      <SelectRow
        id={id}
        label="Display"
        property="display"
        options={['block', 'inline-block', 'flex', 'inline-flex', 'grid', 'inline', 'none'].map((v) => ({
          value: v,
          label: v,
        }))}
      />
      {isFlex ? (
        <>
          <SegmentRow
            id={id}
            label="Direction"
            property="flexDirection"
            options={[
              { value: 'row', label: '→', title: 'Row' },
              { value: 'column', label: '↓', title: 'Column' },
              { value: 'row-reverse', label: '←', title: 'Row reverse' },
              { value: 'column-reverse', label: '↑', title: 'Column reverse' },
            ]}
          />
          <SelectRow
            id={id}
            label="Justify"
            property="justifyContent"
            options={['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'].map(
              (v) => ({ value: v, label: v }),
            )}
          />
          <SelectRow
            id={id}
            label="Align"
            property="alignItems"
            options={['stretch', 'flex-start', 'center', 'flex-end', 'baseline'].map((v) => ({ value: v, label: v }))}
          />
          <SelectRow
            id={id}
            label="Wrap"
            property="flexWrap"
            options={['nowrap', 'wrap', 'wrap-reverse'].map((v) => ({ value: v, label: v }))}
          />
        </>
      ) : null}
      {isGrid ? <LengthRow id={id} label="Columns" property="gridTemplateColumns" /> : null}
      {isFlex || isGrid ? <LengthRow id={id} label="Gap" property="gap" min={0} /> : null}
      <div className="vedit-grid2" style={{ marginBottom: 6 }}>
        <SizeField id={id} property="width" label="W" />
        <SizeField id={id} property="height" label="H" />
        <SizeField id={id} property="minWidth" label="min W" />
        <SizeField id={id} property="maxWidth" label="max W" />
      </div>
      <BoxSides id={id} prefix="padding" label="Padding" />
      <BoxSides id={id} prefix="margin" label="Margin" />
    </Section>
  )
}

function SizeField({ id, property, label }: { id: string; property: string; label: string }) {
  const style = useStyleValue(id, property)
  const unitless = property === 'lineHeight' || property === 'opacity'
  return (
    <LengthField
      label={label}
      // These sit in a bare grid rather than a labelled row, and their labels are
      // abbreviations, so the property name is the only thing worth announcing.
      name={spokenName(property)}
      value={style.value}
      computed={style.computed}
      onChange={style.set}
      defaultUnit={unitless ? '' : 'px'}
    />
  )
}

/** `minWidth` -> "min width": a property name as it would be read out. */
function spokenName(property: string): string {
  return property.replace(/([A-Z])/g, ' $1').toLowerCase()
}

/**
 * How this element sits in the page, and therefore what dragging it does. Being
 * explicit here matters: a free-moving element is a real layout decision, not a
 * side effect of having dragged something.
 */
function PositionControl({ id }: { id: string }) {
  const store = useVeditStore()
  // Subscribes this control to the node, so the reads below re-run on every
  // change to it. `styleValue` reads the store directly and would not on its own.
  useVeditState((state) => state.doc.nodes[id])
  const node = store.getNode(id)
  // Read from the same cell `setStyle` writes to. Reading the base bucket while
  // the write lands in `responsive.lg` leaves this showing "In flow" for an
  // element that is genuinely positioned.
  const free = store.styleValue(id, 'position') === 'absolute'
  const offset = String(store.styleValue(id, 'transform') ?? '')
  const moved = parseTransform(offset)
  const nudged = moved.translateX !== 0 || moved.translateY !== 0
  const mode = node ? dragModeFor(store, id, node.element) : 'nudge'
  const blocker = node ? reorderBlocker(node.element) : 'not-flex'
  const parent = node?.element.parentElement

  const setFree = (next: boolean) => {
    const element = node?.element
    if (!next) {
      store.clearStyles(id, ['position', 'left', 'top', 'transform'])
      return
    }
    if (!element) return
    // Seed the current geometry so detaching it doesn't make it jump.
    const rect = element.getBoundingClientRect()
    store.clearStyles(id, ['transform'])
    store.setStyle(id, {
      position: 'absolute',
      left: `${Math.round(element.offsetLeft)}px`,
      top: `${Math.round(element.offsetTop)}px`,
      width: `${Math.round(rect.width)}px`,
    })
  }

  const explanation = free
    ? 'Dragging moves it freely, positioned against its nearest positioned ancestor.'
    : mode === 'reorder'
      ? 'Dragging re-orders it among its siblings for real.'
      : blocker === 'only-child'
        ? 'Dragging nudges it visually — it has no siblings to swap with.'
        : blocker === 'missing-ids'
          ? "Dragging nudges it visually — some of its siblings aren't registered, so ordering them all isn't possible."
          : "Dragging nudges it visually — its parent lays out as a block, and CSS can't re-order block children."

  // The one-click fix for the common case: a stack of divs that would re-order
  // happily if the parent were a flex column.
  const parentId = parent?.getAttribute('data-vedit-id')
  const offerFlex = !free && blocker === 'not-flex' && !!parentId

  return (
    <>
      <Row label="Position">
        <Segmented
          value={free ? 'free' : 'flow'}
          options={[
            { value: 'flow', label: 'In flow' },
            { value: 'free', label: 'Free' },
          ]}
          onChange={(next) => setFree(next === 'free')}
        />
      </Row>
      {free ? (
        <div className="vedit-grid2" style={{ marginBottom: 6 }}>
          <SizeField id={id} property="left" label="X" />
          <SizeField id={id} property="top" label="Y" />
        </div>
      ) : null}
      {nudged ? (
        <Row label="Offset">
          <span className="vedit-hint" style={{ flex: 1 }}>
            {Math.round(moved.translateX)}, {Math.round(moved.translateY)}
          </span>
          <button
            type="button"
            className="vedit-btn"
            style={{ height: 22 }}
            onClick={() => {
              const kept = withTransform(offset, { translateX: 0, translateY: 0 })
              if (kept) store.setStyle(id, { transform: kept })
              else store.clearStyles(id, ['transform'])
            }}
          >
            Reset
          </button>
        </Row>
      ) : null}
      <div className="vedit-hint" style={{ marginBottom: offerFlex ? 6 : 8 }}>{explanation}</div>
      {offerFlex ? (
        <Row>
          <button
            type="button"
            className="vedit-btn"
            style={{ flex: 1 }}
            title="Sets display:flex and flex-direction:column on the parent"
            onClick={() => {
              store.setStyleMany([[parentId!, { display: 'flex', flexDirection: 'column' }]])
              store.notify('Parent is now a flex column — dragging re-orders')
            }}
          >
            Make the parent a flex column
          </button>
        </Row>
      ) : null}
      <InsertedActions id={id} />
    </>
  )
}

/** Duplicate, re-parent and delete — available for elements the editor created. */
function InsertedActions({ id }: { id: string }) {
  const store = useVeditStore()
  const nodes = useVeditNodes()
  const inserted = useVeditState((state) => state.doc.inserted.find((node) => node.id === id))
  const siblingCount = useVeditState(
    (state) => state.doc.inserted.filter((node) => node.parentId === inserted?.parentId).length,
  )
  if (!inserted) return null

  const containers = nodes.filter((node) => node.container && !node.auto)

  return (
    <>
      <Row label="Parent">
        <select
          className="vedit-select"
          aria-label="Parent container"
          value={inserted.parentId}
          onChange={(event) => store.moveInserted(id, event.target.value)}
        >
          {containers.map((node) => (
            <option key={node.id} value={node.id}>
              {node.label}
            </option>
          ))}
          {containers.some((node) => node.id === inserted.parentId) ? null : (
            <option value={inserted.parentId}>{inserted.parentId}</option>
          )}
        </select>
      </Row>
      <Row label="Order">
        <button
          type="button"
          className="vedit-btn"
          style={{ flex: 1 }}
          aria-label="Move earlier"
          disabled={inserted.index === 0}
          onClick={() => store.nudgeOrder(id, -1)}
        >
          Move up
        </button>
        <button
          type="button"
          className="vedit-btn"
          style={{ flex: 1 }}
          aria-label="Move later"
          disabled={inserted.index >= siblingCount - 1}
          onClick={() => store.nudgeOrder(id, 1)}
        >
          Move down
        </button>
      </Row>
      <Row>
        <button
          type="button"
          className="vedit-btn"
          style={{ flex: 1 }}
          onClick={() => store.duplicateInserted(id)}
        >
          Duplicate
        </button>
        <button type="button" className="vedit-btn" style={{ flex: 1 }} onClick={() => store.removeInserted(id)}>
          Delete
        </button>
      </Row>
    </>
  )
}

/* --------------------------------------------------------------- typography */

function TypographySection({ id }: { id: string }) {
  const family = useStyleValue(id, 'fontFamily')
  return (
    <Section title="Typography">
      <Row label="Font" overridden={family.overridden} onReset={family.clear}>
        <SelectField
          value={family.value}
          computed={family.computed}
          options={FONT_STACKS}
          onChange={family.set}
        />
      </Row>
      <div className="vedit-grid2" style={{ marginBottom: 6 }}>
        <SizeField id={id} property="fontSize" label="Size" />
        <WeightField id={id} />
        <SizeField id={id} property="lineHeight" label="Line" />
        <SizeField id={id} property="letterSpacing" label="Space" />
      </div>
      <SegmentRow
        id={id}
        label="Align"
        property="textAlign"
        options={[
          { value: 'left', label: <IconAlignLeft width={12} height={12} />, title: 'Left' },
          { value: 'center', label: <IconAlignCenter width={12} height={12} />, title: 'Center' },
          { value: 'right', label: <IconAlignRight width={12} height={12} />, title: 'Right' },
          { value: 'justify', label: <IconAlignJustify width={12} height={12} />, title: 'Justify' },
        ]}
      />
      <ColorRow id={id} label="Color" property="color" />
      <SelectRow
        id={id}
        label="Transform"
        property="textTransform"
        options={['none', 'uppercase', 'lowercase', 'capitalize'].map((v) => ({ value: v, label: v }))}
      />
      <SelectRow
        id={id}
        label="Decoration"
        property="textDecoration"
        options={['none', 'underline', 'line-through'].map((v) => ({ value: v, label: v }))}
      />
    </Section>
  )
}

function WeightField({ id }: { id: string }) {
  const weight = useStyleValue(id, 'fontWeight')
  return (
    <SelectField
      name="Font weight"
      value={weight.value}
      computed={weight.computed}
      options={WEIGHTS}
      onChange={weight.set}
    />
  )
}

/* --------------------------------------------------------------- appearance */

function AppearanceSection({ id }: { id: string }) {
  const opacity = useStyleValue(id, 'opacity')
  const shadow = useStyleValue(id, 'boxShadow')
  return (
    <Section title="Appearance">
      <FillControl id={id} />
      <LengthRow id={id} label="Radius" property="borderRadius" min={0} />
      <LengthRow id={id} label="Border" property="borderWidth" min={0} />
      <ColorRow id={id} label="Stroke" property="borderColor" />
      <SelectRow
        id={id}
        label="Style"
        property="borderStyle"
        options={['solid', 'dashed', 'dotted', 'none'].map((v) => ({ value: v, label: v }))}
      />
      <Row label="Opacity" overridden={opacity.overridden} onReset={opacity.clear}>
        <Slider value={opacity.value} fallback={Number(opacity.computed || 1)} onChange={opacity.set} />
      </Row>
      <Row label="Shadow" overridden={shadow.overridden} onReset={shadow.clear}>
        <div className="vedit-segmented">
          {SHADOWS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              data-active={shadow.value === preset.value ? 'true' : 'false'}
              onClick={() => shadow.set(preset.value)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <TokenPicker kind="shadow" value={shadow.value} onChange={shadow.set} />
      </Row>
      <TransformRows id={id} />
      <TransitionRow id={id} />
    </Section>
  )
}

/** Solid colour or a gradient, with the stops editable in place. */
function FillControl({ id }: { id: string }) {
  const store = useVeditStore()
  const image = useStyleValue(id, 'backgroundImage')
  const color = useStyleValue(id, 'backgroundColor')
  const gradient = parseGradient(image.value)
  const mode = gradient?.type ?? 'solid'

  const setGradient = (next: Gradient) => store.setStyle(id, { backgroundImage: serializeGradient(next) })

  const setMode = (next: string | undefined) => {
    if (!next || next === 'solid') {
      store.clearStyles(id, ['backgroundImage'])
      return
    }
    setGradient({ ...(gradient ?? DEFAULT_GRADIENT), type: next as Gradient['type'] })
  }

  return (
    <>
      <Row label="Fill">
        <Segmented
          value={mode}
          options={[
            { value: 'solid', label: 'Solid' },
            { value: 'linear', label: 'Linear' },
            { value: 'radial', label: 'Radial' },
          ]}
          onChange={setMode}
        />
      </Row>
      {gradient ? (
        <>
          <div
            style={{
              height: 22,
              borderRadius: 5,
              marginBottom: 6,
              border: '1px solid var(--vedit-border)',
              background: gradientPreview(gradient),
            }}
          />
          {gradient.type === 'linear' ? (
            <Row label="Angle">
              <LengthField
                value={`${gradient.angle}deg`}
                onChange={(next) => setGradient({ ...gradient, angle: Number.parseFloat(next ?? '0') || 0 })}
                defaultUnit="deg"
              />
            </Row>
          ) : null}
          {gradient.stops.map((stop, index) => (
            <Row key={index}>
              <span className="vedit-swatch">
                <span style={{ background: stop.color }} />
                <input
                  type="color"
                  value={toHex(stop.color)}
                  aria-label={`Stop ${index + 1} colour`}
                  onChange={(event) => {
                    const stops = [...gradient.stops]
                    stops[index] = { ...stop, color: event.target.value }
                    setGradient({ ...gradient, stops })
                  }}
                />
              </span>
              <TextField
                value={stop.color}
                onChange={(next) => {
                  const stops = [...gradient.stops]
                  stops[index] = { ...stop, color: next }
                  setGradient({ ...gradient, stops })
                }}
              />
              <LengthField
                value={`${Math.round(stop.position)}%`}
                defaultUnit="%"
                onChange={(next) => {
                  const stops = [...gradient.stops]
                  stops[index] = { ...stop, position: Number.parseFloat(next ?? '0') || 0 }
                  setGradient({ ...gradient, stops })
                }}
              />
              <button
                type="button"
                className="vedit-btn vedit-btn-icon"
                title="Remove stop"
                disabled={gradient.stops.length <= 2}
                onClick={() =>
                  setGradient({ ...gradient, stops: gradient.stops.filter((_, i) => i !== index) })
                }
              >
                <IconTrash width={12} height={12} />
              </button>
            </Row>
          ))}
          <Row>
            <button
              type="button"
              className="vedit-btn"
              style={{ flex: 1 }}
              onClick={() =>
                setGradient({
                  ...gradient,
                  stops: [...gradient.stops, { color: '#ffffff', position: 50 }],
                })
              }
            >
              Add stop
            </button>
          </Row>
        </>
      ) : (
        <Row label="Color" overridden={color.overridden} onReset={color.clear}>
          <ColorField value={color.value} computed={color.computed} onChange={color.set} />
          <TokenPicker kind="color" value={color.value} onChange={color.set} />
        </Row>
      )}
    </>
  )
}

/** Rotation and scale. Translation belongs to Position, where dragging writes it. */
function TransformRows({ id }: { id: string }) {
  const store = useVeditStore()
  const transform = useStyleValue(id, 'transform')
  const parts = parseTransform(transform.value)

  const write = (patch: Partial<typeof parts>) => {
    const next = withTransform(transform.value, patch)
    if (next) store.setStyle(id, { transform: next })
    else store.clearStyles(id, ['transform'])
  }

  return (
    <div className="vedit-grid2" style={{ marginBottom: 6 }}>
      <LengthField
        label="Rotate"
        value={parts.rotate ? `${parts.rotate}deg` : undefined}
        computed="0deg"
        defaultUnit="deg"
        onChange={(next) => write({ rotate: Number.parseFloat(next ?? '0') || 0 })}
      />
      <LengthField
        label="Scale"
        value={parts.scaleX !== 1 ? String(parts.scaleX) : undefined}
        computed="1"
        defaultUnit=""
        step={0.05}
        onChange={(next) => {
          const scale = Number.parseFloat(next ?? '1') || 1
          write({ scaleX: scale, scaleY: scale })
        }}
      />
    </div>
  )
}

/** One transition covering everything, which is what an editor-made change needs. */
function TransitionRow({ id }: { id: string }) {
  const store = useVeditStore()
  const transition = useStyleValue(id, 'transition')
  const match = /^all\s+([\d.]+)m?s\s+(.+)$/.exec(String(transition.value ?? ''))
  const duration = match ? Number(match[1]) : 0
  const easing = match ? match[2] : 'ease'

  const write = (nextDuration: number, nextEasing: string) => {
    if (!nextDuration) return store.clearStyles(id, ['transition'])
    store.setStyle(id, { transition: `all ${nextDuration}ms ${nextEasing}` })
  }

  return (
    <Row label="Transition" overridden={transition.overridden} onReset={transition.clear}>
      <LengthField
        label="ms"
        value={duration ? String(duration) : undefined}
        computed="0"
        defaultUnit=""
        step={25}
        min={0}
        onChange={(next) => write(Number.parseFloat(next ?? '0') || 0, easing)}
      />
      <select
        className="vedit-select"
        aria-label="Transition easing"
        value={easing}
        onChange={(event) => write(duration || 200, event.target.value)}
      >
        {['ease', 'ease-in', 'ease-out', 'ease-in-out', 'linear', 'cubic-bezier(.2,.8,.2,1)'].map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
    </Row>
  )
}

/* --------------------------------------------------------------- custom css */

function CustomCssSection({ id }: { id: string }) {
  const store = useVeditStore()
  const breakpoint = useVeditState((state) => state.breakpoint)
  const override = useVeditState((state) => state.doc.nodes[id])
  const bucket = (breakpoint === 'base' ? override?.style : override?.responsive?.[breakpoint]) ?? {}
  const [draft, setDraft] = useState<string | null>(null)
  const serialized = Object.entries(bucket)
    .map(([property, value]) => `${property}: ${value};`)
    .join('\n')

  return (
    <Section title="Custom CSS" defaultOpen={false}>
      <div className="vedit-hint" style={{ marginBottom: 6 }}>
        Anything the panels above don't cover. One declaration per line.
      </div>
      <textarea
        className="vedit-textarea"
        spellCheck={false}
        value={draft ?? serialized}
        placeholder={'box-shadow: 0 2px 6px #0002;\nbackdrop-filter: blur(4px);'}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== null) store.setStyleBucket(id, parseDeclarations(draft))
          setDraft(null)
        }}
      />
    </Section>
  )
}

function parseDeclarations(source: string): StyleMap {
  const styles: StyleMap = {}
  for (const line of source.split(/[\n;]+/)) {
    const index = line.indexOf(':')
    if (index < 1) continue
    const property = line.slice(0, index).trim()
    const value = line.slice(index + 1).trim()
    if (property && value) styles[property] = value
  }
  return styles
}
