/** Named responsive breakpoints. `base` always applies; the rest are min-width. */
export type Breakpoint = 'base' | 'sm' | 'md' | 'lg' | 'xl'

export const BREAKPOINT_ORDER: Breakpoint[] = ['base', 'sm', 'md', 'lg', 'xl']

export type BreakpointWidths = Record<Exclude<Breakpoint, 'base'>, number>

export const DEFAULT_BREAKPOINTS: BreakpointWidths = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
}

/** A bag of CSS declarations, camelCase or kebab-case keys both accepted. */
export type StyleMap = Record<string, string | number>

/** What kind of thing a node is — drives which inspector sections show up. */
export type NodeKind = 'text' | 'image' | 'box' | 'button' | 'link' | 'component'

/** Everything the editor can change about a single node. */
export interface NodeOverride {
  /** Replacement plain text for text nodes. */
  text?: string
  /** Replacement rich text (sanitized subset of HTML). Wins over `text`. */
  html?: string
  /** Image source. */
  src?: string
  /** Image alt text. */
  alt?: string
  /** Anchor destination. */
  href?: string
  /** Anchor target. */
  target?: string
  /** Hide the node entirely. */
  hidden?: boolean
  /** Extra class names appended to the node. */
  className?: string
  /** Styles that apply at every breakpoint. */
  style?: StyleMap
  /** Styles that only apply from a breakpoint up. */
  responsive?: Partial<Record<Exclude<Breakpoint, 'base'>, StyleMap>>
}

/** A visual the editor added that does not exist in source code. */
export interface InsertedNode {
  id: string
  /** Id of the `Editable` container it lives in. */
  parentId: string
  kind: Exclude<NodeKind, 'component'>
  /** Sort order inside the parent. */
  index: number
}

/** The saved payload: everything the editor knows about one site. */
export interface VeditDocument {
  version: 1
  /** Which site/page these overrides belong to. */
  key: string
  updatedAt: string
  nodes: Record<string, NodeOverride>
  inserted: InsertedNode[]
}

export function emptyDocument(key: string): VeditDocument {
  return { version: 1, key, updatedAt: new Date(0).toISOString(), nodes: {}, inserted: [] }
}

/** Where overrides are read from and written to. */
export interface VeditAdapter {
  load(key: string): Promise<VeditDocument | null>
  save(doc: VeditDocument): Promise<void>
  /** Optional: called when the user picks a local file in the image inspector. */
  uploadImage?(file: File): Promise<string>
}

/** Live info about a node currently mounted on the page. */
export interface RegisteredNode {
  id: string
  kind: NodeKind
  /** Human label shown in the layers panel. */
  label: string
  element: HTMLElement
  /** Id of the nearest registered ancestor, if any. */
  parentId: string | null
  /** True when the node came from the DOM scanner rather than an `Editable`. */
  auto: boolean
  /** True when the node accepts inserted children. */
  container: boolean
  /** Text content as authored in source, before overrides. */
  sourceText?: string
}

export type EditorTool = 'select' | 'hand' | 'text' | 'image' | 'box'

export interface VeditState {
  doc: VeditDocument
  /** Document as it was at the last successful save. */
  saved: VeditDocument
  status: 'loading' | 'ready' | 'saving' | 'error'
  error: string | null
  editing: boolean
  selection: string[]
  hovered: string | null
  breakpoint: Breakpoint
  tool: EditorTool
  /** Id of the node being edited inline right now. */
  inlineEditing: string | null
  /** Short-lived message shown at the bottom of the editor. */
  notice: string | null
  /** Where a re-ordering drag would drop, in page coordinates. */
  dropIndicator: { top: number; left: number; width: number; height: number } | null
  past: VeditDocument[]
  future: VeditDocument[]
}
