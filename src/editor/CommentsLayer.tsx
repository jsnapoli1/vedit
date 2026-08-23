import { useEffect, useRef, useState } from 'react'
import { useVeditSession, useVeditState, useVeditStore } from '../core/context'
import type { Comment } from '../core/realtime'
import type { VeditStore } from '../core/store'
import { initialsOf } from '../core/realtime'
import { toScreen, useEditorTarget, type EditorTarget, type Rect } from './target'

/**
 * Notes pinned to the page. A comment anchored to an element stores its position
 * as a fraction of that element's box, so it stays on the thing it is about when
 * the element moves, resizes or reflows at another breakpoint.
 */
export function CommentsLayer() {
  const store = useVeditStore()
  const target = useEditorTarget()
  const { comments, session } = useVeditSession()
  const pending = useVeditState((state) => state.pendingComment)
  const openId = useVeditState((state) => state.openComment)
  const showResolved = useVeditState((state) => state.tool === 'comment')
  const [, setTick] = useState(0)

  // Pins follow their elements, so they have to be re-measured continuously.
  useEffect(() => {
    let frame = 0
    const loop = () => {
      setTick((value) => (value + 1) % 1_000_000)
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [])

  if (!session) return null

  const visible = comments.filter((comment) => showResolved || !comment.resolved)

  return (
    <div className="vedit-comments-layer">
      {visible.map((comment, index) => {
        const point = anchorOf(comment, store, target)
        if (!point) return null
        return (
          <div key={comment.id} className="vedit-pin-wrap" style={{ top: point.top, left: point.left }}>
            <button
              type="button"
              className="vedit-pin"
              data-resolved={comment.resolved ? 'true' : 'false'}
              style={{ background: comment.author.color }}
              title={`${comment.author.name}: ${comment.body}`}
              onClick={() => store.setOpenComment(openId === comment.id ? null : comment.id)}
            >
              {index + 1}
            </button>
            {openId === comment.id ? <Thread comment={comment} /> : null}
          </div>
        )
      })}

      {pending ? <Composer /> : null}
    </div>
  )
}

/** Screen position of a comment's pin. */
function anchorOf(comment: Comment, store: VeditStore, target: EditorTarget): Rect | null {
  const viewport = target.getViewport()
  if (comment.nodeId) {
    const element = store.getNode(comment.nodeId)?.element
    if (!element?.isConnected) return null
    const rect = element.getBoundingClientRect()
    return toScreen(
      { top: rect.top + comment.y * rect.height, left: rect.left + comment.x * rect.width, width: 0, height: 0 },
      viewport,
    )
  }
  const view = target.getWindow()
  return toScreen(
    { top: comment.y - view.scrollY, left: comment.x - view.scrollX, width: 0, height: 0 },
    viewport,
  )
}

function Composer() {
  const store = useVeditStore()
  const { session } = useVeditSession()
  const pending = useVeditState((state) => state.pendingComment)
  const target = useEditorTarget()
  const [body, setBody] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    input.current?.focus()
  }, [])

  if (!pending || !session) return null

  const point = anchorOf(
    { ...pending, id: '', key: '', body: '', author: session.self, createdAt: '', replies: [] },
    store,
    target,
  )
  if (!point) return null

  const submit = () => {
    const text = body.trim()
    if (text) session.addComment({ body: text, nodeId: pending.nodeId, x: pending.x, y: pending.y })
    store.setPendingComment(null)
  }

  return (
    <div className="vedit-pin-wrap" style={{ top: point.top, left: point.left }}>
      <span className="vedit-pin" style={{ background: session.self.color }}>
        +
      </span>
      <div className="vedit-thread" data-vedit-ui="">
        <textarea
          ref={input}
          className="vedit-textarea"
          placeholder="Leave a note…"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit()
            if (event.key === 'Escape') store.setPendingComment(null)
          }}
        />
        <div className="vedit-row" style={{ marginTop: 6 }}>
          <button type="button" className="vedit-btn" style={{ flex: 1 }} onClick={() => store.setPendingComment(null)}>
            Cancel
          </button>
          <button type="button" className="vedit-btn vedit-btn-primary" style={{ flex: 1 }} onClick={submit}>
            Comment
          </button>
        </div>
      </div>
    </div>
  )
}

export function Thread({ comment, standalone = false }: { comment: Comment; standalone?: boolean }) {
  const store = useVeditStore()
  const { session } = useVeditSession()
  const [reply, setReply] = useState('')
  if (!session) return null

  return (
    <div className={standalone ? 'vedit-thread vedit-thread-inline' : 'vedit-thread'} data-vedit-ui="">
      <Entry author={comment.author} body={comment.body} createdAt={comment.createdAt} />
      {comment.replies.map((entry) => (
        <Entry key={entry.id} author={entry.author} body={entry.body} createdAt={entry.createdAt} />
      ))}

      <textarea
        className="vedit-textarea"
        style={{ minHeight: 46, marginTop: 4 }}
        placeholder="Reply…"
        value={reply}
        onChange={(event) => setReply(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && reply.trim()) {
            session.reply(comment.id, reply.trim())
            setReply('')
          }
        }}
      />
      <div className="vedit-row" style={{ marginTop: 6 }}>
        <button
          type="button"
          className="vedit-btn"
          style={{ flex: 1 }}
          onClick={() => session.setResolved(comment.id, !comment.resolved)}
        >
          {comment.resolved ? 'Reopen' : 'Resolve'}
        </button>
        {comment.author.id === session.self.id ? (
          <button
            type="button"
            className="vedit-btn"
            onClick={() => {
              session.removeComment(comment.id)
              store.setOpenComment(null)
            }}
          >
            Delete
          </button>
        ) : null}
        {reply.trim() ? (
          <button
            type="button"
            className="vedit-btn vedit-btn-primary"
            onClick={() => {
              session.reply(comment.id, reply.trim())
              setReply('')
            }}
          >
            Reply
          </button>
        ) : null}
      </div>
    </div>
  )
}

function Entry({
  author,
  body,
  createdAt,
}: {
  author: Comment['author']
  body: string
  createdAt: string
}) {
  return (
    <div className="vedit-comment">
      <span className="vedit-avatar" style={{ background: author.color, marginLeft: 0 }}>
        {initialsOf(author.name)}
      </span>
      <span>
        <strong>
          {author.name} <em>{relativeTime(createdAt)}</em>
        </strong>
        {body}
      </span>
    </div>
  )
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const seconds = Math.round((Date.now() - then) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
