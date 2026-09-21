/**
 * The shapes `vedit/content` speaks: how a host declares its collections, what a
 * record looks like once it is stored, and the client an editor talks to.
 *
 * Nothing here is React and nothing here touches a server. The same types are
 * read by the editor (through the `vedit` bundle), by `vedit/content-server`,
 * and by the MCP tools, so they live apart from all three.
 */

import type { DocumentStage, VeditAsset } from '../core/types'

/* ------------------------------------------------------------------ fields */

export type FieldType =
  | 'text'
  | 'textarea'
  | 'richtext'
  | 'number'
  | 'boolean'
  | 'date'
  | 'json'
  | 'select'
  | 'image'
  | 'file'
  | 'video'
  | 'relation'
  /** Write-only: the server hashes it and never reads it back. */
  | 'password'

export interface FieldSpec {
  type: FieldType
  label?: string
  required?: boolean
  /** Shown under the control. */
  help?: string
  /** Value a new record starts with; `'now'` on a `date` field means the moment it is created. */
  default?: unknown
  /** For `select`. Strings, or `{ value, label }` when the label differs. */
  options?: Array<string | { value: string; label: string }>
  /** For `relation`: the source the value points into. */
  to?: string
  /** For `relation`: the value is a list of ids rather than one. */
  many?: boolean
  /** Kept on the record but not shown in the Data panel — an import id, a timestamp, a machine field. */
  hidden?: boolean
}

/** A field is a spec, or just its type when nothing else needs saying. */
export type FieldsSpec = Record<string, FieldSpec | FieldType>

/* ------------------------------------------------------------------ access */

/** Who may do something. Each level includes the ones before it. */
export type AccessLevel = 'public' | 'author' | 'editor' | 'admin'

export type AccessAction = 'read' | 'create' | 'update' | 'delete' | 'publish'

/** What a function rule gets to decide with. */
export interface AccessContext {
  role: AccessLevel
  user: VeditUser | null
  source: string
  action: AccessAction
  /** The record being touched, when the action names one. */
  id?: string
  /** The data being written, when the action carries some. */
  data?: Record<string, unknown>
  request?: Request
}

/** A level, or a function the server asks per request. */
export type AccessRule = AccessLevel | ((ctx: AccessContext) => boolean | Promise<boolean>)

export interface AccessSpec {
  /** Default `'public'`. */
  read?: AccessRule
  /** Default `'author'`. */
  create?: AccessRule
  /** Default `'author'`. */
  update?: AccessRule
  /** Default `'author'`. */
  delete?: AccessRule
  /** Default `'editor'`. */
  publish?: AccessRule
}

/* ----------------------------------------------------------------- sources */

export interface HookContext {
  source: string
  stage: DocumentStage
  user: VeditUser | null
}

export interface SourceHooks {
  afterChange?(record: VeditRecord, ctx: HookContext): void | Promise<void>
  afterDelete?(id: string, ctx: HookContext): void | Promise<void>
}

export interface CollectionSpec {
  label?: string
  fields: FieldsSpec
  /** The field that names a record in lists. */
  titleField?: string
  /** A number field that carries the order editors put records in. */
  orderField?: string
  /** Default `true`. Without drafts every write goes live at once. */
  drafts?: boolean
  /** How many earlier copies to keep per record. Default 20. */
  versions?: number
  access?: AccessSpec
  hooks?: SourceHooks
  /** Listed under "Advanced" in the Data panel rather than beside the sources people edit every day. */
  hidden?: boolean
}

/** A global is a collection with exactly one record, whose id is `'global'`. */
export interface GlobalSpec {
  label?: string
  fields: FieldsSpec
  access?: AccessSpec
  hooks?: SourceHooks
  /** Listed under "Advanced" in the Data panel rather than beside the sources people edit every day. */
  hidden?: boolean
}

/* ----------------------------------------------------------------- records */

type ValueOf<T extends FieldType> = T extends 'number'
  ? number
  : T extends 'boolean'
    ? boolean
    : T extends 'json'
      ? unknown
      : T extends 'image' | 'file' | 'video'
        ? VeditAsset | string
        : string

