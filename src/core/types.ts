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
  /** A list of form controls, configured in the inspector. See `FormField`. */
  | 'fields'

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

/**
 * Controls a visitor fills in.
 *
 * Deliberately not `EditableFieldType`: that one says which control the
 * *inspector* draws for a prop, this one which control appears on the host's
 * page. Collapsing them would tie the editor's chrome to the rendered markup.
 */
export type FormFieldType =
  | 'text'
  | 'textarea'
  | 'email'
  | 'tel'
  | 'url'
  | 'number'
  | 'checkbox'
  | 'select'
  | 'radio'
  | 'date'

/**
 * Named formats someone can pick in the inspector.
 *
 * A fixed list rather than a regex someone types, because a rule is stored data
 * that runs against visitor input on every keystroke: a catastrophically
 * backtracking pattern out of a document would hang the tab of everyone who
 * touched the field. These are written and audited once, here.
 */
export type PatternPreset = 'usZip' | 'usPhone' | 'postcodeUk' | 'slug' | 'hexColor'

/** One check against what a visitor typed. */
export type FormRule =
  | { kind: 'required' }
  | { kind: 'minLength'; value: number }
  | { kind: 'maxLength'; value: number }
  | { kind: 'min'; value: number }
  | { kind: 'max'; value: number }
  | { kind: 'email' }
  | { kind: 'url' }
  | { kind: 'tel' }
  | { kind: 'integer' }
  | { kind: 'pattern'; preset: PatternPreset }
  /** Equal to another field's value — confirm email, confirm password. */
  | { kind: 'matches'; field: string }

/**
 * One control on a form, as configured in the editor and stored in the document.
 *
 * vedit owns this shape and never the answers given to it: a submission is the
 * visitor's, and it goes to the host's endpoint rather than into the document.
 */
export interface FormField {
  /** Key the value is submitted under. Unique within a form. */
  name: string
  label?: string
  type: FormFieldType
  placeholder?: string
  /** Shown under the control. */
  help?: string
  /**
   * The browser autofill hint, e.g. `email`, `name`, `tel`, `street-address`.
   *
   * Worth setting: it is the difference between a visitor confirming what their
   * browser already knows and typing their address out by hand. A sensible one
   * is inferred from `type` when this is absent.
   */
  autoComplete?: string
  /** For `select` and `radio`. */
  options?: Array<string | { value: string; label: string }>
  /** Checks run against what the visitor types. */
  rules?: FormRule[]
}

/** What a visitor has entered, by field name. */
export type FormValues = Record<string, string | boolean>

/** What kind of thing a node is — drives which inspector sections show up. */
export type NodeKind = 'text' | 'image' | 'box' | 'button' | 'link' | 'component' | 'shape'

/** What an inserted shape draws. Coordinates are in a 100 × 100 box. */
export type ShapeSpec =
  /** Fills its box. `rx` rounds the corners, in box units. */
  | { type: 'rect'; rx?: number }
  /** An ellipse filling its box. A circle is a square box. */
  | { type: 'circle' }
  /** From one point to another. */
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number }
  /** A closed polygon. At least three points, at most 256. */
  | { type: 'polygon'; points: Array<[number, number]> }
  /**
   * Markup someone imported. `svg` is the *inner* markup of the file's root
   * `<svg>`, sanitised; `viewBox` is the root's, so the artwork keeps its
   * proportions.
   */
  | { type: 'custom'; svg: string; viewBox: string }

/** The shapes the Insert panel and the MCP server offer by name. */
export type ShapePreset = 'rect' | 'circle' | 'line' | 'triangle' | 'star' | 'hexagon'

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
  /**
   * For an inserted `shape`: what it draws.
   *
   * Geometry lives here rather than on `InsertedNode` because editing it is an
   * edit: it lands in undo, travels to other editors through the per-node diff,
   * duplicates with `duplicateInserted` and prunes with `pruneOverride` like any
   * other field. `InsertedNode` says *that* a shape is there and where.
   */
  shape?: ShapeSpec
  /**
   * Which version of its component's schema `props` were written against. Absent
   * means version 1, which is what every document written before schemas could be
   * versioned carries. Read by the registry's migration, never assumed.
   */
  propsVersion?: number
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
  /**
   * Values the host offers for interpolation into this node's text, by name.
   *
   * The stored override keeps the template (`Pay {amount} deposit`); these are
   * substituted at render. That is the whole point: a price, a session date or a
   * director's name is computed by the host on every render, so freezing the
   * rendered string into the document would go stale the moment it changed.
   * vedit stores names and never the values behind them.
   */
  vars?: Record<string, string>
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
  /**
   * Whether an edit inside a repeat applies to one item or to all of them.
   *
   * `'all'` writes to the template id, so the change reaches every card — the
   * usual intent, and the reason a repeater is worth having. `'item'` writes to
   * the selected item's own id, which wins over the template for that item.
   * Editor state, not document state: it is a mode the person is in, not
   * something the page remembers.
   */
  repeatScope: 'all' | 'item'
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
