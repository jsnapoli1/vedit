import {
  DOCUMENT_VERSION,
  emptyDocument,
  type DesignToken,
  type InsertedNode,
  type NodeOverride,
  type VeditDocument,
} from './types'

/**
 * The version written into every document this build saves.
 *
 * The rule for changing it:
 *
 * - **Additive change** — a new optional field, a new node kind. The version does
 *   *not* move. Old builds ignore what they don't know; new builds treat a missing
 *   field as absent. Most changes are this.
 * - **Breaking change** — a field is renamed, removed, or its meaning changes.
 *   Bump `DOCUMENT_VERSION` and add a step to `MIGRATIONS` that rewrites the old
 *   shape into the new one. Never edit an existing step: documents saved by every
 *   past build have to walk the same path.
 *
 * Data outlives code. Something out there has the old shape saved.
 */
export { DOCUMENT_VERSION }

/** Rewrites a document one version forward. Keyed by the version it reads. */
const MIGRATIONS: Record<number, (doc: RawDocument) => RawDocument> = {
  // 1: (doc) => ({ ...doc, version: 2, … })
}

type RawDocument = Record<string, unknown>

export interface MigrationReport {
  doc: VeditDocument
  /** The version the stored document claimed, or `null` if it didn't say. */
  from: number | null
  /** True when migrating or repairing actually changed something. */
  changed: boolean
  /**
   * True when the document was saved by a newer build than this one. Its data is
   * kept as-is where possible, but this build cannot be trusted to edit it.
   */
  future: boolean
  /** Human-readable notes about anything that had to be repaired or dropped. */
  warnings: string[]
}

/**
 * Bring a stored document up to the shape this build expects.
 *
 * Two jobs, both about surviving contact with data written elsewhere: walking the
 * version chain, and repairing a document whose shape is wrong (hand-edited JSON,
 * a truncated write, a different tool's output). Anything unrecognised is dropped
 * rather than allowed to reach the CSS emitter.
 */
export function inspectDocument(raw: unknown, fallbackKey = 'default'): MigrationReport {
  const warnings: string[] = []

  if (!isRecord(raw)) {
    return {
      doc: emptyDocument(fallbackKey),
      from: null,
      changed: raw != null,
      future: false,
      warnings: raw == null ? [] : ['Not a document — starting from an empty one.'],
    }
  }

  const declared = typeof raw.version === 'number' && Number.isFinite(raw.version) ? raw.version : null
  if (declared === null && raw.version !== undefined) {
    warnings.push(`Ignored a version of ${JSON.stringify(raw.version)}.`)
  }

  let current: RawDocument = raw
  let version = declared ?? DOCUMENT_VERSION
  let stepped = false

  while (version < DOCUMENT_VERSION) {
    const step = MIGRATIONS[version]
    if (!step) {
      warnings.push(`No migration from version ${version}; read as-is.`)
      break
    }
    current = step(current)
    version = typeof current.version === 'number' ? current.version : version + 1
    stepped = true
  }

  const future = version > DOCUMENT_VERSION
  if (future) {
    warnings.push(
      `Saved by a newer version of vedit (${version}, this build understands ${DOCUMENT_VERSION}). ` +
        `Fields this build doesn't know are kept but not editable.`,
    )
  }

  const doc = normalize(current, fallbackKey, warnings)
  // A future document keeps the version it came with, so saving it doesn't quietly
  // claim it is older than it is.
  doc.version = future ? version : DOCUMENT_VERSION

  return {
    doc,
    from: declared,
    changed: stepped || warnings.length > 0 || declared !== DOCUMENT_VERSION,
    future,
    warnings,
  }
}

/** `inspectDocument`, when all you want is the document. */
export function migrateDocument(raw: unknown, fallbackKey = 'default'): VeditDocument {
  return inspectDocument(raw, fallbackKey).doc
}

/* --------------------------------------------------------------- repairs */

function normalize(raw: RawDocument, fallbackKey: string, warnings: string[]): VeditDocument {
  // Unknown top-level fields are carried through: a document written by a newer
  // build round-trips through this one instead of losing what it doesn't know.
  const known = new Set(['version', 'key', 'updatedAt', 'nodes', 'inserted', 'tokens'])
  const extra: RawDocument = {}
  for (const [field, value] of Object.entries(raw)) {
    if (!known.has(field)) extra[field] = value
  }

  const key = typeof raw.key === 'string' && raw.key ? raw.key : fallbackKey
  const base = emptyDocument(key)

  // The cast is the point of `extra`: fields this build has no type for are kept
  // rather than silently dropped when a newer document round-trips through it.
  return {
    ...extra,
    ...base,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : base.updatedAt,
    nodes: normalizeNodes(raw.nodes, warnings),
    inserted: normalizeInserted(raw.inserted, warnings),
    tokens: normalizeTokens(raw.tokens, warnings),
  } as VeditDocument
}

function normalizeNodes(raw: unknown, warnings: string[]): Record<string, NodeOverride> {
  if (!isRecord(raw)) {
    if (raw !== undefined) warnings.push('Dropped `nodes`: not an object.')
    return {}
  }
  const nodes: Record<string, NodeOverride> = {}
  let dropped = 0
  for (const [id, override] of Object.entries(raw)) {
    if (isRecord(override)) nodes[id] = override as NodeOverride
    else dropped += 1
  }
  if (dropped) warnings.push(`Dropped ${dropped} override${dropped === 1 ? '' : 's'} that were not objects.`)
  return nodes
}

function normalizeInserted(raw: unknown, warnings: string[]): InsertedNode[] {
  if (!Array.isArray(raw)) {
    if (raw !== undefined) warnings.push('Dropped `inserted`: not an array.')
    return []
  }
  const kinds = new Set(['text', 'image', 'box', 'button', 'link'])
  const kept = raw.filter(
    (node): node is InsertedNode =>
      isRecord(node) &&
      typeof node.id === 'string' &&
      typeof node.parentId === 'string' &&
      typeof node.kind === 'string' &&
      kinds.has(node.kind),
  )
  if (kept.length !== raw.length) warnings.push(`Dropped ${raw.length - kept.length} malformed inserted node(s).`)
  return kept.map((node, index) => ({
    ...node,
    index: typeof node.index === 'number' && Number.isFinite(node.index) ? node.index : index,
  }))
}

function normalizeTokens(raw: unknown, warnings: string[]): DesignToken[] {
  if (!Array.isArray(raw)) {
    if (raw !== undefined) warnings.push('Dropped `tokens`: not an array.')
    return []
  }
  const kinds = new Set(['color', 'length', 'font', 'shadow'])
  const kept = raw.filter(
    (token): token is DesignToken =>
      isRecord(token) &&
      typeof token.id === 'string' &&
      typeof token.value === 'string' &&
      typeof token.kind === 'string' &&
      kinds.has(token.kind),
  )
  if (kept.length !== raw.length) warnings.push(`Dropped ${raw.length - kept.length} malformed token(s).`)
  return kept.map((token) => ({ ...token, name: typeof token.name === 'string' ? token.name : token.id }))
}

function isRecord(value: unknown): value is RawDocument {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
