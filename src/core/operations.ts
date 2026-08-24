import { deleteStyles, mergeStyles, pruneOverride, replaceStyles } from './layers'
import {
  BREAKPOINT_ORDER,
  STYLE_STATES,
  type Breakpoint,
  type DesignToken,
  type InsertedNode,
  type NodeOverride,
  type StyleMap,
  type StyleState,
  type VeditDocument,
} from './types'

/**
 * Every change that can be made to a document, as data.
 *
 * The editor drives `VeditStore` directly, because it also has a selection, an
 * undo stack and a page to point at. Everything *without* a browser — the HTTP
 * API, the MCP server, a migration script, a test — drives this instead. One
 * vocabulary, so a change made by an agent and a change made by a person are the
 * same kind of thing by the time they reach storage.
 *
 * `state` and `breakpoint` default to `default` and `base`: the cell you get when
 * you don't say otherwise.
 */
export type VeditOperation =
  /** Merge declarations into one cell of the state × breakpoint matrix. */
  | ({ op: 'set-styles'; id: string; styles: StyleMap } & Cell)
  /** Replace a cell outright, dropping declarations not named here. */
  | ({ op: 'replace-styles'; id: string; styles: StyleMap } & Cell)
  /** Remove declarations from a cell, falling back to the site's own styling. */
  | ({ op: 'clear-styles'; id: string; properties: string[] } & Cell)
  /** Text, image, link and visibility. `null` removes a field. */
  | { op: 'set-content'; id: string; content: ContentPatch }
  /** Values for props a component declared as editable. `null` removes one. */
  | { op: 'set-props'; id: string; props: Record<string, unknown> }
  /** Drop every override for a node, back to what the source code renders. */
  | { op: 'reset-node'; id: string }
  /** Add a visual that does not exist in the source code. */
  | {
      op: 'insert-node'
      parentId: string
      kind: InsertedNode['kind']
      /** Optional explicit id, so a caller can insert idempotently. */
      id?: string
      index?: number
      override?: NodeOverride
    }
  /** Re-parent or re-order an inserted node. */
  | { op: 'move-node'; id: string; parentId?: string; index?: number }
  /** Remove an inserted node and its overrides. */
  | { op: 'remove-node'; id: string }
  /** Create or update a named value. */
  | { op: 'set-token'; token: DesignToken }
  | { op: 'remove-token'; id: string }

interface Cell {
  state?: StyleState
  breakpoint?: Breakpoint
}

/** Content fields, where `null` means "remove this override". */
export interface ContentPatch {
  text?: string | null
  html?: string | null
  src?: string | null
  alt?: string | null
  href?: string | null
  target?: string | null
  className?: string | null
  hidden?: boolean | null
}

export interface OperationResult {
  doc: VeditDocument
  /** Node ids this batch touched, in the order they were first touched. */
  changed: string[]
  /** Ids of nodes created by `insert-node`. */
  created: string[]
}

/** A batch that could not be applied. The document is left exactly as it was. */
export class OperationError extends Error {
  constructor(
    message: string,
    /** Position of the failing operation in the batch. */
    readonly index: number,
    readonly operation: unknown,
  ) {
    super(message)
    this.name = 'OperationError'
  }
}

/**
 * Apply a batch to a document and return a new one. Atomic: if any operation is
 * malformed the whole batch fails and nothing is written, so a caller can never
 * end up with half of what an agent intended.
 */
