import { useCallback, useEffect, useState } from 'react'
import { useVeditState, useVeditStore } from '../../core/context'
import type { VeditVersion } from '../../core/types'

/**
 * Every save is a version. Restoring loads one back into the editor rather than
 * publishing it outright, so you get to look before anyone else does.
 */
export function HistoryPanel() {
  const store = useVeditStore()
  const saved = useVeditState((state) => state.saved)
  const [versions, setVersions] = useState<VeditVersion[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    store
      .listVersions()
      .then(setVersions)
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [store])

  useEffect(refresh, [refresh, saved])

  if (!store.supportsHistory) {
    return (
      <div className="vedit-panel-body">
        <div className="vedit-section vedit-hint">
          This adapter doesn't keep history. Implement <code>listVersions</code> and{' '}
          <code>loadVersion</code> to see saves listed here.
        </div>
      </div>
    )
  }

  return (
    <div className="vedit-panel-body">
      {error ? <div className="vedit-section vedit-hint">{error}</div> : null}
      {versions?.length ? (
        versions.map((version) => (
          <div className="vedit-version" key={version.id}>
            <span>
              <strong>{formatWhen(version.savedAt)}</strong>
              {version.published ? <em>Live for visitors</em> : version.label ? <em>{version.label}</em> : null}
            </span>
            <button
              type="button"
              className="vedit-btn"
              onClick={() => void store.restoreVersion(version.id).catch(() => undefined)}
            >
              Restore
            </button>
          </div>
        ))
      ) : (
        <div className="vedit-section vedit-hint">{versions ? 'No versions yet.' : 'Loading…'}</div>
      )}
    </div>
  )
}

function formatWhen(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
