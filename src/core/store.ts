import type { RealtimeSession } from './session'
import { inspectDocument } from './migrate'
import { applyOperations, newInsertedId, OperationError, type VeditOperation } from './operations'
import { itemId, parseItemId } from '../runtime/repeat'
import { applyRecordOperations } from '../content/operations'
import { overlayChanges } from '../content/overlay'
import { newRecordId, remapIds } from '../content/ids'
import { warnOnce } from './env'
import type {
  RecordBinding,
  RecordChanges,
  RecordOperation,
  RecordQuery,
  SourceSchema,
  VeditCapabilities,
  VeditContentClient,
  VeditRecord,
} from '../content/types'
import {
  deleteStyles,
  mergeStyles,
  pruneOverride,
  readStyleValue,
  replaceStyles,
} from './layers'
import {
  emptyDocument,
  type DesignToken,
  type Breakpoint,
  type EditorTool,
  type HistoryEntry,
  type InsertedNode,
  type NodeKind,
  type NodeOverride,
  type RegisteredNode,
  type ShapeSpec,
  type StyleMap,
  type StyleState,
  type DocumentStage,
  type VeditAdapter,
  type VeditAsset,
  type VeditVersion,
  type VeditDocument,
  type VeditState,
} from './types'

const HISTORY_LIMIT = 100

/** What the store may be asked whether someone can do. */
export type Capability = 'write' | 'publish' | 'upload' | 'data:write' | 'data:delete'

/**
 * Which override keys are the *content* a node takes from its record, by what
 * the node is: an image shows the record as its source, a link, a file or a
 * button as its destination, text as its copy. Only these go to the record on a
 * bound node. Everything else written to it — a link's copy, an image's alt,
 * visibility, a class — is the document's, exactly as it is on any other node;
 * a box or a component has no content to bind.
 */
const BOUND_KEYS: Partial<Record<NodeKind, ReadonlyArray<'html' | 'text' | 'src' | 'href'>>> = {
  text: ['html', 'text'],
  image: ['src'],
  link: ['href'],
  file: ['href'],
  button: ['href'],
}

/** `null` names the page's own document; a string names a shared one. */
type DocKey = string | null

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * The single source of truth for the editor. Deliberately framework-free so it can
 * be driven from tests, keyboard shortcuts, or the React tree via `useSyncExternalStore`.
 */
export class VeditStore {
  private listeners = new Set<() => void>()
  private nodeListeners = new Set<() => void>()
  private registry = new Map<string, RegisteredNode>()
  private registrySnapshot: RegisteredNode[] = []
  private pendingSources = new Set<string>()
  /** Exposed so the provider can hand the same adapter to the realtime session. */
  readonly adapter: VeditAdapter
  /** Where records live, when the site has opted into `vedit/content`. */
  readonly content: VeditContentClient | null
  /** Keys of the documents shared across pages, in the order they were given. */
  readonly sharedKeys: string[]
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null
  private noticeTimer: ReturnType<typeof setTimeout> | null = null
  readonly autosaveMs: number

  state: VeditState

  /** Set by the provider when collaboration is configured. */
  session: RealtimeSession | null = null

  setSession(session: RealtimeSession | null) {
    this.session = session
    this.set({ sessionId: session?.self.id ?? null })
  }

  constructor(opts: {
    key: string
    adapter: VeditAdapter
    content?: VeditContentClient
    shared?: string[]
    autosaveMs?: number
  }) {
    const doc = emptyDocument(opts.key)
    this.adapter = opts.adapter
    this.content = opts.content ?? null
    this.sharedKeys = [...(opts.shared ?? [])]
    this.autosaveMs = opts.autosaveMs ?? 0
    const shared: Record<string, VeditDocument> = {}
    for (const key of this.sharedKeys) shared[key] = emptyDocument(key)
    this.state = {
      doc,
      saved: doc,
      published: null,
      status: 'loading',
      error: null,
      editing: false,
      selection: [],
      hovered: null,
      breakpoint: 'base',
      styleState: 'default',
      sessionId: null,
      pendingComment: null,
      openComment: null,
      tool: 'select',
      inlineEditing: null,
      repeatScope: 'all',
      notice: null,
      dropIndicator: null,
      past: [],
      future: [],
      data: {},
      records: {},
      recordSets: {},
      schema: null,
      pendingPublish: {},
      capabilities: null,
      // Without a client there is nobody to sign in to, so the editor may open.
      auth: this.content ? 'none' : 'ok',
      shared,
      sharedSaved: shared,
      sharedPublished: {},
    }
  }

  /* ---------------------------------------------------------------- plumbing */

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getState = () => this.state

  private set(patch: Partial<VeditState>) {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }

  /* ---------------------------------------------------------------- registry */

  subscribeNodes = (listener: () => void) => {
    this.nodeListeners.add(listener)
    return () => {
      this.nodeListeners.delete(listener)
    }
  }

  getNodes = () => this.registrySnapshot

  private emitNodes() {
    this.registrySnapshot = [...this.registry.values()]
    for (const listener of this.nodeListeners) listener()
  }

  register(node: RegisteredNode) {
    this.registry.set(node.id, node)
    this.emitNodes()
  }

  /**
   * Replace every scanner-produced node in one pass. Called after each DOM scan,
   * and cheap enough to run on mutations because it bails when nothing moved.
   */
  syncAutoNodes(nodes: RegisteredNode[]) {
    const incoming = new Set(nodes.map((node) => node.id))
    let changed = false
    for (const [id, node] of this.registry) {
      if (node.auto && !incoming.has(id)) {
        this.registry.delete(id)
        changed = true
      }
    }
    for (const node of nodes) {
      const existing = this.registry.get(node.id)
      if (!existing || existing.element !== node.element || existing.label !== node.label) changed = true
      this.registry.set(node.id, node)
    }
    if (changed) this.emitNodes()
  }

  unregister(id: string) {
    if (this.registry.delete(id)) {
      const patch: Partial<VeditState> = {}
      if (this.state.hovered === id) patch.hovered = null
      if (this.state.selection.includes(id)) {
        patch.selection = this.state.selection.filter((s) => s !== id)
      }
      if (Object.keys(patch).length) this.set(patch)
      this.emitNodes()
    }
  }

  getNode(id: string | null | undefined): RegisteredNode | undefined {
    return id ? this.registry.get(id) : undefined
  }

