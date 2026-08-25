import type { Comment } from './realtime'

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

/** Interaction states you can style separately. */
export type StyleState = 'default' | 'hover' | 'focus' | 'active'

export const STYLE_STATES: StyleState[] = ['default', 'hover', 'focus', 'active']

/** One set of styles: a base plus per-breakpoint refinements. */
export interface StyleLayer {
  /** Applies at every width. */
  style?: StyleMap
  /** Applies from a breakpoint up. */
  responsive?: Partial<Record<Exclude<Breakpoint, 'base'>, StyleMap>>
}

/** A named value reused across the site — a brand color, a spacing step, a font. */
export interface DesignToken {
  /** Stable slug; becomes the CSS custom property name. */
  id: string
  name: string
  kind: 'color' | 'length' | 'font' | 'shadow'
  value: string
}

/** Kinds of control the inspector can render for a component prop. */
export type EditableFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'boolean'
  | 'select'
  | 'color'
  | 'image'
  | 'link'

/**
 * One prop a component has declared as editable. The schema lives in your code,
 * next to the component, so the editor can offer exactly the choices the component
 * actually supports — a variant list, not a free-text field.
 */
export interface EditableField {
  name: string
  label?: string
  type: EditableFieldType
  /** For `select`. Strings, or `{ value, label }` when the label differs. */
  options?: Array<string | { value: string; label: string }>
  min?: number
  max?: number
  step?: number
  /** Shown under the control. */
  help?: string
}

/** What kind of thing a node is — drives which inspector sections show up. */
export type NodeKind = 'text' | 'image' | 'box' | 'button' | 'link' | 'component'

/** Everything the editor can change about a single node. */
export interface NodeOverride extends StyleLayer {
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
  /** Styles that apply only while the element is hovered, focused or pressed. */
  states?: Partial<Record<Exclude<StyleState, 'default'>, StyleLayer>>
  /** Values for the props a component declared as editable. */
  props?: Record<string, unknown>
}

/** A visual the editor added that does not exist in source code. */
export interface InsertedNode {
  id: string
  /**
   * Id of the container it lives in — an `Editable` with `container`, a
   * `VeditSlot`, or another inserted node that accepts children. Nesting is just
   * a parent id pointing at another inserted node, so this flat list is a tree.
   */
  parentId: string
  kind: NodeKind
  /**
   * For `kind: 'component'`, which registered component to render. A name the
   * registry no longer knows draws a placeholder rather than failing: content
   * outlives the code that renders it.
   */
  component?: string
  /** Sort order inside the parent. */
  index: number
}

/**
 * The document format this build writes. See `core/migrate.ts` for what moving
 * it means and when it should move.
 */
export const DOCUMENT_VERSION = 1

/** The saved payload: everything the editor knows about one site. */
export interface VeditDocument {
  /** Format version. Read on load by `migrateDocument`, never assumed. */
  version: number
  /** Which site/page these overrides belong to. */
  key: string
  updatedAt: string
  nodes: Record<string, NodeOverride>
  inserted: InsertedNode[]
  /** Named values every node can reference. */
  tokens: DesignToken[]
}

export function emptyDocument(key: string): VeditDocument {
  return {
    version: DOCUMENT_VERSION,
    key,
    updatedAt: new Date(0).toISOString(),
    nodes: {},
    inserted: [],
    tokens: [],
  }
}

/** An image already available to the site, offered in the image picker. */
export interface VeditAsset {
  url: string
  name?: string
  width?: number
  height?: number
}

/** Which copy of a document to read: the editor's working copy, or the live one. */
export type DocumentStage = 'draft' | 'published'

/** Where overrides are read from and written to. */
export interface VeditAdapter {
  /** `stage` is only meaningful for adapters that also implement `publish`. */
  load(key: string, options?: { stage?: DocumentStage }): Promise<VeditDocument | null>
  save(doc: VeditDocument): Promise<void>
  /** Optional: called when the user picks a local file in the image inspector. */
  uploadImage?(file: File): Promise<string>
  /** Optional: images to choose from without uploading a new one. */
  listAssets?(): Promise<VeditAsset[]>
  /** Optional: where review notes live. Without these, comments last the session. */
  listComments?(key: string): Promise<Comment[]>
  saveComment?(comment: Comment): Promise<void>
  deleteComment?(commentId: string): Promise<void>
  /** Optional: publish the current draft, and list/restore earlier versions. */
  publish?(doc: VeditDocument): Promise<void>
  listVersions?(key: string): Promise<VeditVersion[]>
  loadVersion?(key: string, versionId: string): Promise<VeditDocument | null>
}

/** A point in a document's history. */
export interface VeditVersion {
  id: string
  savedAt: string
  /** True for the version currently live for visitors. */
  published?: boolean
  label?: string
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
  /** Props this node has declared as editable. */
  fields?: EditableField[]
  /** The prop values the source code passed, shown as the defaults. */
  props?: Record<string, unknown>
}

export type EditorTool = 'select' | 'hand' | 'comment' | 'text' | 'image' | 'box'

export interface VeditState {
  doc: VeditDocument
  /** Document as it was at the last successful save. */
  saved: VeditDocument
  /** Document as it was at the last publish, when the adapter supports it. */
  published: VeditDocument | null
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
  /** Where a new comment is being written, before it has a body. */
  pendingComment: { nodeId?: string; x: number; y: number } | null
  /** The comment thread currently open. */
  openComment: string | null
  /** Identifies the live collaboration session, so hooks re-read when it changes. */
  sessionId: string | null
  /** Which interaction state new style edits are written into. */
  styleState: StyleState
  /** Where a re-ordering drag would drop, in page coordinates. */
  dropIndicator: { top: number; left: number; width: number; height: number } | null
  past: VeditDocument[]
  future: VeditDocument[]
}
