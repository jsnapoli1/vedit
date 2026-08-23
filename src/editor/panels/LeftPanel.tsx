import { useState } from 'react'
import { useVeditState, useVeditStore } from '../../core/context'
import { CommentsPanel } from './Comments'
import { HistoryPanel } from './History'
import { IssuesPanel } from './Issues'
import { LayersTree } from './Layers'
import { TokensPanel } from './Tokens'

type Tab = 'layers' | 'tokens' | 'issues' | 'notes' | 'history'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'layers', label: 'Layers' },
  { id: 'tokens', label: 'Tokens' },
  { id: 'issues', label: 'Checks' },
  { id: 'notes', label: 'Notes' },
  { id: 'history', label: 'History' },
]

export function LeftPanel() {
  const store = useVeditStore()
  const [tab, setTab] = useState<Tab>('layers')
  // Re-render when a session appears so the Notes tab can show up.
  useVeditState((state) => state.sessionId)
  // History only earns a tab when the adapter can actually provide it.
  const tabs = TABS.filter(
    (entry) =>
      (entry.id !== 'history' || store.supportsHistory) && (entry.id !== 'notes' || !!store.session),
  )

  return (
    <aside className="vedit-panel vedit-left" data-vedit-ui="">
      <div className="vedit-tabs">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            data-active={tab === entry.id ? 'true' : 'false'}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      {tab === 'layers' ? <LayersTree /> : null}
      {tab === 'tokens' ? <TokensPanel /> : null}
      {tab === 'issues' ? <IssuesPanel /> : null}
      {tab === 'notes' ? <CommentsPanel /> : null}
      {tab === 'history' ? <HistoryPanel /> : null}
    </aside>
  )
}