  /**
   * What to call a node in the chrome. A name given in the editor wins over the
   * one the source code gave; an item of a repeat inherits the template's, the
   * way it inherits everything else, unless it was named on its own.
   */
  labelOf(id: string): string {
    const own = this.docOf(id).nodes[id]?.label
    if (own) return own
    const templateId = parseItemId(id)?.templateId
    const inherited = templateId ? this.docOf(templateId).nodes[templateId]?.label : undefined
    return inherited || this.registry.get(id)?.label || id
  }

  /* ------------------------------------------------------------- documents */

  /** The page's document and every shared one, in a fixed order. */
  documents(): Array<{ key: string; doc: VeditDocument }> {
    return [
      { key: this.state.doc.key, doc: this.state.doc },
      ...this.sharedKeys.map((key) => ({ key, doc: this.documentAt(key) })),
    ]
  }

  /** The document a node's overrides live in: a shared one when it is scoped, else the page's. */
  docOf(id: string): VeditDocument {
    return this.documentAt(this.docKeyOf(id))
  }

  private documentAt(key: DocKey): VeditDocument {
    if (key === null) return this.state.doc
    return this.state.shared[key] ?? emptyDocument(key)
  }

  /**
   * Which document `id` belongs to. A registered node says so with its scope;
   * without one, the answer comes from whatever it sits inside — a placed node
   * from its parent, an item of a repeat from its template — so a link added to
   * a nav that lives in the site document lands in the site document too.
   */
  private docKeyOf(id: string): DocKey {
    if (!this.sharedKeys.length) return null
    const seen = new Set<string>()
    let current: string | null = id
    while (current && !seen.has(current)) {
      seen.add(current)
      const registered: RegisteredNode | undefined =
        this.registry.get(current) ?? this.registry.get(parseItemId(current)?.templateId ?? '')
      if (registered) {
        if (registered.scope) return registered.scope
        current = registered.parentId
        continue
      }
      const placed = this.findInserted(current)
      if (!placed) return null
      if (placed.key !== null) return placed.key
      current = placed.node.parentId
    }
    return null
  }

  private findInserted(id: string): { key: DocKey; node: InsertedNode } | null {
    const own = this.state.doc.inserted.find((node) => node.id === id)
    if (own) return { key: null, node: own }
    for (const key of this.sharedKeys) {
      const node = this.state.shared[key]?.inserted.find((candidate) => candidate.id === id)
      if (node) return { key, node }
    }
    return null
  }

  /* ------------------------------------------------------------------- doc */

  private entry(): HistoryEntry {
    return { doc: this.state.doc, data: this.state.data, shared: this.state.shared }
  }

  /**
   * Record one change — to the page, to a shared document, to the pending record
   * edits, or several at once — as one undo step.
   */
  private commitEntry(next: Partial<HistoryEntry>, opts: { history?: boolean } = {}) {
    const history = opts.history !== false
    const stamp = new Date().toISOString()
    const patch: Partial<VeditState> = {
      past: history ? [...this.state.past, this.entry()].slice(-HISTORY_LIMIT) : this.state.past,
      future: history ? [] : this.state.future,
    }
    if (next.doc) patch.doc = { ...next.doc, updatedAt: stamp }
    if (next.data) patch.data = next.data
    if (next.shared) {
      const shared = { ...this.state.shared }
      for (const [key, doc] of Object.entries(next.shared)) shared[key] = { ...doc, updatedAt: stamp }
      patch.shared = shared
    }
    this.set(patch)
    this.scheduleAutosave()
  }

  private commit(doc: VeditDocument, opts: { history?: boolean } = {}) {
    this.commitEntry({ doc }, opts)
  }

  /** Commit several documents, keyed the way `docKeyOf` keys them, as one step. */
  private commitDocs(docs: Map<DocKey, VeditDocument>, extra: { data?: RecordChanges } = {}, opts: { history?: boolean } = {}) {
    const next: Partial<HistoryEntry> = {}
    for (const [key, doc] of docs) {
      if (key === null) next.doc = doc
      else (next.shared ??= {})[key] = doc
    }
    if (extra.data) next.data = extra.data
    this.commitEntry(next, opts)
  }

  getOverride(id: string): NodeOverride {
    return this.docOf(id).nodes[id] ?? {}
  }

  /**
   * Where an edit to `id` should be written.
   *
   * Selecting a card selects one item — `cards.title~b` — but the usual intent
   * is "change this on every card", so by default the write is redirected to the
   * template the items share. `repeatScope: 'item'` leaves it on the item, which
   * is what makes one card able to differ.
   *
   * Everything else in the editor keeps talking about the node that is actually
   * selected; only the write target moves. That keeps selection, outlines and
   * the layers panel honest about what was clicked.
   */
  writeTarget(id: string): string {
    if (this.state.repeatScope === 'item') return id
    return parseItemId(id)?.templateId ?? id
  }

  /** Switch between editing every item of a repeat and editing just this one. */
  setRepeatScope(scope: 'all' | 'item') {
    this.set({ repeatScope: scope })
  }

  /**
   * Drop one repeat item's own override, so it goes back to following the
   * template.
   *
   * Deliberately not routed through `writeTarget`: this is the one write that
   * means the item and never the template, and redirecting it would clear the
   * shared edit for every card instead — the opposite of what the button says.
   */
  resetRepeatItem(id: string) {
    if (!parseItemId(id)) return
    const key = this.docKeyOf(id)
    const doc = this.documentAt(key)
    if (!(id in doc.nodes)) return
    const nodes = { ...doc.nodes }
    delete nodes[id]
    this.commitDocs(new Map([[key, { ...doc, nodes }]]))
  }

  /**
   * Change one or more nodes' overrides and commit the lot as one step. Each edit
   * names the node that was clicked; the document it lives in comes from that,
   * and the node actually written follows the repeat scope unless `redirect` is
   * off. Documents are grouped so a multi-selection spanning the page and a
   * shared nav is still one undo.
   */
  private editNodes(
    edits: Array<[rawId: string, change: (override: NodeOverride) => NodeOverride]>,
    opts: { history?: boolean; redirect?: boolean; data?: RecordChanges } = {},
  ) {
    const docs = new Map<DocKey, VeditDocument>()
    for (const [rawId, change] of edits) {
      const key = this.docKeyOf(rawId)
      const id = opts.redirect === false ? rawId : this.writeTarget(rawId)
      const doc = docs.get(key) ?? this.documentAt(key)
      const nodes = { ...doc.nodes }
      const pruned = pruneOverride(change(clone(nodes[id] ?? {})))
      if (pruned) nodes[id] = pruned
      else delete nodes[id]
      docs.set(key, { ...doc, nodes })
    }
    this.commitDocs(docs, { data: opts.data }, opts)
  }

