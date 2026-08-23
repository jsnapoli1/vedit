import {
  emptyDocument,
  type Breakpoint,
  type EditorTool,
  type InsertedNode,
  type NodeKind,
  type NodeOverride,
  type RegisteredNode,
  type StyleMap,
  type VeditAdapter,
  type VeditDocument,
  type VeditState,
} from './types'

const HISTORY_LIMIT = 100

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function pruneEmpty(override: NodeOverride): NodeOverride | undefined {
  const next: NodeOverride = { ...override }
  if (next.style && Object.keys(next.style).length === 0) delete next.style
  if (next.responsive) {
    for (const key of Object.keys(next.responsive) as Array<keyof NonNullable<NodeOverride['responsive']>>) {
      const bucket = next.responsive[key]
      if (!bucket || Object.keys(bucket).length === 0) delete next.responsive[key]
    }
    if (Object.keys(next.responsive).length === 0) delete next.responsive
  }
  for (const key of ['text', 'html', 'src', 'alt', 'href', 'target', 'className'] as const) {
    if (next[key] === undefined || next[key] === '') delete next[key]
  }
  if (next.hidden === false) delete next.hidden
  return Object.keys(next).length ? next : undefined
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
  private adapter: VeditAdapter
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null
  private noticeTimer: ReturnType<typeof setTimeout> | null = null
  readonly autosaveMs: number

  state: VeditState

  constructor(opts: { key: string; adapter: VeditAdapter; autosaveMs?: number }) {
    const doc = emptyDocument(opts.key)
    this.adapter = opts.adapter
    this.autosaveMs = opts.autosaveMs ?? 0
    this.state = {
      doc,
      saved: doc,
      status: 'loading',
      error: null,
      editing: false,
      selection: [],
      hovered: null,
      breakpoint: 'base',
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
    const pruned = pruneEmpty(merged)
    if (pruned) nodes[id] = pruned
    else delete nodes[id]
    this.commit({ ...this.state.doc, nodes }, opts)
  }

  /** Set style declarations at the currently selected breakpoint. */
  setStyle(id: string, styles: StyleMap, opts: { history?: boolean } = {}) {
    const bp = this.state.breakpoint
    if (bp === 'base') this.update(id, { style: styles }, opts)
    else this.update(id, { responsive: { [bp]: styles } }, opts)
  }

  /** Write declarations on several nodes as one change, e.g. re-ordering siblings. */
  setStyleMany(entries: Array<[string, StyleMap]>, opts: { history?: boolean } = {}) {
    const bp = this.state.breakpoint
    const nodes = { ...this.state.doc.nodes }
    for (const [id, styles] of entries) {
      const current = nodes[id] ?? {}
      const merged: NodeOverride =
        bp === 'base'
          ? { ...current, style: { ...current.style, ...styles } }
          : {
              ...current,
              responsive: { ...current.responsive, [bp]: { ...current.responsive?.[bp], ...styles } },
            }
      const pruned = pruneEmpty(merged)
      if (pruned) nodes[id] = pruned
      else delete nodes[id]
    }
    this.commit({ ...this.state.doc, nodes }, opts)
  }

  setDropIndicator(rect: VeditState['dropIndicator']) {
    if (this.state.dropIndicator !== rect) this.set({ dropIndicator: rect })
  }

  /** Replace every declaration at the current breakpoint (used by the CSS editor). */
  setStyleBucket(id: string, styles: StyleMap) {
    const bp = this.state.breakpoint
    const override = clone(this.getOverride(id))
    if (bp === 'base') override.style = styles
    else override.responsive = { ...override.responsive, [bp]: styles }
    const nodes = { ...this.state.doc.nodes }
    const pruned = pruneEmpty(override)
    if (pruned) nodes[id] = pruned
    else delete nodes[id]
    this.commit({ ...this.state.doc, nodes })
  }

  /** Snapshot the document so a drag gesture collapses into one undo step. */
  beginHistory() {
    this.set({ past: [...this.state.past, this.state.doc].slice(-HISTORY_LIMIT), future: [] })
  }

  /** Remove a declaration at the current breakpoint, falling back to source styling. */
  clearStyle(id: string, property: string) {
    const bp = this.state.breakpoint
    const override = clone(this.getOverride(id))
    if (bp === 'base') delete override.style?.[property]
    else delete override.responsive?.[bp]?.[property]
    const nodes = { ...this.state.doc.nodes }
    const pruned = pruneEmpty(override)
    if (pruned) nodes[id] = pruned
    else delete nodes[id]
    this.commit({ ...this.state.doc, nodes })
  }

  /** Remove several declarations at the current breakpoint in one change. */
  clearStyles(id: string, properties: string[]) {
    const bp = this.state.breakpoint
    const override = clone(this.getOverride(id))
    for (const property of properties) {
      if (bp === 'base') delete override.style?.[property]
      else delete override.responsive?.[bp]?.[property]
    }
    const nodes = { ...this.state.doc.nodes }
    const pruned = pruneEmpty(override)
    if (pruned) nodes[id] = pruned
    else delete nodes[id]
    this.commit({ ...this.state.doc, nodes })
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

  async load() {
    this.set({ status: 'loading', error: null })
    try {
      const loaded = await this.adapter.load(this.state.doc.key)
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
