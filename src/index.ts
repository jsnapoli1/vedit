/**
 * The supported API.
 *
 * What is here is what a site is meant to use, and what a version number is a
 * promise about. Helpers the library uses on itself — the layer matrix, the DOM
 * scanner, the sanitizers, the a11y checks — live in `vedit/internal`, where they
 * can change in a minor release. If you find yourself needing one of those, that's
 * worth an issue: it usually means something belongs here.
 */

export { VeditProvider } from './core/context'
export type { VeditProviderProps, VeditConfig, VeditContextValue } from './core/context'
export {
  useVeditEditing,
  useVeditState,
  useVeditStore,
  useVeditNodes,
  useVeditContext,
  useVeditSession,
  useOptionalVeditContext,
} from './core/context'

export { Editable, InsertedChildren } from './components/Editable'
export { VeditSlot } from './components/Slot'
export type { VeditSlotProps } from './components/Slot'
export { defineComponents, defineComponent, componentManifest, migrateProps } from './core/registry'
export { seedFromDom, applySeed } from './core/seed'
export type { SeedOptions, SeedResult, SeedComponentRule } from './core/seed'
export type {
  ComponentDefinition,
  ComponentRegistry,
  ComponentSummary,
} from './core/registry'
export type { EditableProps } from './components/Editable'
export { EditableText, EditableImage, EditableBox, EditableLink } from './components/presets'
export { useEditable, labelFromId } from './components/useEditable'
export type { UseEditableOptions, UseEditableResult } from './components/useEditable'

export { VeditErrorBoundary } from './core/ErrorBoundary'
export type { VeditErrorBoundaryProps } from './core/ErrorBoundary'
export { VeditStore } from './core/store'

export { localStorageAdapter } from './core/adapters/localStorage'
export { httpAdapter } from './core/adapters/http'
export type { HttpAdapterOptions } from './core/adapters/http'
export { memoryAdapter } from './core/adapters/memory'
export { broadcastChannelRealtime } from './core/adapters/broadcast'
export { sseRealtime } from './core/adapters/sse'
export type { SseRealtimeOptions } from './core/adapters/sse'
export type {
  Comment,
  CommentReply,
  Peer,
  RealtimeConnection,
  RealtimeMessage,
  VeditRealtime,
} from './core/realtime'

/** Reading and changing a document without the editor — see also `vedit/api`. */
export { applyOperations, describeDocument, OperationError } from './core/operations'
export type {
  ContentPatch,
  DocumentSummary,
  OperationResult,
  VeditOperation,
} from './core/operations'
export { migrateDocument, inspectDocument } from './core/migrate'
export type { MigrationReport } from './core/migrate'
export { documentToCss, tokenVariable, tokenReference } from './runtime/css'

export {
  emptyDocument,
  BREAKPOINT_ORDER,
  DEFAULT_BREAKPOINTS,
  DOCUMENT_VERSION,
  STYLE_STATES,
} from './core/types'
export type {
  Breakpoint,
  BreakpointWidths,
  DesignToken,
  DocumentStage,
  EditableField,
  EditableFieldType,
  EditorTool,
  InsertedNode,
  NodeKind,
  NodeOverride,
  RegisteredNode,
  StyleLayer,
  StyleMap,
  StyleState,
  VeditAdapter,
  VeditAsset,
  VeditDocument,
  VeditState,
  VeditVersion,
} from './core/types'