  /**
   * Split a patch for a bound node: the content the node shows from its record
   * goes to the record, the rest (a link's copy, visibility, styling, a class)
   * stays with the document.
   */
  private splitBound(
    binding: RecordBinding,
    kind: NodeKind,
    patch: NodeOverride,
  ): { record: Record<string, unknown> | null; rest: NodeOverride } {
    const keys = BOUND_KEYS[kind]
    if (!keys) return { record: null, rest: patch }
    const rest: NodeOverride = { ...patch }
    for (const key of keys) delete rest[key]
    // Copy can arrive as both plain and rich text; the record holds one value,
    // which the page reads back the way the schema says. So a rich-text field
    // takes the markup and any other field the plain text, when both are given.
    const order: ReadonlyArray<'html' | 'text' | 'src' | 'href'> =
      kind === 'text' && !this.isRichtext(binding) ? ['text', 'html'] : keys
    const value = order.map((key) => patch[key]).find((candidate) => candidate !== undefined)
    return { record: value !== undefined ? { [binding.field]: value } : null, rest }
  }

  /** Whether the schema calls a bound field rich text. False until the schema is known. */
  private isRichtext(binding: RecordBinding): boolean {
    return (
      this.state.schema
        ?.find((source) => source.name === binding.source)
        ?.fields.find((field) => field.name === binding.field)?.type === 'richtext'
    )
  }

  /** Merge a patch into a node's override. `undefined` values delete keys. */
  update(rawId: string, patch: NodeOverride, opts: { history?: boolean } = {}) {
    this.updateMany([rawId], patch, opts)
  }

  /** The cell of the state × breakpoint matrix the editor is currently writing to. */
  private get cell(): { state: StyleState; breakpoint: Breakpoint } {
    return { state: this.state.styleState, breakpoint: this.state.breakpoint }
  }

  /** Apply a change to one node's override and commit it. */
  private writeNode(
    rawId: string,
    change: (override: NodeOverride) => NodeOverride,
    opts: { history?: boolean } = {},
  ) {
    // Every style write lands here, so the repeat scope is honoured for styles
    // exactly as it is for content.
    this.editNodes([[rawId, change]], opts)
  }

  /** Set style declarations in the active state and breakpoint. */
  setStyle(id: string, styles: StyleMap, opts: { history?: boolean } = {}) {
    const { state, breakpoint } = this.cell
    this.writeNode(id, (override) => mergeStyles(override, state, breakpoint, styles), opts)
  }

  /**
   * Write declarations on several nodes as one change. Follows the repeat
   * scope like a single write, once per template: the inspector fans a field
   * out over a multi-selection, and two selected cards of one repeat mean one
   * edit to what they share. `redirect: false` is for writes that name each
   * item itself — re-ordering siblings sets each one's own `order`.
   */
  setStyleMany(entries: Array<[string, StyleMap]>, opts: { history?: boolean; redirect?: boolean } = {}) {
    const { state, breakpoint } = this.cell
    this.editNodes(
      this.oncePerTarget(entries, opts.redirect).map(([id, styles]) => [
        id,
        (override) => mergeStyles(override, state, breakpoint, styles),
      ]),
      opts,
    )
  }

  /** The entries whose write targets are distinct, in order, so a template is written once. */
  private oncePerTarget<T>(entries: Array<[string, T]>, redirect: boolean | undefined): Array<[string, T]> {
    if (redirect === false) return entries
    const seen = new Set<string>()
    return entries.filter(([id]) => {
      const target = this.writeTarget(id)
      if (seen.has(target)) return false
      seen.add(target)
      return true
    })
  }

  setDropIndicator(rect: VeditState['dropIndicator']) {
    if (this.state.dropIndicator !== rect) this.set({ dropIndicator: rect })
  }

  /** Replace every declaration in the active cell (used by the CSS editor). */
  setStyleBucket(id: string, styles: StyleMap) {
    const { state, breakpoint } = this.cell
    this.writeNode(id, (override) => replaceStyles(override, state, breakpoint, styles))
  }

  /**
   * Merge someone else's change in. Per node, last write wins: their edit to one
   * element lands without touching yours to another. Not undoable — undo is for
   * your own actions, not other people's.
   */
  applyRemote(patch: {
    nodes?: Record<string, NodeOverride | null>
    inserted?: InsertedNode[]
    tokens?: DesignToken[]
  }) {
    const merge = (doc: VeditDocument): VeditDocument => {
      const next = { ...doc }
      if (patch.nodes) {
        const nodes = { ...next.nodes }
        for (const [id, override] of Object.entries(patch.nodes)) {
          if (override === null) delete nodes[id]
          else nodes[id] = override
        }
        next.nodes = nodes
      }
      if (patch.inserted) next.inserted = patch.inserted
      if (patch.tokens) next.tokens = patch.tokens
      return next
    }
    const mergeEntry = (entry: HistoryEntry): HistoryEntry => ({ ...entry, doc: merge(entry.doc) })

    // Their change is merged into the undo stack as well as the live document.
    // Undo walks back through *your* actions; stepping back should not take
    // someone else's work with it.
    this.set({
      doc: merge(this.state.doc),
      past: this.state.past.map(mergeEntry),
      future: this.state.future.map(mergeEntry),
    })
  }

  /**
   * Apply a batch of document operations — the same vocabulary the HTTP API and
   * the MCP server speak. One undo step for the batch, whatever it contains.
   *
   * Operations are grouped by the document they touch: an insert into a nav that
   * lives in the site document changes the site document, in the same step as
   * whatever the batch did to the page.
   */
  apply(operations: VeditOperation[]): string[] {
    if (!Array.isArray(operations)) throw new OperationError('Expected an array of operations', 0, operations)
    const groups = new Map<DocKey, { operations: VeditOperation[]; positions: number[] }>()
    operations.forEach((operation, index) => {
      const key = this.operationDocKey(operation)
      const group = groups.get(key) ?? { operations: [], positions: [] }
      group.operations.push(operation)
      group.positions.push(index)
      groups.set(key, group)
    })

    const docs = new Map<DocKey, VeditDocument>()
    const changed: string[] = []
    for (const [key, group] of groups) {
      try {
        const result = applyOperations(this.documentAt(key), group.operations)
        docs.set(key, result.doc)
        changed.push(...result.changed)
      } catch (error) {
        // Report the position in the batch the caller sent, not in the group.
        if (error instanceof OperationError) {
          throw new OperationError(error.message, group.positions[error.index] ?? error.index, error.operation)
        }
        throw error
      }
    }
    this.commitDocs(docs)
    return changed
  }

