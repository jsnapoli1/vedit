import { useEffect, useRef, useState } from 'react'
import { useVeditState, useVeditStore } from '../../core/context'
import type { EditableField } from '../../core/types'
import type { SourceField, SourceSchema, VeditRecord } from '../../content/types'
import { isTempId } from '../../content/ids'
import { Row } from '../controls'
import { moveFocus } from '../focus'
import { IconPlus, IconTrash } from '../icons'
import { PropField } from './fields'

/**
 * The site's records, edited away from the page: a list of sources, the rows
 * in one, and a form for one row. Every edit goes through the store's record
 * methods, so it is one undo step like anything else and the toolbar's Save
 * and Publish carry it to the server with the document.
 */

const GLOBAL_ID = 'global'

export function DataPanel() {
  const store = useVeditStore()
  const schema = useVeditState((state) => state.schema)
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<string | null>(null)
  const [row, setRow] = useState<string | null>(null)

  // The schema is fetched once for the whole editor; whichever panel asks first
  // pays for it. A relation field in the inspector may already have.
  useEffect(() => {
    if (!store.supportsContent || store.getState().schema) return
    let cancelled = false
    store.loadSchema().catch((cause) => !cancelled && setError(cause instanceof Error ? cause.message : String(cause)))
    return () => {
      cancelled = true
    }
  }, [store])

  const current = schema?.find((candidate) => candidate.name === source)
  // The trail names the open row the way the list did, and follows its title
  // as it is typed.
  useVeditState((state) => state.data)
  useVeditState((state) => (source ? state.records[source] : undefined))
  const open = current && row !== null ? store.recordsFor(current.name).find((candidate) => candidate.id === row) : undefined

  if (error) {
    return (
      <div className="vedit-panel-body">
        <div className="vedit-section vedit-hint">Could not load the sources: {error}</div>
      </div>
    )
  }
  if (!schema) {
    return (
      <div className="vedit-panel-body">
        <div className="vedit-section vedit-hint">Loading…</div>
      </div>
    )
  }

  if (!current) {
    return (
      <SourceList
        sources={schema}
        onPick={(name) => {
          setSource(name)
          setRow(null)
        }}
      />
    )
  }

  const back = () => {
    setSource(null)
    setRow(null)
  }

  // A global is one record; there is no list to pick it from.
  if (current.kind === 'global') {
    return (
      <>
        <Crumbs trail={[{ label: 'Sources', onClick: back }, { label: current.label }]} />
        <RecordForm key={current.name} schema={current} id={GLOBAL_ID} onGone={back} />
      </>
    )
  }

  if (row === null) {
    return (
      <>
        <Crumbs trail={[{ label: 'Sources', onClick: back }, { label: current.label }]} />
        <RowList key={current.name} schema={current} onPick={setRow} />
      </>
    )
  }

  return (
    <>
      <Crumbs
        trail={[
          { label: 'Sources', onClick: back },
          { label: current.label, onClick: () => setRow(null) },
          { label: open ? titleOf(open, current) : row },
        ]}
      />
      <RecordForm key={`${current.name}/${row}`} schema={current} id={row} onGone={() => setRow(null)} />
    </>
  )
}

/* ---------------------------------------------------------------- crumbs */

/** Where you are, and the way back. The last crumb is the place itself. */
function Crumbs({ trail }: { trail: Array<{ label: string; onClick?: () => void }> }) {
  return (
    <nav className="vedit-breadcrumb vedit-data-crumbs" aria-label="Data">
      {trail.map((crumb, index) => (
        <span key={index} style={{ display: 'contents' }}>
          {index ? <span className="vedit-breadcrumb-sep">›</span> : null}
          <button
            type="button"
            data-current={crumb.onClick ? 'false' : 'true'}
            disabled={!crumb.onClick}
            onClick={crumb.onClick}
            title={crumb.label}
          >
            {crumb.label}
          </button>
        </span>
      ))}
    </nav>
  )
}

/* --------------------------------------------------------------- sources */

