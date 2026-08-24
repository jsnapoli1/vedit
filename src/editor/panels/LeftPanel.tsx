import { useRef, useState } from 'react'
import { useVeditState, useVeditStore } from '../../core/context'
import { moveFocus } from '../focus'
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

  const strip = useRef<HTMLDivElement>(null)

  return (
    <aside className="vedit-panel vedit-left" data-vedit-ui="" aria-label="Layers, tokens and notes">
      <div className="vedit-tabs" role="tablist" ref={strip}>
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={`vedit-tab-${entry.id}`}
            aria-selected={tab === entry.id}
            aria-controls="vedit-tabpanel"
            // One tab stop for the strip; left and right move between the tabs.
            tabIndex={tab === entry.id ? 0 : -1}
            data-active={tab === entry.id ? 'true' : 'false'}
            onKeyDown={(event) =>
              moveFocus(event, [...(strip.current?.querySelectorAll<HTMLElement>('button') ?? [])], {
                orientation: 'horizontal',
              })
            }
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div id="vedit-tabpanel" role="tabpanel" aria-labelledby={`vedit-tab-${tab}`} style={{ display: 'contents' }}>
      {tab === 'layers' ? <LayersTree /> : null}
      {tab === 'tokens' ? <TokensPanel /> : null}
      {tab === 'issues' ? <IssuesPanel /> : null}
      {tab === 'notes' ? <CommentsPanel /> : null}
      {tab === 'history' ? <HistoryPanel /> : null}
      </div>
    </aside>
  )
}