  private operationDocKey(operation: VeditOperation): DocKey {
    if (!operation || typeof operation !== 'object') return null
    switch (operation.op) {
      case 'insert-node':
        return typeof operation.parentId === 'string' ? this.docKeyOf(operation.parentId) : null
      case 'set-token':
      case 'remove-token':
        return null
      default:
        return typeof operation.id === 'string' ? this.docKeyOf(operation.id) : null
    }
  }

  /** Snapshot the document so a drag gesture collapses into one undo step. */
  beginHistory() {
    this.set({ past: [...this.state.past, this.entry()].slice(-HISTORY_LIMIT), future: [] })
  }

  /** Remove a declaration from the active cell, falling back to the site's styling. */
  clearStyle(id: string, property: string) {
    this.clearStyles(id, [property])
  }

  /** Remove several declarations from the active cell in one change. */
  clearStyles(id: string, properties: string[]) {
    this.clearStylesMany([id], properties)
  }

  /** Remove declarations from several nodes at once, for a multi-selection edit; follows the scope. */
  clearStylesMany(ids: string[], properties: string[], opts: { redirect?: boolean } = {}) {
    const { state, breakpoint } = this.cell
    this.editNodes(
      this.oncePerTarget(
        ids.map((id): [string, null] => [id, null]),
        opts.redirect,
      ).map(([id]) => [id, (override) => deleteStyles(override, state, breakpoint, properties)]),
      opts,
    )
  }

  /**
   * Apply a content patch to several nodes at once.
   *
   * A node bound to a record takes its content from the record, so text, rich
   * text, a source or a destination written to it becomes a record edit rather
   * than a document one. That is decided on the node that was clicked, before
   * the repeat scope redirects the write: the binding names one row, and "all
   * cards" has no meaning for it. Whatever is left in the patch — visibility,
   * a class — goes to the document the usual way, in the same undo step.
   */
  updateMany(rawIds: string[], patch: NodeOverride, opts: { history?: boolean } = {}) {
    const records: RecordOperation[] = []
    const entries: Array<[string, (override: NodeOverride) => NodeOverride]> = []
    // Deduplicated: several selected cards of one repeat share a template, so
    // without this the same write would be applied once per selected item.
    const targets = new Set<string>()
    for (const rawId of rawIds) {
      const node = this.registry.get(rawId)
      const binding = node?.binding
      let rest = patch
      if (node && binding) {
        const split = this.splitBound(binding, node.kind, patch)
        rest = split.rest
        if (split.record) records.push({ op: 'set-record', source: binding.source, id: binding.id, data: split.record })
      }
      if (!Object.keys(rest).length) continue
      const target = this.writeTarget(rawId)
      if (targets.has(target)) continue
      targets.add(target)
      entries.push([rawId, (override) => mergeContent(override, rest)])
    }
    const data = records.length ? applyRecordOperations(this.state.data, records) : undefined
    if (entries.length) this.editNodes(entries, { ...opts, data })
    else if (data) this.commitEntry({ data }, opts)
  }

  /** Read a declaration from the active cell. */
  styleValue(id: string, property: string): string | number | undefined {
    const { state, breakpoint } = this.cell
    return readStyleValue(this.docOf(id).nodes[id], state, breakpoint, property)
  }

  /**
   * Record props a component's own `migrate` brought forward.
   *
   * Not an edit: nobody asked for it, so it must not make the document dirty,
   * must not schedule an autosave, and must not land in undo history. Writing it
   * into `saved` as well as `doc` is what keeps all three true — the page now
   * holds the migrated shape, and it goes to the backend the next time someone
   * saves for their own reasons. Opening a page must never write to it.
   */
  stageMigratedProps(id: string, props: Record<string, unknown>, version: number) {
    const key = this.docKeyOf(id)
    const override = this.documentAt(key).nodes[id] ?? {}
    if (override.propsVersion === version) return
    const next: NodeOverride = { ...override, props, propsVersion: version }
    const write = (doc: VeditDocument): VeditDocument => ({ ...doc, nodes: { ...doc.nodes, [id]: next } })
    if (key === null) {
      this.set({ doc: write(this.state.doc), saved: write(this.state.saved) })
      return
    }
    this.set({
      shared: { ...this.state.shared, [key]: write(this.documentAt(key)) },
      sharedSaved: { ...this.state.sharedSaved, [key]: write(this.state.sharedSaved[key] ?? emptyDocument(key)) },
    })
  }

  /** Set one of the props a component declared as editable. */
  setProp(id: string, name: string, value: unknown) {
    this.writeNode(id, (override) => {
      const props = { ...override.props }
      if (value === undefined) delete props[name]
      else props[name] = value
      return { ...override, props }
    })
  }

  /* ---------------------------------------------------------------- tokens */

