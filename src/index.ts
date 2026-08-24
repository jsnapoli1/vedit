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
export type { EditableProps } from './components/Editable'
export { EditableText, EditableImage, EditableBox, EditableLink } from './components/presets'
export { useEditable, labelFromId } from './components/useEditable'
export type { UseEditableOptions, UseEditableResult } from './components/useEditable'

export { VeditErrorBoundary } from './core/ErrorBoundary'
export type { VeditErrorBoundaryProps } from './core/ErrorBoundary'
export { VeditStore } from './core/store'
export { RealtimeSession, diffDocuments } from './core/session'
export type { SessionSnapshot, DocumentPatch } from './core/session'
export { broadcastChannelRealtime } from './core/adapters/broadcast'
export { sseRealtime } from './core/adapters/sse'
export type { SseRealtimeOptions } from './core/adapters/sse'
export { anonymousPeer, colorForPeer, initialsOf } from './core/realtime'
export type {
  Comment,
  CommentReply,
  Peer,
  RealtimeConnection,
  RealtimeMessage,
  VeditRealtime,
} from './core/realtime'
export { localStorageAdapter } from './core/adapters/localStorage'
export { httpAdapter } from './core/adapters/http'
export type { HttpAdapterOptions } from './core/adapters/http'
export { memoryAdapter } from './core/adapters/memory'

export { documentToCss, tokenVariable, tokenReference } from './runtime/css'
export { parseTransform, serializeTransform, withTransform } from './runtime/transform'
export type { TransformParts } from './runtime/transform'
export { parseGradient, serializeGradient, DEFAULT_GRADIENT } from './runtime/gradient'
export type { Gradient, GradientStop } from './runtime/gradient'
export {
  readLayer,
  readStyles,
  readStyleValue,
  mergeStyles,
  replaceStyles,
  deleteStyles,
  pruneOverride,
} from './core/layers'
export { sanitizeHtml, safeUrl } from './runtime/sanitize'
export { scanDom } from './auto/scanner'
export { auditPage, contrastRatio, effectiveBackground, parseColor, luminance } from './editor/a11y'
export type { A11yIssue } from './editor/a11y'
export { computeAutoId } from './auto/ids'

export {
  emptyDocument,
  BREAKPOINT_ORDER,
  DEFAULT_BREAKPOINTS,
  STYLE_STATES,
} from './core/types'
export type {
  Breakpoint,
  BreakpointWidths,
  DesignToken,
  EditableField,
  EditableFieldType,
  StyleLayer,
  StyleState,
  EditorTool,
  InsertedNode,
  NodeKind,
  NodeOverride,
  RegisteredNode,
  StyleMap,
  VeditAdapter,
  VeditAsset,
  VeditDocument,
  VeditState,
  VeditVersion,
} from './core/types'
