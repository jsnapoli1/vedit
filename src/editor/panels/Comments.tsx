import { useState } from 'react'
import { useVeditSession, useVeditState, useVeditStore } from '../../core/context'
import { initialsOf } from '../../core/realtime'
import { relativeTime, Thread } from '../CommentsLayer'

/** Every note on this page, open ones first. */
export function CommentsPanel() {
  const store = useVeditStore()
  const { comments, session } = useVeditSession()
  const openId = useVeditState((state) => state.openComment)
  const [showResolved, setShowResolved] = useState(false)

  if (!session) {
    return (
      <div className="vedit-panel-body">
        <div className="vedit-section vedit-hint">
          Comments need collaboration switched on. Pass a <code>realtime</code> transport to
          the provider — <code>broadcastChannelRealtime()</code> works across tabs with no
          backend at all.
        </div>
      </div>
    )
  }

  const open = comments.filter((comment) => !comment.resolved)
  const resolved = comments.filter((comment) => comment.resolved)
  const shown = showResolved ? [...open, ...resolved] : open

  return (
    <div className="vedit-panel-body">
      <div className="vedit-section">
        <div className="vedit-hint" style={{ marginBottom: 6 }}>
          Press <code>C</code>, then click anywhere on the page to leave a note.
        </div>
        {resolved.length ? (
          <button
            type="button"
            className="vedit-btn"
            style={{ width: '100%' }}
            onClick={() => setShowResolved(!showResolved)}
          >
            {showResolved ? 'Hide' : 'Show'} {resolved.length} resolved
          </button>
        ) : null}
        {!session.canPersistComments ? (
          <div className="vedit-hint" style={{ marginTop: 6 }}>
            These are shared live but not stored — add <code>saveComment</code> to your adapter
            to keep them.
          </div>
        ) : null}
      </div>

      {shown.length ? (
        shown.map((comment) => (
          <div key={comment.id} className="vedit-comment-row" data-resolved={comment.resolved ? 'true' : 'false'}>
            <button
              type="button"
              className="vedit-comment-head"
              onClick={() => {
                store.setOpenComment(openId === comment.id ? null : comment.id)
                if (comment.nodeId) {
                  store.select(comment.nodeId)
                  store.getNode(comment.nodeId)?.element.scrollIntoView({ block: 'center', behavior: 'smooth' })
                }
              }}
              onMouseEnter={() => comment.nodeId && store.hover(comment.nodeId)}
              onMouseLeave={() => store.hover(null)}
            >
              <span className="vedit-avatar" style={{ background: comment.author.color, marginLeft: 0 }}>
                {initialsOf(comment.author.name)}
              </span>
              <span>
                <strong>
                  {comment.author.name} <em>{relativeTime(comment.createdAt)}</em>
                </strong>
                {comment.body}
                {comment.replies.length ? (
                  <em>
                    {comment.replies.length} {comment.replies.length === 1 ? 'reply' : 'replies'}
                  </em>
                ) : null}
              </span>
            </button>
            {openId === comment.id ? <Thread comment={comment} standalone /> : null}
          </div>
        ))
      ) : (
        <div className="vedit-section vedit-hint">No open comments.</div>
      )}
    </div>
  )
}