function SourceList({ sources, onPick }: { sources: SourceSchema[]; onPick: (name: string) => void }) {
  const body = useRef<HTMLDivElement>(null)
  const options = () => [...(body.current?.querySelectorAll<HTMLElement>('.vedit-data-item') ?? [])]

  // The users table is the auth layer's; it is a source like any other, just
  // one whose password field is the point.
  const readable = sources.filter((source) => source.can.read)
  // Sources a site marks `hidden` — import tables, counters, lookups — sit
  // behind "Advanced", so the list people open every day is the content.
  const visible = readable.filter((source) => !source.hidden)
  const advanced = readable.filter((source) => source.hidden)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const listed = showAdvanced ? [...visible, ...advanced] : visible

  return (
    <div className="vedit-panel-body" ref={body}>
      {readable.length ? (
        <div role="listbox" aria-label="Sources" className="vedit-data-list">
          {listed.map((source, index) => (
            <button
              key={source.name}
              type="button"
              role="option"
              aria-selected={false}
              className="vedit-data-item"
              // One tab stop for the list; arrows move inside it.
              tabIndex={index === 0 ? 0 : -1}
              onKeyDown={(event) => moveFocus(event, options())}
              onClick={() => onPick(source.name)}
            >
              <span className="vedit-data-item-name">{source.label}</span>
              <span className="vedit-data-kind">{source.hidden ? 'advanced' : source.kind === 'global' ? 'global' : 'collection'}</span>
            </button>
          ))}
          {advanced.length ? (
            <button
              type="button"
              className="vedit-btn vedit-data-advanced"
              aria-expanded={showAdvanced}
              onClick={() => setShowAdvanced((open) => !open)}
            >
              {showAdvanced ? 'Hide advanced' : `Advanced (${advanced.length})`}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="vedit-section vedit-hint">
          This site has no sources yet. Declare some with <code>defineCollections</code> and pass
          the client to the provider.
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ rows */

function RowList({ schema, onPick }: { schema: SourceSchema; onPick: (id: string) => void }) {
  const store = useVeditStore()
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const body = useRef<HTMLDivElement>(null)
  const canCreate = useVeditState(() => store.can('data:write')) && schema.can.create

  // The overlay is read from the store, so an undo of a New or a Delete shows
  // here without another fetch.
  useVeditState((state) => state.data)
  useVeditState((state) => state.records[schema.name])
  const rows = store.recordsFor(schema.name)

  useEffect(() => {
    let cancelled = false
    store
      .loadRecords(schema.name)
      .then(() => !cancelled && setLoaded(true))
      .catch((cause) => !cancelled && setError(cause instanceof Error ? cause.message : String(cause)))
    return () => {
      cancelled = true
    }
  }, [store, schema.name])

  const options = () => [...(body.current?.querySelectorAll<HTMLElement>('.vedit-data-row') ?? [])]

  const create = () => {
    // The server fills in each field's default on commit; the schema an editor
    // sees does not carry them.
    onPick(store.createRecord(schema.name))
  }

  return (
    <div className="vedit-panel-body" ref={body}>
      <div className="vedit-data-toolbar">
        <span className="vedit-hint">
          {loaded ? `${rows.length} ${rows.length === 1 ? 'record' : 'records'}` : error ? 'Not loaded' : 'Loading…'}
        </span>
        {canCreate ? (
          <button type="button" className="vedit-btn" onClick={create}>
            <IconPlus width={12} height={12} />
            New
          </button>
        ) : null}
      </div>
      {error ? <div className="vedit-section vedit-hint">Could not load {schema.label}: {error}</div> : null}
      {rows.length ? (
        <div role="listbox" aria-label={`${schema.label} records`} className="vedit-data-list">
          <div className="vedit-data-row vedit-data-head" aria-hidden="true">
            <span>Title</span>
            <span>Status</span>
            <span>Updated</span>
          </div>
          {rows.map((row, index) => (
            <RecordRow
              key={row.id}
              row={row}
              schema={schema}
              first={index === 0}
              onKeyDown={(event) => moveFocus(event, options())}
              onClick={() => onPick(row.id)}
            />
          ))}
        </div>
      ) : loaded && !error ? (
        <div className="vedit-section vedit-hint">
          Nothing in {schema.label} yet.{canCreate ? ' New adds the first record.' : ''}
        </div>
      ) : null}
    </div>
  )
}

function RecordRow({
  row,
  schema,
  first,
  onKeyDown,
  onClick,
}: {
  row: VeditRecord
  schema: SourceSchema
  first: boolean
  onKeyDown: (event: React.KeyboardEvent) => void
  onClick: () => void
}) {
  const edited = useVeditState((state) => !!state.data[schema.name]?.update?.[row.id])
  const status = isTempId(row.id) ? 'new' : typeof row._status === 'string' ? row._status : ''
  return (
    <button
      type="button"
      role="option"
      aria-selected={false}
      className="vedit-data-row"
      tabIndex={first ? 0 : -1}
      onKeyDown={onKeyDown}
      onClick={onClick}
    >
      <span className="vedit-data-title" title={row.id}>
        {titleOf(row, schema)}
        {edited ? (
          <span title="Edited" style={{ color: 'var(--vedit-accent)' }}>
            {' '}•
          </span>
        ) : null}
      </span>
      <span className="vedit-data-status" data-status={status}>
        {status}
      </span>
      <span className="vedit-data-updated">{formatWhen(row._updatedAt)}</span>
    </button>
  )
}

function titleOf(row: VeditRecord, schema: SourceSchema): string {
  const title = schema.titleField ? row[schema.titleField] : undefined
  if (typeof title === 'string' && title.trim()) return title
  if (typeof title === 'number') return String(title)
  return isTempId(row.id) ? 'Untitled' : row.id
}

/** The time for today's changes, the day for older ones: the column is 70px wide. */
function formatWhen(value: unknown): string {
  if (typeof value !== 'string') return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const today = new Date().toDateString() === date.toDateString()
  return today
    ? date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/* ------------------------------------------------------------------ form */

function RecordForm({ schema, id, onGone }: { schema: SourceSchema; id: string; onGone: () => void }) {
  const store = useVeditStore()
  const [error, setError] = useState<string | null>(null)
  const canWrite = useVeditState(() => store.can('data:write'))
  const canDelete = useVeditState(() => store.can('data:delete'))

  useVeditState((state) => state.data)
  const fetched = useVeditState((state) => state.records[schema.name])
  const rows = store.recordsFor(schema.name)
  // A global that has never been written has no row yet; the server makes one
  // on the first commit, so the form edits an empty record under its fixed id.
  const record = rows.find((row) => row.id === id) ?? (schema.kind === 'global' ? { id } : undefined)

  useEffect(() => {
    if (fetched) return
    let cancelled = false
    store
      .loadRecords(schema.name)
      .catch((cause) => !cancelled && setError(cause instanceof Error ? cause.message : String(cause)))
    return () => {
      cancelled = true
    }
  }, [store, schema.name, fetched])

  // The row can vanish under the form: an undo of the New that made it, or a
  // Delete elsewhere. Leaving a form over nothing would write into the void.
  const gone = !record && !!fetched
  useEffect(() => {
    if (gone) onGone()
  }, [gone, onGone])

  if (error) return <div className="vedit-section vedit-hint">Could not load {schema.label}: {error}</div>
  if (!record) return <div className="vedit-section vedit-hint">Loading…</div>

  const readOnly = !schema.can.update || !canWrite
  const removable = schema.kind !== 'global' && canDelete && schema.can.delete

  return (
    <div className="vedit-panel-body">
      {readOnly ? (
        <div className="vedit-section vedit-hint">You can look at this record but not change it.</div>
      ) : null}
      <fieldset className="vedit-data-form" disabled={readOnly} aria-label={`${schema.label} record`}>
        {schema.fields.filter((field) => !field.hidden).map((field) => (
          <RecordField
            key={field.name}
            field={field}
            value={record[field.name]}
            onChange={(next) => {
              // A text field reports on every keystroke and again when it
              // loses focus; that second report would be an undo step that
              // undoes nothing.
              if (same(next, record[field.name])) return
              store.setRecord(schema.name, id, { [field.name]: next })
            }}
          />
        ))}
      </fieldset>
      {removable ? (
        <div className="vedit-section vedit-data-actions">
          <button
            type="button"
            className="vedit-btn vedit-data-delete"
            onClick={() => {
              store.deleteRecord(schema.name, id)
              onGone()
            }}
          >
            <IconTrash width={12} height={12} />
            Delete
          </button>
        </div>
      ) : null}
    </div>
  )
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  // A cleared field arrives as null and an unset one reads as undefined; both
  // mean "nothing here".
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true
  return typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b)
}

/* ---------------------------------------------------------------- fields */

/**
 * One record field. The types the inspector already edits go through
 * `PropField`; the three it has no reason to know — a date, raw JSON, and a
 * password that is written but never read — are drawn here.
 */
function RecordField({
  field,
  value,
  onChange,
}: {
  field: SourceField
  value: unknown
  onChange: (next: unknown) => void
}) {
  if (field.type === 'password') return <PasswordField field={field} value={value} onChange={onChange} />
  if (field.type === 'date') return <DateField field={field} value={value} onChange={onChange} />
  if (field.type === 'json') return <JsonField field={field} value={value} onChange={onChange} />

  const editable: EditableField = {
    name: field.name,
    type: field.type,
    label: field.label,
    options: field.options,
    help: field.help,
    to: field.to,
    many: field.many,
  }
  return (
    <div className="vedit-data-field">
      <PropField
        field={editable}
        value={value}
        source={undefined}
        record
        // A prop cleared in the inspector falls back to the component; a record
        // field has nothing to fall back to, and `undefined` would drop out of
        // the JSON on the way to the server, leaving the old value in place.
        onChange={(next) => onChange(next === undefined ? null : next)}
      />
    </div>
  )
}

function PasswordField({ field, value, onChange }: { field: SourceField; value: unknown; onChange: (next: unknown) => void }) {
  // What is shown is only ever what was typed in this session: the server
  // stores a hash and hands back neither. Empty means "leave it as it is".
  const [draft, setDraft] = useState(typeof value === 'string' ? value : '')
  return (
    <div className="vedit-data-field">
      <Row label={field.label}>
        <label className="vedit-field">
          <input
            className="vedit-input"
            type="password"
            autoComplete="new-password"
            aria-label={field.label}
            placeholder="Unchanged"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              if (draft !== (typeof value === 'string' ? value : '')) onChange(draft)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
            }}
          />
        </label>
      </Row>
      {field.help ? <div className="vedit-hint" style={{ marginBottom: 6 }}>{field.help}</div> : null}
    </div>
  )
}

function DateField({ field, value, onChange }: { field: SourceField; value: unknown; onChange: (next: unknown) => void }) {
  // Stored as an ISO string; the control only wants the day part of it.
  const day = typeof value === 'string' ? value.slice(0, 10) : ''
  return (
    <div className="vedit-data-field">
      <Row label={field.label}>
        <label className="vedit-field">
          <input
            className="vedit-input"
            type="date"
            aria-label={field.label}
            value={day}
            onChange={(event) => onChange(event.target.value || null)}
          />
        </label>
      </Row>
      {field.help ? <div className="vedit-hint" style={{ marginBottom: 6 }}>{field.help}</div> : null}
    </div>
  )
}

function JsonField({ field, value, onChange }: { field: SourceField; value: unknown; onChange: (next: unknown) => void }) {
  const printed = value === undefined || value === null ? '' : JSON.stringify(value, null, 2)
  const [draft, setDraft] = useState(printed)
  const [problem, setProblem] = useState<string | null>(null)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setDraft(printed)
  }, [printed])

  return (
    <div className="vedit-data-field">
      <div className="vedit-label" style={{ width: 'auto', marginBottom: 4 }}>
        {field.label}
      </div>
      <textarea
        className="vedit-textarea vedit-json"
        spellCheck={false}
        aria-label={field.label}
        aria-invalid={problem ? true : undefined}
        value={draft}
        placeholder="{ }"
        onFocus={() => (focused.current = true)}
        onChange={(event) => setDraft(event.target.value)}
        // Parsed when focus leaves, not per keystroke: half-typed JSON is never
        // valid, and a parse error mid-edit would be noise.
        onBlur={() => {
          focused.current = false
          const text = draft.trim()
          if (!text) {
            setProblem(null)
            if (printed) onChange(null)
            return
          }
          try {
            const parsed: unknown = JSON.parse(text)
            setProblem(null)
            if (JSON.stringify(parsed) !== JSON.stringify(value)) onChange(parsed)
          } catch (cause) {
            setProblem(cause instanceof Error ? cause.message : String(cause))
          }
        }}
      />
      {problem ? <div className="vedit-hint vedit-warn">Not valid JSON: {problem}</div> : null}
      {field.help ? <div className="vedit-hint" style={{ marginBottom: 6 }}>{field.help}</div> : null}
    </div>
  )
}
