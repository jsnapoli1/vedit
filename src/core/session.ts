import {
  anonymousPeer,
  colorForPeer,
  type Comment,
  type CommentReply,
  type Peer,
  type RealtimeConnection,
  type RealtimeMessage,
  type VeditRealtime,
} from './realtime'
import type { VeditStore } from './store'
import type { DesignToken, InsertedNode, NodeOverride, VeditAdapter, VeditDocument } from './types'

/** Presence goes stale this long after a peer's last message. */
const PEER_TIMEOUT = 20_000
const HEARTBEAT = 5_000
/** Cursor updates are capped to keep a fast pointer from flooding the transport. */
const CURSOR_INTERVAL = 50

export interface SessionSnapshot {
  peers: Peer[]
  comments: Comment[]
  /** Set when someone else saved after we loaded, so our save would overwrite theirs. */
  staleSince: string | null
}

const EMPTY: SessionSnapshot = { peers: [], comments: [], staleSince: null }

/**
 * Ties one document's store to everyone else editing it: who is here, where their
 * pointer is, what they have selected, the notes they leave, and their changes.
 *
 * Document changes merge per node, last write wins. Two people restyling different
 * elements both keep their work; two people restyling the same element resolve to
 * whoever released the mouse last, which is the honest guarantee for a design tool
 * without a full CRDT underneath.
 */
export class RealtimeSession {
  private listeners = new Set<() => void>()
  private connection: RealtimeConnection | null = null
  private peers = new Map<string, Peer>()
  private comments = new Map<string, Comment>()
  private snapshot: SessionSnapshot = EMPTY
  private lastDoc: VeditDocument
  private applying = false
  private cursorSentAt = 0
  private timers: Array<ReturnType<typeof setInterval>> = []
  private detach: Array<() => void> = []
  private staleSince: string | null = null
  private broadcastPresence = true

  readonly self: Peer

  constructor(
    private store: VeditStore,
    private transport: VeditRealtime,
    private adapter: VeditAdapter,
    self?: Partial<Peer>,
    private room?: string,
  ) {
    const base = anonymousPeer()
    this.self = {
      ...base,
      ...self,
      // A named user gets a colour derived from their id, so they look the same
      // to everyone in the room.
      color: self?.color ?? (self?.id ? colorForPeer(self.id) : base.color),
    }
    this.lastDoc = store.getState().doc
    this.savedSeen = store.getState().saved
    this.selectionSeen = store.getState().selection
  }

