import type { RealtimeSession } from './session'
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
  type InsertedNode,
  type NodeKind,
  type NodeOverride,
  type RegisteredNode,
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
  /** Exposed so the provider can hand the same adapter to the realtime session. */
  readonly adapter: VeditAdapter
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

  constructor(opts: { key: string; adapter: VeditAdapter; autosaveMs?: number }) {
    const doc = emptyDocument(opts.key)
    this.adapter = opts.adapter
    this.autosaveMs = opts.autosaveMs ?? 0
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
      notice: null,
      dropIndicator: null,
      past: [],
      future: [],
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

  /* ------------------------------------------------------------------- doc */

  private commit(doc: VeditDocument, opts: { history?: boolean } = {}) {
    const history = opts.history !== false
    const past = history ? [...this.state.past, this.state.doc].slice(-HISTORY_LIMIT) : this.state.past
    this.set({
      doc: { ...doc, updatedAt: new Date().toISOString() },
      past,
      future: history ? [] : this.state.future,
    })
    this.scheduleAutosave()
  }

  getOverride(id: string): NodeOverride {
    return this.state.doc.nodes[id] ?? {}
  }

  /** Merge a patch into a node's override. `undefined` values delete keys. */
  update(id: string, patch: NodeOverride, opts: { history?: boolean } = {}) {
    const current = this.getOverride(id)
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
    const nodes = { ...this.state.doc.nodes }
    const pruned = pruneOverride(merged)
    if (pruned) nodes[id] = pruned
    else delete nodes[id]
    this.commit({ ...this.state.doc, nodes }, opts)
  }

  /** The cell of the state × breakpoint matrix the editor is currently writing to. */
  private get cell(): { state: StyleState; breakpoint: Breakpoint } {
    return { state: this.state.styleState, breakpoint: this.state.breakpoint }
  }

  /** Apply a change to one node's override and commit it. */
  private writeNode(
    id: string,
    change: (override: NodeOverride) => NodeOverride,
    opts: { history?: boolean } = {},
  ) {
    const nodes = { ...this.state.doc.nodes }
    const pruned = pruneOverride(change(clone(nodes[id] ?? {})))
    if (pruned) nodes[id] = pruned
    else delete nodes[id]
    this.commit({ ...this.state.doc, nodes }, opts)
  }

  /** Set style declarations in the active state and breakpoint. */
  setStyle(id: string, styles: StyleMap, opts: { history?: boolean } = {}) {
    const { state, breakpoint } = this.cell
    this.writeNode(id, (override) => mergeStyles(override, state, breakpoint, styles), opts)
  }

  /** Write declarations on several nodes as one change, e.g. re-ordering siblings. */
  setStyleMany(entries: Array<[string, StyleMap]>, opts: { history?: boolean } = {}) {
    const { state, breakpoint } = this.cell
    const nodes = { ...this.state.doc.nodes }
    for (const [id, styles] of entries) {
      const pruned = pruneOverride(mergeStyles(clone(nodes[id] ?? {}), state, breakpoint, styles))
      if (pruned) nodes[id] = pruned
      else delete nodes[id]
    }
    this.commit({ ...this.state.doc, nodes }, opts)
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

    // Their change is merged into the undo stack as well as the live document.
    // Undo walks back through *your* actions; stepping back should not take
    // someone else's work with it.
    this.set({
      doc: merge(this.state.doc),
      past: this.state.past.map(merge),
      future: this.state.future.map(merge),
    })
  }

  /** Snapshot the document so a drag gesture collapses into one undo step. */
  beginHistory() {
    this.set({ past: [...this.state.past, this.state.doc].slice(-HISTORY_LIMIT), future: [] })
  }

  /** Remove a declaration from the active cell, falling back to the site's styling. */
  clearStyle(id: string, property: string) {
    this.clearStyles(id, [property])
  }

  /** Remove several declarations from the active cell in one change. */
  clearStyles(id: string, properties: string[]) {
    this.clearStylesMany([id], properties)
  }

  /** Remove declarations from several nodes at once, for a multi-selection edit. */
  clearStylesMany(ids: string[], properties: string[]) {
    const { state, breakpoint } = this.cell
    const nodes = { ...this.state.doc.nodes }
    for (const id of ids) {
      const pruned = pruneOverride(deleteStyles(clone(nodes[id] ?? {}), state, breakpoint, properties))
      if (pruned) nodes[id] = pruned
      else delete nodes[id]
    }
    this.commit({ ...this.state.doc, nodes })
  }

  /** Apply a content patch to several nodes at once. */
  updateMany(ids: string[], patch: NodeOverride) {
    const nodes = { ...this.state.doc.nodes }
    for (const id of ids) {
      const merged: NodeOverride = { ...(nodes[id] ?? {}), ...patch }
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete (merged as Record<string, unknown>)[key]
      }
      const pruned = pruneOverride(merged)
      if (pruned) nodes[id] = pruned
      else delete nodes[id]
    }
    this.commit({ ...this.state.doc, nodes })
  }

  /** Read a declaration from the active cell. */
  styleValue(id: string, property: string): string | number | undefined {
    const { state, breakpoint } = this.cell
    return readStyleValue(this.state.doc.nodes[id], state, breakpoint, property)
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

  /** Drop every override for a node. */
  reset(id: string) {
    const nodes = { ...this.state.doc.nodes }
    delete nodes[id]
    const inserted = this.state.doc.inserted.filter((n) => n.id !== id)
    this.commit({ ...this.state.doc, nodes, inserted })
  }

  insert(parentId: string, kind: InsertedNode['kind']): string {
    const id = `${parentId}::added-${Math.random().toString(36).slice(2, 8)}`
    const siblings = this.state.doc.inserted.filter((n) => n.parentId === parentId)
    const node: InsertedNode = { id, parentId, kind, index: siblings.length }
    const defaults: Record<InsertedNode['kind'], NodeOverride> = {
      text: { text: 'New text', style: { fontSize: '16px', color: 'inherit' } },
      image: {
        src: 'https://placehold.co/600x400/e2e8f0/64748b?text=Image',
        alt: '',
        style: { width: '100%', height: 'auto' },
      },
      box: { style: { minHeight: '96px', background: '#f1f5f9', borderRadius: '8px' } },
      button: { text: 'Button', href: '#', style: {} },
      link: { text: 'Link', href: '#' },
    }
    const nodes = { ...this.state.doc.nodes, [id]: defaults[kind] }
    this.commit({ ...this.state.doc, nodes, inserted: [...this.state.doc.inserted, node] })
    this.select(id)
    return id
  }

  /** Copy an inserted element, styles and all, right after the original. */
  duplicateInserted(id: string): string | null {
    const source = this.state.doc.inserted.find((node) => node.id === id)
    if (!source) return null
    const copyId = `${source.parentId}::added-${Math.random().toString(36).slice(2, 8)}`
    const inserted = this.state.doc.inserted.map((node) =>
      node.parentId === source.parentId && node.index > source.index
        ? { ...node, index: node.index + 1 }
        : node,
    )
    inserted.push({ ...source, id: copyId, index: source.index + 1 })
    const nodes = { ...this.state.doc.nodes, [copyId]: clone(this.getOverride(id)) }
    this.commit({ ...this.state.doc, nodes, inserted })
    this.select(copyId)
    return copyId
  }

  /** Move an inserted element into a different container. */
  moveInserted(id: string, parentId: string) {
    const inserted = this.state.doc.inserted.map((node) =>
      node.id === id
        ? { ...node, parentId, index: this.state.doc.inserted.filter((n) => n.parentId === parentId).length }
        : node,
    )
    this.commit({ ...this.state.doc, inserted })
  }

  removeInserted(id: string) {
    const inserted = this.state.doc.inserted.filter((n) => n.id !== id)
    const nodes = { ...this.state.doc.nodes }
    delete nodes[id]
    this.commit({ ...this.state.doc, nodes, inserted })
    this.set({ selection: this.state.selection.filter((s) => s !== id) })
  }

  insertedFor(parentId: string): InsertedNode[] {
    return this.state.doc.inserted
      .filter((n) => n.parentId === parentId)
      .sort((a, b) => a.index - b.index)
  }

  /* --------------------------------------------------------------- history */

  undo() {
    const previous = this.state.past.at(-1)
    if (!previous) return
    this.set({
      doc: previous,
      past: this.state.past.slice(0, -1),
      future: [this.state.doc, ...this.state.future].slice(0, HISTORY_LIMIT),
    })
    this.scheduleAutosave()
  }

  redo() {
    const next = this.state.future[0]
    if (!next) return
    this.set({
      doc: next,
      past: [...this.state.past, this.state.doc].slice(-HISTORY_LIMIT),
      future: this.state.future.slice(1),
    })
    this.scheduleAutosave()
  }

  get dirty(): boolean {
    return JSON.stringify(stripTimestamp(this.state.doc)) !== JSON.stringify(stripTimestamp(this.state.saved))
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
    try {
      const loaded = await this.adapter.load(this.state.doc.key, { stage })
      const doc = loaded ? { ...emptyDocument(this.state.doc.key), ...loaded } : this.state.doc
      this.set({ doc, saved: doc, status: 'ready', past: [], future: [] })
    } catch (error) {
      this.set({ status: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  }

  /** Replace the working document, e.g. from a server-rendered payload. */
  hydrate(doc: VeditDocument) {
    this.set({ doc, saved: doc, status: 'ready', past: [], future: [] })
  }

  async save() {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer)
    const doc = this.state.doc
    this.set({ status: 'saving', error: null })
    try {
      await this.adapter.save(doc)
      this.set({ saved: doc, status: 'ready' })
      this.notify('Changes saved')
    } catch (error) {
      this.set({ status: 'error', error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }

  /** Make the saved draft the one visitors see. */
  async publish() {
    if (!this.adapter.publish) throw new Error('This adapter cannot publish')
    if (this.dirty) await this.save()
    this.set({ status: 'saving', error: null })
    try {
      await this.adapter.publish(this.state.doc)
      this.set({ status: 'ready', published: this.state.doc })
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
    const doc = await this.adapter.loadVersion(this.state.doc.key, versionId)
    if (!doc) throw new Error('That version could not be loaded')
    this.set({
      doc: { ...doc, key: this.state.doc.key },
      past: [...this.state.past, this.state.doc].slice(-HISTORY_LIMIT),
      future: [],
    })
    this.notify('Version restored — save to keep it')
  }

  discard() {
    this.set({ doc: this.state.saved, past: [], future: [], selection: [] })
  }

  private scheduleAutosave() {
    if (!this.autosaveMs) return
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer)
    this.autosaveTimer = setTimeout(() => {
      void this.save().catch(() => undefined)
    }, this.autosaveMs)
  }

  async uploadImage(file: File): Promise<string> {
    if (this.adapter.uploadImage) return this.adapter.uploadImage(file)
    return await fileToDataUrl(file)
  }

  async listAssets(): Promise<VeditAsset[]> {
    return this.adapter.listAssets ? this.adapter.listAssets() : []
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
    const inserted = this.state.doc.inserted.find((n) => n.id === id)
    return inserted?.kind ?? 'box'
  }
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