  /** Create a named value. Returns the token, whose id is a slug of the name. */
  addToken(token: Omit<DesignToken, 'id'> & { id?: string }): DesignToken {
    const tokens = this.state.doc.tokens ?? []
    const base = (token.id ?? token.name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'token'
    let id = base
    let suffix = 2
    while (tokens.some((existing) => existing.id === id)) id = `${base}-${suffix++}`
    const created: DesignToken = { ...token, id }
    this.commit({ ...this.state.doc, tokens: [...tokens, created] })
    return created
  }

  updateToken(id: string, patch: Partial<Omit<DesignToken, 'id'>>) {
    const tokens = (this.state.doc.tokens ?? []).map((token) =>
      token.id === id ? { ...token, ...patch } : token,
    )
    this.commit({ ...this.state.doc, tokens })
  }

  removeToken(id: string) {
    const tokens = (this.state.doc.tokens ?? []).filter((token) => token.id !== id)
    this.commit({ ...this.state.doc, tokens })
  }

  /** Drop every override for a node, and anything the editor placed inside it. */
  reset(id: string) {
    this.apply([{ op: 'reset-node', id }])
  }

  /**
   * Place something inside a container: a primitive, or one of the components the
   * host registered. Goes through the same operation the API and MCP use, so
   * there is one definition of what inserting means.
   */
  insert(
    parentId: string,
    kind: InsertedNode['kind'],
    options: { component?: string; index?: number; shape?: ShapeSpec } = {},
  ): string {
    const key = this.docKeyOf(parentId)
    const { doc, created } = applyOperations(this.documentAt(key), [
      {
        op: 'insert-node',
        parentId,
        kind,
        component: options.component,
        shape: options.shape,
        index: options.index,
      },
    ])
    this.commitDocs(new Map([[key, doc]]))
    const id = created[0]
    this.select(id)
    return id
  }

  /** Copy an inserted element, styles and all, right after the original. */
  duplicateInserted(id: string): string | null {
    const placed = this.findInserted(id)
    if (!placed) return null
    const { key, node: source } = placed
    const doc = this.documentAt(key)
    const copyId = newInsertedId(source.parentId)
    const inserted = doc.inserted.map((node) =>
      node.parentId === source.parentId && node.index > source.index
        ? { ...node, index: node.index + 1 }
        : node,
    )
    inserted.push({ ...source, id: copyId, index: source.index + 1 })
    const nodes = { ...doc.nodes, [copyId]: clone(doc.nodes[id] ?? {}) }
    this.commitDocs(new Map([[key, { ...doc, nodes, inserted }]]))
    this.select(copyId)
    return copyId
  }

  /** Move an inserted element into a different container, or along its siblings. */
  moveInserted(id: string, parentId?: string, index?: number) {
    this.apply([{ op: 'move-node', id, parentId, index }])
  }

  /** Shift an inserted element one place earlier or later among its siblings. */
  nudgeOrder(id: string, delta: number) {
    const node = this.findInserted(id)?.node
    if (!node) return
    this.apply([{ op: 'move-node', id, index: Math.max(0, node.index + delta) }])
  }

  removeInserted(id: string) {
    this.apply([{ op: 'remove-node', id }])
    this.set({ selection: this.state.selection.filter((s) => s !== id) })
  }

  insertedFor(parentId: string): InsertedNode[] {
    return this.docOf(parentId).inserted
      .filter((n) => n.parentId === parentId)
      .sort((a, b) => a.index - b.index)
  }

  /* --------------------------------------------------------------- records */

  /** True when the site has given the editor somewhere to keep records. */
  get supportsContent(): boolean {
    return this.content !== null
  }

  /**
   * Whether this person may do something. Without a content client there is
   * nobody to ask, so everything is allowed; with one, nothing is until the
   * capabilities have been fetched.
   */
  can(action: Capability): boolean {
    if (!this.content) return true
    const can = this.state.capabilities?.can
    if (!can) return false
    switch (action) {
      case 'write':
        return can.write
      case 'publish':
        return can.publish
      case 'upload':
        return can.upload
      case 'data:write':
        return can.data.write
      case 'data:delete':
        return can.data.delete
    }
  }

  /** Fold record operations into the pending changes, as one undo step. */
  applyRecords(operations: RecordOperation[]) {
    this.commitEntry({ data: applyRecordOperations(this.state.data, operations) })
  }

  setRecord(source: string, id: string, patch: Record<string, unknown>) {
    this.applyRecords([{ op: 'set-record', source, id, data: patch }])
  }

  /** Add a record; the id is temporary until Save, when the server picks a real one. */
  createRecord(source: string, data: Record<string, unknown> = {}): string {
    const id = newRecordId()
    this.applyRecords([{ op: 'create-record', source, id, data }])
    return id
  }

  deleteRecord(source: string, id: string) {
    this.applyRecords([{ op: 'delete-record', source, id }])
  }

  reorderRecords(source: string, order: string[]) {
    this.applyRecords([{ op: 'reorder-records', source, order }])
  }

  /** What a bound node shows right now: the pending edit if there is one, else the fetched row. */
  recordValue(binding: RecordBinding): unknown {
    const { source, id, field } = binding
    const entry = this.state.data[source]
    if (entry?.delete?.includes(id)) return undefined
    const created = entry?.create?.find((record) => record.id === id)
    if (created) return created[field]
    const patch = entry?.update?.[id]
    if (patch && field in patch) return patch[field]
    return this.state.records[source]?.find((record) => record.id === id)?.[field]
  }

  /** The rows of a source with the pending changes applied. */
  recordsFor(source: string, rows?: VeditRecord[]): VeditRecord[] {
    const schema = this.state.schema?.find((candidate) => candidate.name === source)
    return overlayChanges(source, rows ?? this.state.records[source] ?? [], this.state.data, schema)
  }

  /**
   * Fetch a source's rows and keep them. Editors read the draft so the page shows
   * what they last saved; anyone else reads what is live.
   */
  async loadRecords(source: string, query: RecordQuery = {}): Promise<VeditRecord[]> {
    if (!this.content) return this.recordsFor(source)
    const stage: DocumentStage = this.can('write') ? 'draft' : 'published'
    const rows = await this.content.list(source, { ...query, stage })
    // The query keeps its own rows; the source as a whole learns every row any
    // query has seen, the fresher copy winning, so a bound node can still look
    // a record up by id whatever page it was fetched for.
    const known = new Map((this.state.records[source] ?? []).map((row) => [row.id, row]))
    for (const row of rows) known.set(row.id, row)
    this.set({
      records: { ...this.state.records, [source]: [...known.values()] },
      recordSets: { ...this.state.recordSets, [recordSetKey(source, query)]: rows },
    })
    return this.recordsFor(source, rows)
  }

  /** The rows one query fetched, with the pending changes applied; undefined until it has. */
  recordSet(source: string, query: RecordQuery = {}): VeditRecord[] | undefined {
    const rows = this.state.recordSets[recordSetKey(source, query)]
    return rows && this.recordsFor(source, rows)
  }

  /**
   * Fetch a source once, for a bound node that nothing else feeds — a tagline
   * bound to a global, say, on a page that never calls `useVeditRecords`. Every
   * such node on the page shares one request, and a failure is not retried:
   * the node keeps showing its own children, which is the fallback anyway.
   */
  ensureRecords(source: string): void {
    if (!this.content || source in this.state.records || this.pendingSources.has(source)) return
    this.pendingSources.add(source)
    void this.loadRecords(source).catch(() => undefined)
  }

  async loadSchema(): Promise<SourceSchema[]> {
    if (!this.content) return []
    const schema = await this.content.schema()
    this.set({ schema })
    return schema
  }

  async refreshCapabilities(): Promise<VeditCapabilities | null> {
    if (!this.content) return null
    const capabilities = await this.content.capabilities()
    this.set({
      capabilities,
      auth: capabilities.user ? 'ok' : capabilities.login ? 'required' : 'none',
    })
    return capabilities
  }

  async login(email: string, password: string) {
    if (!this.content?.login) throw new Error('This site cannot sign you in')
    await this.content.login(email, password)
    await this.refreshCapabilities()
  }

  async logout() {
    if (!this.content) return
    await this.content.logout?.()
    await this.refreshCapabilities()
  }

  /* --------------------------------------------------------------- history */

  undo() {
    const previous = this.state.past.at(-1)
    if (!previous) return
    this.set({
      doc: previous.doc,
      data: previous.data,
      shared: previous.shared,
      past: this.state.past.slice(0, -1),
      future: [this.entry(), ...this.state.future].slice(0, HISTORY_LIMIT),
    })
    this.scheduleAutosave()
  }

  redo() {
    const next = this.state.future[0]
    if (!next) return
    this.set({
      doc: next.doc,
      data: next.data,
      shared: next.shared,
      past: [...this.state.past, this.entry()].slice(-HISTORY_LIMIT),
      future: this.state.future.slice(1),
    })
    this.scheduleAutosave()
  }

  get hasRecordChanges(): boolean {
    return Object.keys(this.state.data).length > 0
  }

  get dirty(): boolean {
    if (this.hasRecordChanges) return true
    if (differs(this.state.doc, this.state.saved)) return true
    return this.sharedKeys.some((key) => differs(this.documentAt(key), this.state.sharedSaved[key]))
  }

  /** True while something saved has not reached visitors: a document, or committed records. */
  get unpublished(): boolean {
    if (this.state.doc !== this.state.published) return true
    if (Object.keys(this.state.pendingPublish).length) return true
    return this.sharedKeys.some((key) => this.state.shared[key] !== this.state.sharedPublished[key])
  }

  /* ------------------------------------------------------------ persistence */

  /** True when the adapter keeps a draft separate from what visitors see. */
  get supportsPublishing(): boolean {
    return typeof this.adapter.publish === 'function'
  }

  get supportsHistory(): boolean {
    return typeof this.adapter.listVersions === 'function'
  }

  async load(stage: DocumentStage = 'published') {
    this.set({ status: 'loading', error: null })
    const before = this.state.doc
    const sharedBefore = this.state.shared
    try {
      const loaded = await this.adapter.load(this.state.doc.key, { stage })
      if (loaded == null) {
        this.set({ saved: this.state.doc, status: 'ready', past: [], future: [] })
      } else {
        this.adopt(loaded, before)
      }
    } catch (error) {
      this.set({ status: 'error', error: error instanceof Error ? error.message : String(error) })
      return
    }
    await this.loadSite(stage, sharedBefore)
  }

  /**
   * The rest of what a page needs besides its own document: the shared documents
   * and, with a content client, who this person is. Separate from `load` so a
   * page rendered with `initialDocument` can still fetch them.
   */
  async loadSite(stage: DocumentStage = 'published', before: Record<string, VeditDocument> = this.state.shared) {
    if (this.sharedKeys.length) {
      try {
        const loaded: Record<string, VeditDocument> = {}
        for (const key of this.sharedKeys) {
          const doc = await this.adapter.load(key, { stage })
          loaded[key] = doc == null ? emptyDocument(key) : this.inspect(doc, key)
        }
        // A slow backend and a quick first click: whatever was edited while
        // the documents were on their way sits on top of what arrived.
        const shared = { ...this.state.shared }
        for (const key of this.sharedKeys) shared[key] = rebase(loaded[key], before[key], this.state.shared[key])
        this.set({ shared, sharedSaved: { ...this.state.sharedSaved, ...loaded } })
      } catch (error) {
        this.set({ status: 'error', error: error instanceof Error ? error.message : String(error) })
        return
      }
    }
    if (!this.content) return
    // The schema comes with the capabilities, for the visitor as much as the
    // editor: a bound rich-text field renders as markup only once the page knows
    // it is one, and a visitor never opens the panel that would otherwise ask.
    // Its failure is a warning, not the page's error — the rows still render.
    const schema = this.state.schema
      ? Promise.resolve()
      : this.loadSchema().then(
          () => undefined,
          (error: unknown) => warnOnce('schema', 'could not load the content schema', error),
        )
    try {
      await Promise.all([this.refreshCapabilities(), schema])
    } catch (error) {
      // The page itself loaded; only the question of who is editing went
      // unanswered, so the editor stays closed rather than the page erroring.
      this.set({ capabilities: null, auth: 'none', error: error instanceof Error ? error.message : String(error) })
    }
  }

  /** Replace the working document, e.g. from a server-rendered payload. */
  hydrate(doc: VeditDocument) {
    this.adopt(doc)
  }

  /**
   * Take a document that came from somewhere else — storage, a server render, a
   * version restore — as the working copy. Everything from outside goes through
   * `inspectDocument` first: stored data is older than the code reading it, and a
   * document from a newer build is something the editor has to say out loud rather
   * than quietly overwrite.
   */
  private adopt(incoming: unknown, before: VeditDocument = this.state.doc) {
    const loaded = this.inspect(incoming, this.state.doc.key)
    const doc = rebase(loaded, before, this.state.doc)
    this.set({ doc, saved: loaded, status: 'ready', past: [], future: [] })
  }

  private inspect(incoming: unknown, key: string): VeditDocument {
    const report = inspectDocument(incoming, key)
    if (report.warnings.length) {
      this.notify(report.future ? report.warnings[0] : `Repaired the stored document: ${report.warnings.join(' ')}`)
    }
    return report.doc.key === key ? report.doc : { ...report.doc, key }
  }

  /**
   * Records go first, because the document may refer to rows that do not exist
   * yet: a style on a card added this session is keyed by a temporary id, and
   * only the server's answer says what to call it. A commit that fails leaves the
   * changes where they are, so trying again sends them once and not twice.
   */
  async save() {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer)
    this.set({ status: 'saving', error: null })
    try {
      if (this.content && this.hasRecordChanges) {
        const stage: DocumentStage = this.can('publish') ? 'draft' : 'published'
        const data = this.state.data
        const result = await this.content.commit(data, { stage })
        this.remapAfterCommit(data, result.idMap, stage)
      }
      const pending = this.documents().filter(({ key, doc }) => differs(doc, this.savedFor(key)))
      for (const { doc } of pending) await this.adapter.save(doc)
      const patch: Partial<VeditState> = { status: 'ready' }
      const sharedSaved = { ...this.state.sharedSaved }
      for (const { key, doc } of pending) {
        if (key === this.state.doc.key) patch.saved = doc
        else sharedSaved[key] = doc
      }
      patch.sharedSaved = sharedSaved
      this.set(patch)
      this.notify('Changes saved')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.set({ status: 'error', error: message })
      this.notify(message)
      throw error
    }
  }

