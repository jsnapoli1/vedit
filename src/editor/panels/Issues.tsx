import { useEffect, useState } from 'react'
import { useVeditNodes, useVeditState, useVeditStore } from '../../core/context'
import { auditPage, type A11yIssue } from '../a11y'

/**
 * Accessibility problems on the page as it stands right now — including any the
 * editor just introduced. Re-runs shortly after every change so the feedback
 * arrives while the decision is still fresh.
 */
export function IssuesPanel() {
  const store = useVeditStore()
  const nodes = useVeditNodes()
  const doc = useVeditState((state) => state.doc)
  const [issues, setIssues] = useState<A11yIssue[]>([])

  useEffect(() => {
    // Styles need a frame to settle before anything is worth measuring.
    const timer = setTimeout(() => setIssues(auditPage(nodes)), 120)
    return () => clearTimeout(timer)
  }, [nodes, doc])

  const errors = issues.filter((issue) => issue.severity === 'error')
  const warnings = issues.filter((issue) => issue.severity === 'warning')

  return (
    <div className="vedit-panel-body">
      <div className="vedit-section">
        <div className="vedit-issue-summary">
          <span data-tone="error">{errors.length} errors</span>
          <span data-tone="warning">{warnings.length} warnings</span>
        </div>
      </div>
      {issues.length ? (
        [...errors, ...warnings].map((issue, index) => (
          <button
            key={`${issue.nodeId}-${issue.rule}-${index}`}
            type="button"
            className="vedit-issue"
            data-tone={issue.severity}
            onClick={() => {
              store.select(issue.nodeId)
              store.getNode(issue.nodeId)?.element.scrollIntoView({ block: 'center', behavior: 'smooth' })
            }}
            onMouseEnter={() => store.hover(issue.nodeId)}
            onMouseLeave={() => store.hover(null)}
          >
            <span className="vedit-issue-dot" />
            <span>
              <strong>{issue.message}</strong>
              {issue.detail ? <em>{issue.detail}</em> : null}
              <code>{store.getNode(issue.nodeId)?.label ?? issue.nodeId}</code>
            </span>
          </button>
        ))
      ) : (
        <div className="vedit-section vedit-hint">
          Nothing found. Contrast, alt text, heading order, empty controls and vague link
          text are checked on every change.
        </div>
      )}
    </div>
  )
}