  /* ---------------------------------------------------------------- state */

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): SessionSnapshot => this.snapshot

  private publishState() {
    this.snapshot = {
      peers: [...this.peers.values()].sort((a, b) => a.name.localeCompare(b.name)),
      comments: [...this.comments.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      staleSince: this.staleSince,
    }
    for (const listener of this.listeners) listener()
  }

  /* --------------------------------------------------------------- start */

  async start() {
    this.connection = this.transport.connect(this.room ?? 'vedit', (message) => this.receive(message))
    this.send({ type: 'hello', peer: this.presence() })

    this.detach.push(this.store.subscribe(() => this.onStoreChange()))
    this.every(HEARTBEAT, () => this.send({ type: 'presence', peer: this.presence() }))
    this.every(PEER_TIMEOUT / 2, () => this.prunePeers())

    if (typeof window !== 'undefined') {
      const onUnload = () => this.stop()
      window.addEventListener('pagehide', onUnload)
      this.detach.push(() => window.removeEventListener('pagehide', onUnload))
    }

    await this.loadComments()
  }

  /** A timer that never keeps a Node process (or a test run) alive on its own. */
  private every(ms: number, run: () => void) {
    const timer = setInterval(run, ms)
    ;(timer as unknown as { unref?: () => void }).unref?.()
    this.timers.push(timer)
  }

  stop() {
    this.send({ type: 'bye', peerId: this.self.id })
    this.connection?.close()
    this.connection = null
    this.timers.forEach((timer) => clearInterval(timer))
    this.timers = []
    this.detach.forEach((off) => off())
    this.detach = []
  }

  /** Attach pointer tracking to the document the page is rendered in. */
  trackPointer(doc: Document) {
    const onMove = (event: MouseEvent) => {
      if (!this.store.getState().editing) return
      const now = Date.now()
      if (now - this.cursorSentAt < CURSOR_INTERVAL) return
      this.cursorSentAt = now
      this.send({
        type: 'presence',
        peer: this.presence({ x: event.clientX + doc.defaultView!.scrollX, y: event.clientY + doc.defaultView!.scrollY }),
      })
    }
    const onLeave = () => this.send({ type: 'presence', peer: this.presence(null) })

    doc.addEventListener('mousemove', onMove, true)
    doc.addEventListener('mouseleave', onLeave)
    const off = () => {
      doc.removeEventListener('mousemove', onMove, true)
      doc.removeEventListener('mouseleave', onLeave)
    }
    this.detach.push(off)
    return off
  }

  private presence(cursor?: { x: number; y: number } | null): Peer {
    const state = this.store.getState()
    return {
      ...this.self,
      selection: state.selection,
      cursor: cursor === undefined ? undefined : cursor,
      path: typeof window === 'undefined' ? undefined : window.location.pathname,
    }
  }

  private send(message: RealtimeMessage) {
    if (!this.broadcastPresence && (message.type === 'presence' || message.type === 'hello')) return
    this.connection?.send(message)
  }

  /**
   * One person can have several sessions open at once — a canvas shows an artboard
   * per page, and each has its own store. They share a peer id, so only the one
   * being worked in should speak for them. A session going quiet says nothing
   * rather than announcing an empty selection, which would talk over its sibling;
   * document changes keep flowing either way, scoped to their own document.
   */
  setBroadcastPresence(enabled: boolean) {
    if (this.broadcastPresence === enabled) return
    this.broadcastPresence = enabled
    if (enabled) this.send({ type: 'presence', peer: this.presence() })
  }

  /* ------------------------------------------------------------ receiving */

  private receive(message: RealtimeMessage) {
    switch (message.type) {
      case 'hello':
        if (message.peer.id === this.self.id) return
        this.trackPeer(message.peer)
        // Answer a join so the newcomer learns about us, but don't answer answers.
        if (!message.reply) {
          this.send({ type: 'hello', peer: this.presence(), reply: true })
          for (const comment of this.comments.values()) {
            this.send({ type: 'comment', from: this.self.id, comment })
          }
        }
        return

      case 'presence':
        if (message.peer.id === this.self.id) return
        this.trackPeer(message.peer)
        return

      case 'bye':
        if (this.peers.delete(message.peerId)) this.publishState()
        return

      case 'patch':
        if (message.from === this.self.id) return
        if (message.key !== this.store.getState().doc.key) return
        this.applying = true
        try {
          this.store.applyRemote({
            nodes: message.nodes,
            inserted: message.inserted,
            tokens: message.tokens,
          })
        } finally {
          this.lastDoc = this.store.getState().doc
          this.applying = false
        }
        return

      case 'comment':
        if (message.from === this.self.id) return
        // One room can carry several documents; only keep notes about this one.
        if (message.comment.key !== this.store.getState().doc.key) return
        this.comments.set(message.comment.id, message.comment)
        this.publishState()
        return

      case 'comment-removed':
        if (message.from === this.self.id) return
        if (this.comments.delete(message.commentId)) this.publishState()
        return

      case 'saved':
        if (message.from === this.self.id) return
        if (message.key !== this.store.getState().doc.key) return
        // Their save is now the stored document; ours would replace it wholesale.
        this.staleSince = message.at
        this.publishState()
        return
    }
  }

  private trackPeer(peer: Peer) {
    const previous = this.peers.get(peer.id)
    this.peers.set(peer.id, {
      ...previous,
      ...peer,
      // A heartbeat carries no cursor; keep the last one we saw.
      cursor: peer.cursor === undefined ? previous?.cursor ?? null : peer.cursor,
      seenAt: Date.now(),
    })
    this.publishState()
  }

  private prunePeers() {
    const cutoff = Date.now() - PEER_TIMEOUT
    let changed = false
    for (const [id, peer] of this.peers) {
      if ((peer.seenAt ?? 0) < cutoff) {
        this.peers.delete(id)
        changed = true
      }
    }
    if (changed) this.publishState()
  }

  /* ------------------------------------------------------------ sending */

  private onStoreChange() {
    const state = this.store.getState()

    if (!this.applying && state.doc !== this.lastDoc) {
      const patch = diffDocuments(this.lastDoc, state.doc)
      this.lastDoc = state.doc
      if (patch) this.send({ type: 'patch', key: state.doc.key, from: this.self.id, at: Date.now(), ...patch })
    }

    if (state.saved !== this.savedSeen) {
      this.savedSeen = state.saved
      this.staleSince = null
      this.send({ type: 'saved', from: this.self.id, key: state.doc.key, at: state.saved.updatedAt })
      this.publishState()
    }

    // Selection is cheap and changes rarely; send it as it happens.
    if (state.selection !== this.selectionSeen) {
      this.selectionSeen = state.selection
      this.send({ type: 'presence', peer: this.presence() })
    }
  }

  private savedSeen: VeditDocument | null = null
  private selectionSeen: string[] | null = null

  /* ----------------------------------------------------------- comments */

  private async loadComments() {
    if (!this.adapter.listComments) return
    try {
      const loaded = await this.adapter.listComments(this.store.getState().doc.key)
      for (const comment of loaded) this.comments.set(comment.id, comment)
      this.publishState()
    } catch {
      // A missing comment store shouldn't take the editor down with it.
    }
  }

  get canPersistComments(): boolean {
    return typeof this.adapter.saveComment === 'function'
  }

  addComment(input: { body: string; nodeId?: string; x: number; y: number }): Comment {
    const comment: Comment = {
      id: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      key: this.store.getState().doc.key,
      nodeId: input.nodeId,
      x: input.x,
      y: input.y,
      body: input.body,
      author: { id: this.self.id, name: this.self.name, color: this.self.color },
      createdAt: new Date().toISOString(),
      replies: [],
    }
    this.commitComment(comment)
    return comment
  }

  reply(commentId: string, body: string) {
    const comment = this.comments.get(commentId)
    if (!comment) return
    const reply: CommentReply = {
      id: `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      body,
      author: { id: this.self.id, name: this.self.name, color: this.self.color },
      createdAt: new Date().toISOString(),
    }
    this.commitComment({ ...comment, replies: [...comment.replies, reply] })
  }

  setResolved(commentId: string, resolved: boolean) {
    const comment = this.comments.get(commentId)
    if (comment) this.commitComment({ ...comment, resolved })
  }

  removeComment(commentId: string) {
    if (!this.comments.delete(commentId)) return
    this.publishState()
    this.send({ type: 'comment-removed', from: this.self.id, commentId })
    void this.adapter.deleteComment?.(commentId).catch(() => undefined)
  }

  private commitComment(comment: Comment) {
    this.comments.set(comment.id, comment)
    this.publishState()
    this.send({ type: 'comment', from: this.self.id, comment })
    void this.adapter.saveComment?.(comment).catch(() => undefined)
  }
}

export interface DocumentPatch {
  /** `null` means every override for that node was dropped. */
  nodes?: Record<string, NodeOverride | null>
  inserted?: InsertedNode[]
  tokens?: DesignToken[]
}

/** The nodes, inserted elements and tokens that differ between two documents. */
export function diffDocuments(previous: VeditDocument, next: VeditDocument): DocumentPatch | null {
  const nodes: Record<string, NodeOverride | null> = {}

  for (const [id, override] of Object.entries(next.nodes)) {
    if (previous.nodes[id] !== override) nodes[id] = override
  }
  for (const id of Object.keys(previous.nodes)) {
    if (!(id in next.nodes)) nodes[id] = null
  }

  const patch: DocumentPatch = {}
  if (Object.keys(nodes).length) patch.nodes = nodes
  if (previous.inserted !== next.inserted) patch.inserted = next.inserted
  if (previous.tokens !== next.tokens) patch.tokens = next.tokens

  return Object.keys(patch).length ? patch : null
}
