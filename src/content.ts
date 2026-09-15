/**
 * `vedit/content` — the content half of vedit, for hosts that want vedit to
 * own records as well as overrides. Pure: no React, no server, safe to import
 * from a component, a route handler or a script.
 */

export {
  ACCESS_DEFAULTS,
  accessRule,
  defineCollections,
  defineGlobals,
  normalizeFields,
  roleAtLeast,
  roleMay,
  schemaFor,
} from './content/schema'
export { RecordOperationError, applyRecordOperations } from './content/operations'
export { overlayChanges } from './content/overlay'
export { isTempId, newRecordId, remapIds } from './content/ids'
export { validateRecord } from './content/validate'
export { matchWhere, parseRecordQuery, segmentsAfterVersion, sortRows } from './content/query'
export { assetUrl, isAsset } from './content/assets'
export { httpContentClient, localContentClient } from './content/client'
export type { HttpContentClientOptions, LocalContentClientOptions } from './content/client'

export type {
  AccessAction,
  AccessContext,
  AccessLevel,
  AccessRule,
  AccessSpec,
  CollectionSpec,
  CommitResult,
  FieldSpec,
  FieldType,
  FieldsSpec,
  GlobalSpec,
  HookContext,
  InferRecord,
  RecordBinding,
  RecordChanges,
  RecordOperation,
  RecordQuery,
  RecordVersion,
  SourceChanges,
  SourceField,
  SourceHooks,
  SourceSchema,
  VeditCapabilities,
  VeditContentClient,
  VeditRecord,
  VeditUser,
} from './content/types'
export type { DocumentStage, VeditAsset } from './core/types'
