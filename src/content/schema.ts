import type {
  AccessAction,
  AccessLevel,
  AccessRule,
  AccessSpec,
  CollectionSpec,
  FieldSpec,
  FieldsSpec,
  GlobalSpec,
  SourceField,
  SourceSchema,
} from './types'

/** Identity functions that exist to infer the record types from the spec. */
export function defineCollections<T extends Record<string, CollectionSpec>>(collections: T): T {
  return collections
}

export function defineGlobals<T extends Record<string, GlobalSpec>>(globals: T): T {
  return globals
}

/** Expand the `'text'` shorthand so every field reads the same way. */
export function normalizeFields(spec: FieldsSpec): Record<string, FieldSpec> {
  const fields: Record<string, FieldSpec> = {}
  for (const [name, field] of Object.entries(spec)) {
    fields[name] = typeof field === 'string' ? { type: field } : field
  }
  return fields
}

/* ------------------------------------------------------------------ access */

const LEVELS: AccessLevel[] = ['public', 'author', 'editor', 'admin']

export const ACCESS_DEFAULTS: Record<AccessAction, AccessLevel> = {
  read: 'public',
  create: 'author',
  update: 'author',
  delete: 'author',
  publish: 'editor',
}

/** True when `role` is `level` or anything above it. */
export function roleAtLeast(role: AccessLevel, level: AccessLevel): boolean {
  return LEVELS.indexOf(role) >= LEVELS.indexOf(level)
}

/** The rule for an action, falling back to the default when the spec is silent. */
export function accessRule(access: AccessSpec | undefined, action: AccessAction): AccessRule {
  return access?.[action] ?? ACCESS_DEFAULTS[action]
}

/**
 * Whether a role can hope to do something, judged from the spec alone. A level
 * is decided here. A function rule is the server's to run against a real
 * request, so it is reported as possible for anyone who is signed in — the
 * editor shows the control and the handler has the last word.
 */
export function roleMay(access: AccessSpec | undefined, action: AccessAction, role: AccessLevel): boolean {
  const rule = accessRule(access, action)
  if (typeof rule === 'function') return roleAtLeast(role, 'author')
  return roleAtLeast(role, rule)
}

/* ------------------------------------------------------------------ schema */

function labelFor(name: string): string {
  return name.replace(/[-_]/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

function describeFields(spec: FieldsSpec): SourceField[] {
  return Object.entries(normalizeFields(spec)).map(([name, field]) => {
    const described: SourceField = { name, type: field.type, label: field.label ?? labelFor(name) }
    if (field.required !== undefined) described.required = field.required
    if (field.help !== undefined) described.help = field.help
    if (field.options !== undefined) described.options = field.options
    if (field.to !== undefined) described.to = field.to
    if (field.many !== undefined) described.many = field.many
    if (field.default !== undefined && typeof field.default !== 'function') described.default = field.default
    if (field.hidden) described.hidden = true
    return described
  })
}

function canFor(access: AccessSpec | undefined, role: AccessLevel): Record<AccessAction, boolean> {
  return {
    read: roleMay(access, 'read', role),
    create: roleMay(access, 'create', role),
    update: roleMay(access, 'update', role),
    delete: roleMay(access, 'delete', role),
    publish: roleMay(access, 'publish', role),
  }
}

/** Every source as one caller sees it. Order is declaration order, collections first. */
export function schemaFor(
  collections: Record<string, CollectionSpec>,
  globals: Record<string, GlobalSpec> | undefined,
  role: AccessLevel,
): SourceSchema[] {
  const sources: SourceSchema[] = []
  for (const [name, spec] of Object.entries(collections)) {
    const source: SourceSchema = {
      name,
      kind: 'collection',
      label: spec.label ?? labelFor(name),
      fields: describeFields(spec.fields),
      drafts: spec.drafts ?? true,
      can: canFor(spec.access, role),
    }
    if (spec.titleField !== undefined) source.titleField = spec.titleField
    if (spec.orderField !== undefined) source.orderField = spec.orderField
    if (spec.hidden) source.hidden = true
    sources.push(source)
  }
  for (const [name, spec] of Object.entries(globals ?? {})) {
    sources.push({
      name,
      kind: 'global',
      label: spec.label ?? labelFor(name),
      fields: describeFields(spec.fields),
      // A global is stored like a one-record collection, drafts included.
      drafts: true,
      can: canFor(spec.access, role),
      ...(spec.hidden ? { hidden: true } : {}),
    })
  }
  return sources
}
