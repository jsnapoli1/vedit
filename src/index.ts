export { VeditProvider } from './core/context'
export type { VeditProviderProps, VeditConfig, VeditContextValue } from './core/context'
export {
  useVeditEditing,
  useVeditState,
  useVeditStore,
  useVeditNodes,
  useVeditContext,
  useOptionalVeditContext,
} from './core/context'

export { Editable, InsertedChildren } from './components/Editable'
export type { EditableProps } from './components/Editable'
export { EditableText, EditableImage, EditableBox, EditableLink } from './components/presets'
export { useEditable, labelFromId } from './components/useEditable'
export type { UseEditableOptions, UseEditableResult } from './components/useEditable'

export { VeditStore } from './core/store'
export { localStorageAdapter } from './core/adapters/localStorage'
export { httpAdapter } from './core/adapters/http'
export type { HttpAdapterOptions } from './core/adapters/http'
export { memoryAdapter } from './core/adapters/memory'

export { documentToCss } from './runtime/css'
export { sanitizeHtml } from './runtime/sanitize'
export { scanDom } from './auto/scanner'
export { computeAutoId } from './auto/ids'

export {
  emptyDocument,
  BREAKPOINT_ORDER,
  DEFAULT_BREAKPOINTS,
} from './core/types'
export type {
  Breakpoint,
  BreakpointWidths,
  EditorTool,
  InsertedNode,
  NodeKind,
  NodeOverride,
  RegisteredNode,
  StyleMap,
  VeditAdapter,
  VeditDocument,
  VeditState,
} from './core/types'
