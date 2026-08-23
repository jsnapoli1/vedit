import { useEffect, useState } from 'react'
import { useVeditContext, useVeditState, useVeditStore } from '../../core/context'
import { BREAKPOINT_ORDER, type Breakpoint, type EditorTool } from '../../core/types'
import {
  IconClose,
  IconCursor,
  IconDesktop,
  IconImage,
  IconPanel,
  IconPhone,
  IconRedo,
  IconSquare,
  IconTablet,
  IconType,
  IconUndo,
} from '../icons'

const TOOLS: Array<{ tool: EditorTool; icon: JSX.Element; title: string }> = [
  { tool: 'select', icon: <IconCursor />, title: 'Select — V' },
  { tool: 'text', icon: <IconType />, title: 'Add text — T' },
  { tool: 'image', icon: <IconImage />, title: 'Add image — I' },
  { tool: 'box', icon: <IconSquare />, title: 'Add box — R' },
]

function BreakpointIcon({ breakpoint }: { breakpoint: Breakpoint }) {
  if (breakpoint === 'base' || breakpoint === 'sm') return <IconPhone />
  if (breakpoint === 'md') return <IconTablet />
  return <IconDesktop />
}

export function Toolbar({
  collapsed,
  onToggleCollapsed,
}: {
  collapsed: boolean
  onToggleCollapsed: () => void
}) {
  const store = useVeditStore()
  const { config } = useVeditContext()
  const tool = useVeditState((state) => state.tool)
  const breakpoint = useVeditState((state) => state.breakpoint)
  const status = useVeditState((state) => state.status)
  const canUndo = useVeditState((state) => state.past.length > 0)
  const canRedo = useVeditState((state) => state.future.length > 0)
  const dirty = useVeditState((state) => state.doc !== state.saved)
  const width = useViewportWidth()

  return (
    <div className="vedit-panel vedit-toolbar" data-vedit-ui="">
      <button
        type="button"
        className="vedit-btn vedit-btn-icon"
        title={collapsed ? 'Show panels — \\' : 'Hide panels — \\'}
        data-active={collapsed ? 'false' : 'true'}
        onClick={onToggleCollapsed}
      >
        <IconPanel />
      </button>
      <span className="vedit-divider" />

      {TOOLS.map((entry) => (
        <button
          key={entry.tool}
          type="button"
          className="vedit-btn vedit-btn-icon"
          title={entry.title}
          data-active={tool === entry.tool ? 'true' : 'false'}
          onClick={() => store.setTool(entry.tool)}
        >
          {entry.icon}
        </button>
      ))}

      <span className="vedit-divider" />

      {BREAKPOINT_ORDER.map((entry) => {
        const minWidth = entry === 'base' ? 0 : config.breakpoints[entry]
        const live = width >= minWidth
        return (
          <button
            key={entry}
            type="button"
            className="vedit-btn"
            data-active={breakpoint === entry ? 'true' : 'false'}
            title={
              entry === 'base'
                ? 'Base — applies at every width'
                : `From ${minWidth}px up${live ? ' (active at this window size)' : ''}`
            }
            onClick={() => store.setBreakpoint(entry)}
            style={{ gap: 4, opacity: live ? 1 : 0.55 }}
          >
            <BreakpointIcon breakpoint={entry} />
            {entry}
          </button>
        )
      })}

      <span className="vedit-divider" />

      <button
        type="button"
        className="vedit-btn vedit-btn-icon"
        title="Undo — ⌘Z"
        disabled={!canUndo}
        onClick={() => store.undo()}
      >
        <IconUndo />
      </button>
      <button
        type="button"
        className="vedit-btn vedit-btn-icon"
        title="Redo — ⇧⌘Z"
        disabled={!canRedo}
        onClick={() => store.redo()}
      >
        <IconRedo />
      </button>

      <span className="vedit-divider" />

      <button
        type="button"
        className="vedit-btn"
        disabled={!dirty}
        title="Throw away unsaved changes"
        onClick={() => store.discard()}
      >
        Discard
      </button>
      <button
        type="button"
        className="vedit-btn vedit-btn-primary"
        disabled={status === 'saving' || !dirty}
        onClick={() => void store.save().catch(() => undefined)}
      >
        {status === 'saving' ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
      </button>
      <button
        type="button"
        className="vedit-btn vedit-btn-icon"
        title="Close the editor — ⌘E"
        onClick={() => store.setEditing(false)}
      >
        <IconClose />
      </button>
    </div>
  )
}

function useViewportWidth(): number {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 0 : window.innerWidth))
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return width
}
