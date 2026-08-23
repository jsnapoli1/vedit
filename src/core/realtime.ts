import type { DesignToken, InsertedNode, NodeOverride } from './types'

/** Someone editing the same document as you. */
export interface Peer {
  id: string
  name: string
  /** Their colour throughout the editor: cursor, selection outline, avatar. */
  color: string
  /** Which page they are on, when several are open on the canvas. */
  path?: string
  /** Node ids they currently have selected. */
  selection?: string[]
  /** Page coordinates of their pointer, or null when it has left the page. */
  cursor?: { x: number; y: number } | null
  /** Wall-clock time we last heard from them, set on receipt. */
  seenAt?: number
}

export interface CommentReply {
  id: string
  body: string
  author: Pick<Peer, 'id' | 'name' | 'color'>
  createdAt: string
}

/** A note pinned to the page, or to a particular element on it. */
export interface Comment {
  id: string
  /** Which document it belongs to. */
  key: string
  /** The element it is pinned to, when it is pinned to one. */
  nodeId?: string
  /**
   * Where the pin sits. Relative to the element when `nodeId` is set (0–1 of its
   * box, so it survives the element being resized), otherwise page coordinates.
   */
  x: number
  y: number
  body: string
  author: Pick<Peer, 'id' | 'name' | 'color'>
  createdAt: string
  resolved?: boolean
  replies: CommentReply[]
}

/**
 * Everything peers say to each other. Deliberately small and JSON-serialisable:
 * a transport only has to move these around, which is why a BroadcastChannel and
 * an SSE relay can both implement it without knowing anything about the editor.
 */
export type RealtimeMessage =
  /** Sent on join, and in reply to someone else's join, so both sides learn. */
  | { type: 'hello'; peer: Peer; reply?: boolean }
  | { type: 'presence'; peer: Peer }
  | { type: 'bye'; peerId: string }
  /** A document change, as the nodes that changed. `null` means the node's overrides were dropped. */
  | {
      type: 'patch'
      key: string
      from: string
      at: number
      nodes?: Record<string, NodeOverride | null>
      inserted?: InsertedNode[]
      tokens?: DesignToken[]
    }
  | { type: 'comment'; from: string; comment: Comment }
  | { type: 'comment-removed'; from: string; commentId: string }
  /** Someone saved, so everyone else knows the stored document moved on. */
  | { type: 'saved'; from: string; key: string; at: string }

export interface RealtimeConnection {
  send(message: RealtimeMessage): void
  close(): void
}

/**
 * A way for editors of the same document to reach each other. Two ship with the
 * library — `broadcastChannelRealtime` for tabs on one machine and `sseRealtime`
 * for a real backend — and anything that can move JSON can implement it.
 */
export interface VeditRealtime {
  connect(room: string, onMessage: (message: RealtimeMessage) => void): RealtimeConnection
}

/* ---------------------------------------------------------------- identity */

const PEER_COLORS = [
  '#f24822', '#ff8a00', '#ffc700', '#14ae5c', '#0d99ff',
  '#7b61ff', '#e24aa0', '#00a6a6', '#c2185b', '#5a67d8',
]

/** A stable colour for a peer, so the same person looks the same to everyone. */
export function colorForPeer(id: string): string {
  let hash = 0
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0
  return PEER_COLORS[hash % PEER_COLORS.length]
}

const ANIMALS = ['Otter', 'Heron', 'Fox', 'Marten', 'Kestrel', 'Badger', 'Hare', 'Lynx', 'Crane', 'Vole']

/** A readable stand-in when the host app hasn't told us who is editing. */
export function anonymousPeer(): Pick<Peer, 'id' | 'name' | 'color'> {
  const id = `anon-${Math.random().toString(36).slice(2, 10)}`
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)]
  return { id, name: `Anonymous ${animal}`, color: colorForPeer(id) }
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')
}