type FieldValue<F> = F extends FieldType
  ? ValueOf<F>
  : F extends { type: infer T extends FieldType; many?: infer M }
    ? T extends 'relation'
      ? M extends true
        ? string[]
        : string
      : ValueOf<T>
    : unknown

/** The record type a collection spec implies. Inference only; nothing is generated. */
export type InferRecord<C extends CollectionSpec> = { id: string } & {
  [K in keyof C['fields']]?: FieldValue<C['fields'][K]>
}

/**
 * A stored record. The server adds `_updatedAt` and `_status` (`'draft'`,
 * `'changed'` or `'published'`) on read.
 */
export interface VeditRecord {
  id: string
  [field: string]: unknown
}

export interface SourceField {
  name: string
  type: FieldType
  label: string
  required?: boolean
  help?: string
  options?: Array<string | { value: string; label: string }>
  to?: string
  many?: boolean
  /** What a new record starts with; on a `date`, `'now'` means the moment the server saves it. */
  default?: unknown
  /** Kept on the record but not shown in the Data panel. */
  hidden?: boolean
}

/** A source as described to one caller: its fields, and what that caller may do. */
export interface SourceSchema {
  name: string
  kind: 'collection' | 'global'
  label: string
  fields: SourceField[]
  titleField?: string
  orderField?: string
  drafts: boolean
  can: Record<AccessAction, boolean>
  /** Listed under "Advanced" in the Data panel. */
  hidden?: boolean
}

/* ----------------------------------------------------------------- queries */

export interface RecordQuery {
  /** Equality per field; an array means "any of these". */
  where?: Record<string, unknown>
  /** `'field'` ascending, `'-field'` descending. */
  orderBy?: string
  limit?: number
  /** Relation fields to resolve into the records they point at. */
  populate?: string[]
  stage?: DocumentStage
}

/* ----------------------------------------------------------------- changes */

export interface SourceChanges {
  create?: VeditRecord[]
  update?: Record<string, Record<string, unknown>>
  delete?: string[]
  order?: string[]
}

/** Everything an editor has changed but not yet committed, by source. */
export interface RecordChanges {
  [source: string]: SourceChanges
}

export interface CommitResult {
  /** Temp id → the id the server chose. */
  idMap: Record<string, string>
  updatedAt: string
}

/** One step of a batch. Its own union; these never mix with `VeditOperation`. */
export type RecordOperation =
  | { op: 'set-record'; source: string; id: string; data: Record<string, unknown> }
  | { op: 'create-record'; source: string; id?: string; data: Record<string, unknown> }
  | { op: 'delete-record'; source: string; id: string }
  | { op: 'reorder-records'; source: string; order: string[] }

export interface RecordVersion {
  id: string
  savedAt: string
  stage: DocumentStage
}

/* ------------------------------------------------------------------ client */

export interface VeditUser {
  id: string
  email: string
  name?: string
  role: 'admin' | 'editor' | 'author'
}

export interface VeditCapabilities {
  user: VeditUser | null
  /** True when the server can sign someone in. */
  login: boolean
  can: {
    write: boolean
    publish: boolean
    upload: boolean
    data: { write: boolean; delete: boolean }
  }
}

/** How the editor reaches records, wherever they live. */
export interface VeditContentClient {
  schema(): Promise<SourceSchema[]>
  list(source: string, query?: RecordQuery): Promise<VeditRecord[]>
  get(source: string, id: string, opts?: { stage?: DocumentStage }): Promise<VeditRecord | null>
  commit(changes: RecordChanges, opts: { stage: DocumentStage }): Promise<CommitResult>
  publish?(records: Record<string, string[]>): Promise<void>
  versions?(source: string, id: string): Promise<RecordVersion[]>
  restoreVersion?(source: string, id: string, versionId: string): Promise<void>
  capabilities(): Promise<VeditCapabilities>
  login?(email: string, password: string): Promise<VeditUser>
  logout?(): Promise<void>
}

/** Which record field a node on the page shows. */
export interface RecordBinding {
  source: string
  id: string
  field: string
}