export function applyOperations(doc: VeditDocument, operations: VeditOperation[]): OperationResult {
  if (!Array.isArray(operations)) throw new OperationError('Expected an array of operations', 0, operations)

  let next: VeditDocument = { ...doc, nodes: { ...doc.nodes }, inserted: [...doc.inserted], tokens: [...doc.tokens] }
  const changed: string[] = []
  const created: string[] = []
  const touch = (id: string) => {
    if (!changed.includes(id)) changed.push(id)
  }

  operations.forEach((operation, index) => {
    // Annotated, not inferred: TypeScript only narrows after a `never` call when
    // the target's type is written out.
    const fail: (message: string) => never = (message) => {
      throw new OperationError(message, index, operation)
    }
    if (!operation || typeof operation !== 'object') fail('Not an operation')

    switch (operation.op) {
      case 'set-styles':
      case 'replace-styles':
      case 'clear-styles': {
        const id = requireId(operation.id, fail)
        const { state, breakpoint } = cell(operation, fail)
        const current = clone(next.nodes[id] ?? {})
        let override: NodeOverride
        if (operation.op === 'clear-styles') {
          if (!Array.isArray(operation.properties)) fail('`properties` must be an array of CSS property names')
          override = deleteStyles(current, state, breakpoint, operation.properties.map(String))
        } else {
          const styles = requireStyles(operation.styles, fail)
          override =
            operation.op === 'set-styles'
              ? mergeStyles(current, state, breakpoint, styles)
              : replaceStyles(current, state, breakpoint, styles)
        }
        writeNode(next, id, override)
        touch(id)
        break
      }

      case 'set-content': {
        const id = requireId(operation.id, fail)
        const content = operation.content
        if (!content || typeof content !== 'object') fail('`content` must be an object')
        const override = clone(next.nodes[id] ?? {})
        for (const [field, value] of Object.entries(content)) {
          if (!CONTENT_FIELDS.has(field)) fail(`Unknown content field \`${field}\``)
          if (value === null) delete (override as Record<string, unknown>)[field]
          else if (field === 'hidden') override.hidden = Boolean(value)
          else if (typeof value !== 'string') fail(`\`${field}\` must be a string or null`)
          else (override as Record<string, unknown>)[field] = value
        }
        writeNode(next, id, override)
        touch(id)
        break
      }

      case 'set-props': {
        const id = requireId(operation.id, fail)
        if (!operation.props || typeof operation.props !== 'object') fail('`props` must be an object')
        const override = clone(next.nodes[id] ?? {})
        const props = { ...override.props }
        for (const [name, value] of Object.entries(operation.props)) {
          if (value === null) delete props[name]
          else props[name] = value
        }
        writeNode(next, id, { ...override, props })
        touch(id)
        break
      }

      case 'reset-node': {
        const id = requireId(operation.id, fail)
        delete next.nodes[id]
        next.inserted = next.inserted.filter((node) => node.id !== id)
        touch(id)
        break
      }

      case 'insert-node': {
        const parentId = requireId(operation.parentId, fail, 'parentId')
        const kind = operation.kind
        if (!INSERTED_KINDS.has(kind)) {
          fail(`\`kind\` must be one of ${[...INSERTED_KINDS].join(', ')}`)
        }
        const id = operation.id ?? newInsertedId(parentId)
        if (next.inserted.some((node) => node.id === id)) fail(`\`${id}\` already exists`)
        const siblings = next.inserted.filter((node) => node.parentId === parentId)
        const at = clampIndex(operation.index, siblings.length)
        next.inserted = reindex(next.inserted, parentId, at, { id, parentId, kind, index: at })
        writeNode(next, id, { ...INSERTED_DEFAULTS[kind], ...operation.override })
        touch(id)
        created.push(id)
        break
      }

      case 'move-node': {
        const id = requireId(operation.id, fail)
        const node = next.inserted.find((candidate) => candidate.id === id)
        if (!node) fail(`\`${id}\` is not an inserted node — only inserted nodes can be moved`)
        const parentId = operation.parentId ?? node!.parentId
        const others = next.inserted.filter((candidate) => candidate.id !== id)
        const siblings = others.filter((candidate) => candidate.parentId === parentId)
        const at = clampIndex(operation.index, siblings.length)
        next.inserted = reindex(others, parentId, at, { ...node!, parentId, index: at })
        touch(id)
        break
      }

      case 'remove-node': {
        const id = requireId(operation.id, fail)
        if (!next.inserted.some((node) => node.id === id)) {
          fail(`\`${id}\` is not an inserted node — use reset-node to clear a source element's overrides`)
        }
        next.inserted = next.inserted.filter((node) => node.id !== id)
        delete next.nodes[id]
        touch(id)
        break
      }

      case 'set-token': {
        const token = operation.token
        if (!token || typeof token !== 'object') fail('`token` must be an object')
        if (!token.id || typeof token.id !== 'string') fail('`token.id` is required')
        if (typeof token.value !== 'string') fail('`token.value` must be a string')
        if (!TOKEN_KINDS.has(token.kind)) fail(`\`token.kind\` must be one of ${[...TOKEN_KINDS].join(', ')}`)
        const complete: DesignToken = { ...token, name: token.name || token.id }
        const existing = next.tokens.findIndex((candidate) => candidate.id === token.id)
        next.tokens =
          existing === -1
            ? [...next.tokens, complete]
            : next.tokens.map((candidate, at) => (at === existing ? complete : candidate))
        break
      }

      case 'remove-token': {
        const id = requireId(operation.id, fail)
        next.tokens = next.tokens.filter((token) => token.id !== id)
        break
      }

      default:
        fail(`Unknown operation \`${(operation as { op?: string }).op ?? '(missing)'}\``)
    }
  })

  next.updatedAt = new Date().toISOString()
  return { doc: next, changed, created }
}

/* ------------------------------------------------------------- inserting */

/** What a newly inserted node looks like before anyone styles it. */
export const INSERTED_DEFAULTS: Record<InsertedNode['kind'], NodeOverride> = {
  text: { text: 'New text', style: { fontSize: '16px', color: 'inherit' } },
  image: {
    src: 'https://placehold.co/600x400/e2e8f0/64748b?text=Image',
    alt: '',
    style: { width: '100%', height: 'auto' },
  },
  box: { style: { minHeight: '96px', background: '#f1f5f9', borderRadius: '8px' } },
  button: { text: 'Button', href: '#', style: {} },
  link: { text: 'Link', href: '#' },
}