  private savedFor(key: string): VeditDocument | undefined {
    return key === this.state.doc.key ? this.state.saved : this.state.sharedSaved[key]
  }

  /**
   * Rename every temporary record id the server has now replaced, and fold what
   * was committed into the rows already fetched. The pending changes are cleared
   * here, so without this the page would fall back to the rows as they were
   * before the edit until they were loaded again: a title typed into a card
   * would revert the moment Save finished.
   */
  private remapAfterCommit(committed: RecordChanges, idMap: Record<string, string>, stage: DocumentStage) {
    const rename = (id: string) => idMap[id] ?? id
    const renameItem = (id: string) => {
      const parsed = parseItemId(id)
      return parsed && parsed.key in idMap ? itemId(parsed.templateId, rename(parsed.key)) : id
    }
    const mapDocs = (docs: Record<string, VeditDocument>) => {
      const next: Record<string, VeditDocument> = {}
      for (const [key, doc] of Object.entries(docs)) next[key] = remapIds(doc, idMap)
      return next
    }
    const mapEntry = (entry: HistoryEntry): HistoryEntry => ({
      doc: remapIds(entry.doc, idMap),
      data: remapIds(entry.data, idMap),
      shared: mapDocs(entry.shared),
    })

    const changes = remapIds(committed, idMap)
    const pendingPublish = { ...this.state.pendingPublish }
    if (stage === 'draft') {
      for (const [source, entry] of Object.entries(changes)) {
        const ids = new Set(pendingPublish[source] ?? [])
        for (const record of entry.create ?? []) ids.add(record.id)
        for (const id of Object.keys(entry.update ?? {})) ids.add(id)
        for (const id of entry.delete ?? []) ids.add(id)
        for (const id of entry.order ?? []) ids.add(id)
        pendingPublish[source] = [...ids]
      }
    }

    // Only sources already fetched: a source nothing on this page has loaded
    // has no rows to fold into, and a created row on its own would be mistaken
    // for the whole source. The rows keep what the server told us on read —
    // `_status` and the like are its to say, not guessed here.
    const records = { ...this.state.records }
    const recordSets = { ...this.state.recordSets }
    for (const source of Object.keys(changes)) {
      const rows = records[source]
      if (!rows) continue
      const schema = this.state.schema?.find((candidate) => candidate.name === source)
      records[source] = overlayChanges(source, rows, changes, schema)
      for (const key of Object.keys(recordSets)) {
        if (recordSetSource(key) === source) recordSets[key] = overlayChanges(source, recordSets[key], changes, schema)
      }
    }

    this.set({
      data: {},
      records,
      recordSets,
      pendingPublish,
      doc: remapIds(this.state.doc, idMap),
      saved: remapIds(this.state.saved, idMap),
      published: this.state.published ? remapIds(this.state.published, idMap) : null,
      shared: mapDocs(this.state.shared),
      sharedSaved: mapDocs(this.state.sharedSaved),
      sharedPublished: mapDocs(this.state.sharedPublished),
      past: this.state.past.map(mapEntry),
      future: this.state.future.map(mapEntry),
      selection: this.state.selection.map(renameItem),
      hovered: this.state.hovered ? renameItem(this.state.hovered) : null,
      inlineEditing: this.state.inlineEditing ? renameItem(this.state.inlineEditing) : null,
    })
  }