/**
 * Inserted ids carry their parent so a document alone says where a node belongs,
 * without a lookup.
 */
export function newInsertedId(parentId: string): string {
  return `${parentId}::added-${Math.random().toString(36).slice(2, 8)}`
}

/* -------------------------------------------------------------- describing */

export interface DocumentSummary {
  key: string
  version: number
  updatedAt: string
  nodes: Array<{
    id: string
    /** Which parts of the override are set: `text`, `style`, `hover`, `md`, … */
    overrides: string[]
    inserted: boolean
    text?: string
  }>
  tokens: DesignToken[]
  counts: { nodes: number; inserted: number; tokens: number }
}

/**
 * A document at a glance. The full JSON is the truth, but it is mostly style maps;
 * this is the shape you want when deciding what to change — especially for a model
 * with a context window to spend.
 */
export function describeDocument(doc: VeditDocument): DocumentSummary {
  const insertedIds = new Set(doc.inserted.map((node) => node.id))
  const nodes = Object.entries(doc.nodes).map(([id, override]) => {
    const overrides: string[] = []
    for (const field of CONTENT_FIELDS) if (override[field as keyof NodeOverride] !== undefined) overrides.push(field)
    if (override.props) overrides.push('props')
    // Style cells are named the way you'd address them: `style`, `md`, `hover`,
    // `hover:lg`. Enough to know what exists without printing every declaration.
    for (const state of STYLE_STATES) {
      const layer = state === 'default' ? override : override.states?.[state]
      if (!layer) continue
      if (layer.style && Object.keys(layer.style).length) overrides.push(state === 'default' ? 'style' : state)
      for (const breakpoint of BREAKPOINT_ORDER) {
        if (breakpoint === 'base') continue
        if (!layer.responsive?.[breakpoint]) continue
        overrides.push(state === 'default' ? breakpoint : `${state}:${breakpoint}`)
      }
    }
    return {
      id,
      overrides,
      inserted: insertedIds.has(id),
      ...(override.text === undefined ? {} : { text: override.text }),
    }
  })

  return {
    key: doc.key,
    version: doc.version,
    updatedAt: doc.updatedAt,
    nodes,
    tokens: doc.tokens,
    counts: { nodes: nodes.length, inserted: doc.inserted.length, tokens: doc.tokens.length },
  }
}

/* ------------------------------------------------------------------ util */

const CONTENT_FIELDS = new Set(['text', 'html', 'src', 'alt', 'href', 'target', 'className', 'hidden'])
const INSERTED_KINDS = new Set<string>(['text', 'image', 'box', 'button', 'link'])
const TOKEN_KINDS = new Set<string>(['color', 'length', 'font', 'shadow'])

function writeNode(doc: VeditDocument, id: string, override: NodeOverride) {
  const pruned = pruneOverride(override)
  if (pruned) doc.nodes[id] = pruned
  else delete doc.nodes[id]
}

function requireId(value: unknown, fail: (message: string) => never, field = 'id'): string {
  if (typeof value !== 'string' || !value) fail(`\`${field}\` is required`)
  return value as string
}

function requireStyles(value: unknown, fail: (message: string) => never): StyleMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('`styles` must be an object')
  const styles: StyleMap = {}
  for (const [property, declaration] of Object.entries(value as Record<string, unknown>)) {
    if (typeof declaration !== 'string' && typeof declaration !== 'number') {
      fail(`\`styles.${property}\` must be a string or a number`)
    }
    styles[property] = declaration as string | number
  }
  return styles
}

function cell(operation: Cell, fail: (message: string) => never): { state: StyleState; breakpoint: Breakpoint } {
  const state = operation.state ?? 'default'
  const breakpoint = operation.breakpoint ?? 'base'
  if (!STYLE_STATES.includes(state)) fail(`\`state\` must be one of ${STYLE_STATES.join(', ')}`)
  if (!BREAKPOINT_ORDER.includes(breakpoint)) fail(`\`breakpoint\` must be one of ${BREAKPOINT_ORDER.join(', ')}`)
  return { state, breakpoint }
}

function clampIndex(index: number | undefined, length: number): number {
  if (typeof index !== 'number' || !Number.isFinite(index)) return length
  return Math.max(0, Math.min(Math.floor(index), length))
}

/** Put `node` at `at` among its siblings and renumber the rest so indexes stay dense. */
function reindex(inserted: InsertedNode[], parentId: string, at: number, node: InsertedNode): InsertedNode[] {
  const siblings = inserted
    .filter((candidate) => candidate.parentId === parentId)
    .sort((a, b) => a.index - b.index)
  siblings.splice(at, 0, node)
  const renumbered = new Map(siblings.map((candidate, index) => [candidate.id, { ...candidate, index }]))
  const rest = inserted.filter((candidate) => candidate.parentId !== parentId)
  return [...rest, ...siblings.map((candidate) => renumbered.get(candidate.id)!)]
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