  /** Make the saved draft the one visitors see. */
  async publish() {
    if (!this.adapter.publish) throw new Error('This adapter cannot publish')
    if (this.dirty) await this.save()
    this.set({ status: 'saving', error: null })
    try {
      let published = this.state.published
      const sharedPublished = { ...this.state.sharedPublished }
      for (const { key, doc } of this.documents()) {
        const live = key === this.state.doc.key ? published : sharedPublished[key]
        if (doc === live) continue
        await this.adapter.publish(doc)
        if (key === this.state.doc.key) published = doc
        else sharedPublished[key] = doc
      }
      const pending = this.state.pendingPublish
      if (this.content?.publish && Object.keys(pending).length) await this.content.publish(pending)
      this.set({ status: 'ready', published, sharedPublished, pendingPublish: {} })
      this.notify('Published — visitors see this now')
    } catch (error) {
      this.set({ status: 'error', error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }

  async listVersions(): Promise<VeditVersion[]> {
    return this.adapter.listVersions ? this.adapter.listVersions(this.state.doc.key) : []
  }

  /** Load an earlier version into the editor, ready to review and save. */
  async restoreVersion(versionId: string) {
    if (!this.adapter.loadVersion) return
    const loaded = await this.adapter.loadVersion(this.state.doc.key, versionId)
    if (!loaded) throw new Error('That version could not be loaded')
    const doc = inspectDocument(loaded, this.state.doc.key).doc
    this.set({
      doc: { ...doc, key: this.state.doc.key },
      past: [...this.state.past, this.entry()].slice(-HISTORY_LIMIT),
      future: [],
    })
    this.notify('Version restored — save to keep it')
  }

  discard() {
    this.set({
      doc: this.state.saved,
      data: {},
      shared: { ...this.state.sharedSaved },
      past: [],
      future: [],
      selection: [],
    })
  }

  private scheduleAutosave() {
    if (!this.autosaveMs) return
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer)
    this.autosaveTimer = setTimeout(() => {
      void this.save().catch(() => undefined)
    }, this.autosaveMs)
  }

  /**
   * Store a file the editor picked and hand back where it now lives, or null
   * when this site has nowhere to put it. Images always have somewhere: an
   * adapter without any upload gets a data URL, which is small enough to live in
   * the document. A PDF is not, so without a real store a file is refused and
   * the editor is told why rather than handed a 4 MB href.
   */
  async uploadAsset(file: File, { kind }: { kind: 'image' | 'file' | 'video' }): Promise<VeditAsset | null> {
    if (this.adapter.uploadAsset) {
      return this.adapter.uploadAsset(file, { accept: kind === 'image' ? ['image/*'] : undefined })
    }
    if (kind !== 'image') {
      this.notify('This site cannot store files')
      return null
    }
    const url = this.adapter.uploadImage ? await this.adapter.uploadImage(file) : await fileToDataUrl(file)
    return { url, kind, name: file.name, mime: file.type, size: file.size }
  }

  async uploadImage(file: File): Promise<string> {
    const asset = await this.uploadAsset(file, { kind: 'image' })
    if (!asset) throw new Error('This site cannot store images')
    return asset.url
  }

  canUpload(kind: 'image' | 'file' | 'video'): boolean {
    return typeof this.adapter.uploadAsset === 'function' || kind === 'image'
  }

  async listAssets(opts?: { kind?: 'image' | 'file' | 'video'; query?: string }): Promise<VeditAsset[]> {
    return this.adapter.listAssets ? this.adapter.listAssets(opts) : []
  }

  get canListAssets(): boolean {
    return typeof this.adapter.listAssets === 'function'
  }

  /* ------------------------------------------------------------------- ui */

  /** Flash a short message in the editor, e.g. to explain why nothing happened. */
  notify(message: string | null) {
    if (this.noticeTimer) clearTimeout(this.noticeTimer)
    this.set({ notice: message })
    if (message) {
      this.noticeTimer = setTimeout(() => this.set({ notice: null }), 3200)
    }
  }

  setEditing(editing: boolean) {
    this.set({ editing, selection: [], hovered: null, inlineEditing: null })
  }

  select(id: string | null, opts: { additive?: boolean } = {}) {
    if (id === null) return this.set({ selection: [], inlineEditing: null })
    if (opts.additive) {
      const selection = this.state.selection.includes(id)
        ? this.state.selection.filter((s) => s !== id)
        : [...this.state.selection, id]
      return this.set({ selection, inlineEditing: null })
    }
    this.set({ selection: [id], inlineEditing: null })
  }

  hover(id: string | null) {
    if (this.state.hovered !== id) this.set({ hovered: id })
  }

  setBreakpoint(breakpoint: Breakpoint) {
    this.set({ breakpoint })
  }

  setStyleState(styleState: StyleState) {
    this.set({ styleState })
  }

  setPendingComment(pendingComment: VeditState['pendingComment']) {
    this.set({ pendingComment, openComment: null })
  }

  setOpenComment(openComment: string | null) {
    this.set({ openComment, pendingComment: null })
  }

  setTool(tool: EditorTool) {
    this.set({ tool })
  }

  setInlineEditing(id: string | null) {
    this.set({ inlineEditing: id })
  }

  kindOf(id: string): NodeKind {
    const registered = this.getNode(id)
    if (registered) return registered.kind
    return this.findInserted(id)?.node.kind ?? 'box'
  }
}

/** Merge a content patch into an override; `undefined` values delete keys. */
function mergeContent(current: NodeOverride, patch: NodeOverride): NodeOverride {
  const merged: NodeOverride = { ...current, ...patch }
  if (patch.style) merged.style = { ...current.style, ...patch.style }
  if (patch.responsive) {
    merged.responsive = { ...current.responsive }
    for (const [bp, styles] of Object.entries(patch.responsive)) {
      const key = bp as Exclude<Breakpoint, 'base'>
      merged.responsive[key] = { ...current.responsive?.[key], ...styles }
    }
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete (merged as Record<string, unknown>)[key]
  }
  return merged
}

/**
 * `loaded` with the edits made between `before` and `edited` laid on top: a
 * node written meanwhile keeps its written form, everything else is what the
 * backend holds. Nothing was edited → exactly what was loaded.
 */
function rebase(loaded: VeditDocument, before: VeditDocument | undefined, edited: VeditDocument | undefined): VeditDocument {
  if (!edited || !before || edited === before) return loaded
  const nodes = { ...loaded.nodes }
  const ids = new Set([...Object.keys(before.nodes), ...Object.keys(edited.nodes)])
  let touched = false
  for (const id of ids) {
    if (edited.nodes[id] === before.nodes[id]) continue
    touched = true
    if (edited.nodes[id] === undefined) delete nodes[id]
    else nodes[id] = edited.nodes[id]
  }
  const inserted = edited.inserted !== before.inserted ? edited.inserted : loaded.inserted
  const tokens = edited.tokens !== before.tokens ? edited.tokens : loaded.tokens
  if (!touched && inserted === loaded.inserted && tokens === loaded.tokens) return loaded
  return { ...loaded, nodes, inserted, tokens }
}

function differs(a: VeditDocument | undefined, b: VeditDocument | undefined): boolean {
  if (a === b) return false
  if (!a || !b) return true
  return JSON.stringify(stripTimestamp(a)) !== JSON.stringify(stripTimestamp(b))
}

function stripTimestamp(doc: VeditDocument) {
  const { updatedAt: _updatedAt, ...rest } = doc
  return rest
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'))
    reader.readAsDataURL(file)
  })
}

/** `source` plus the query that fetched it, stable across renders that rebuild the objects. */
export function recordSetKey(source: string, query: RecordQuery = {}): string {
  const { where, orderBy, populate } = query
  const parts: string[] = []
  if (where && Object.keys(where).length) {
    parts.push(`where=${JSON.stringify(Object.fromEntries(Object.entries(where).sort(([a], [b]) => a.localeCompare(b))))}`)
  }
  if (orderBy) parts.push(`orderBy=${orderBy}`)
  if (populate?.length) parts.push(`populate=${[...populate].sort().join(',')}`)
  return parts.length ? `${source}?${parts.join('&')}` : source
}

function recordSetSource(key: string): string {
  const at = key.indexOf('?')
  return at === -1 ? key : key.slice(0, at)
}
