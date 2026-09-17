import { useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useVeditNodes, useVeditState, useVeditStore } from '../../core/context'
import type { NodeKind, RegisteredNode } from '../../core/types'
import { moveFocus } from '../focus'
import { IconChevron, IconEye, IconEyeOff, IconImage, IconShape, IconSquare, IconType } from '../icons'

interface TreeNode {
  node: RegisteredNode
  children: TreeNode[]
}

function buildTree(nodes: RegisteredNode[]): TreeNode[] {
  const byId = new Map<string, TreeNode>()
  for (const node of nodes) byId.set(node.id, { node, children: [] })

  const roots: TreeNode[] = []
  for (const entry of byId.values()) {
    const parent = entry.node.parentId ? byId.get(entry.node.parentId) : undefined
    if (parent) parent.children.push(entry)
    else roots.push(entry)
  }

  const sort = (list: TreeNode[]) => {
    list.sort((a, b) => {
      const position = a.node.element.compareDocumentPosition(b.node.element)
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1
      return 0
    })
    for (const entry of list) sort(entry.children)
  }
  sort(roots)
  return roots
}

function KindIcon({ kind }: { kind: NodeKind }) {
  if (kind === 'image') return <IconImage width={12} height={12} />
  if (kind === 'shape') return <IconShape width={12} height={12} />
  if (kind === 'box' || kind === 'component') return <IconSquare width={12} height={12} />
  // Text, links, buttons and file links all read as copy in the tree; what a
  // link points at is the inspector's business, not the layer list's.
  return <IconType width={12} height={12} />
}

/** The tree in the order it is drawn, so arrow keys walk it the way it looks. */
function flatten(tree: TreeNode[], collapsed: ReadonlySet<string>): string[] {
  return tree.flatMap((entry) =>
    collapsed.has(entry.node.id) ? [entry.node.id] : [entry.node.id, ...flatten(entry.children, collapsed)],
  )
}

export interface LayersTreeProps {
  /** Ids whose children are folded away. Held above the tree so a trip to another tab does not unfold everything. */
  collapsed: ReadonlySet<string>
  onCollapsedChange: Dispatch<SetStateAction<ReadonlySet<string>>>
}

export function LayersTree({ collapsed, onCollapsedChange }: LayersTreeProps) {
  const nodes = useVeditNodes()
  const tree = useMemo(() => buildTree(nodes), [nodes])
  const body = useRef<HTMLDivElement>(null)
  const order = useMemo(() => flatten(tree, collapsed), [tree, collapsed])
  const selection = useVeditState((state) => state.selection)
  const [renaming, setRenaming] = useState<string | null>(null)

  // One tab stop for the whole tree, arrow keys inside it: tabbing through
  // several hundred layer rows to reach the inspector is not navigation.
  const focused = order.find((id) => selection.includes(id)) ?? order[0]
  const rows = () => [...(body.current?.querySelectorAll<HTMLElement>('.vedit-layer') ?? [])]

  const setCollapsed = (id: string, fold: boolean) =>
    onCollapsedChange((current) => {
      if (current.has(id) === fold) return current
      const next = new Set(current)
      if (fold) next.add(id)
      else next.delete(id)
      return next
    })

  // Something selected on the page has to be visible in the tree, or the
  // selection reads as lost. Folding a row above the selection by hand is
  // still allowed: this runs when the selection moves, not when the tree does.
  useEffect(() => {
    if (!selection.length) return
    const parentOf = new Map(nodes.map((node) => [node.id, node.parentId]))
    onCollapsedChange((current) => {
      const next = new Set(current)
      for (const id of selection) {
        let parent = parentOf.get(id)
        while (parent) {
          next.delete(parent)
          parent = parentOf.get(parent)
        }
      }
      return next.size === current.size ? current : next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection])

  return (
    <div className="vedit-panel-body" ref={body} role="tree" aria-label="Layers">
      {tree.length ? (
        tree.map((entry) => (
          <LayerRow
            key={entry.node.id}
            entry={entry}
            depth={0}
            focusedId={focused}
            collapsed={collapsed}
            onCollapse={setCollapsed}
            renaming={renaming}
            onRenaming={setRenaming}
            onKeyDown={(event) => moveFocus(event, rows())}
          />
        ))
      ) : (
        <div className="vedit-section vedit-hint">
          Nothing registered yet. Wrap elements in <code>&lt;Editable&gt;</code> or turn on
          <code> auto</code> scanning.
        </div>
      )}
    </div>
  )
}

function LayerRow({
  entry,
  depth,
  focusedId,
  collapsed,
  onCollapse,
  renaming,
  onRenaming,
  onKeyDown,
}: {
  entry: TreeNode
  depth: number
  /** The single row that is in the tab order right now. */
  focusedId: string | undefined
  collapsed: ReadonlySet<string>
  onCollapse: (id: string, fold: boolean) => void
  /** The row whose name is being typed, if any. */
  renaming: string | null
  onRenaming: (id: string | null) => void
  onKeyDown: (event: React.KeyboardEvent) => void
}) {
  const store = useVeditStore()
  const { node } = entry
  const selected = useVeditState((state) => state.selection.includes(node.id))
  const hidden = useVeditState((state) => !!state.doc.nodes[node.id]?.hidden)
  const edited = useVeditState((state) => !!state.doc.nodes[node.id])
  const label = useVeditState(() => store.labelOf(node.id))
  const hasChildren = entry.children.length > 0
  const folded = hasChildren && collapsed.has(node.id)
  const editing = renaming === node.id
  const button = useRef<HTMLButtonElement>(null)
  // Set when the keyboard ended a rename, so focus goes back to the row rather
  // than nowhere. A click elsewhere ends one too, and must not be yanked back.
  const refocus = useRef(false)

  useLayoutEffect(() => {
    if (!editing && refocus.current) {
      refocus.current = false
      button.current?.focus()
    }
  }, [editing])

  const commit = (value: string) => {
    const name = value.trim()
    // The source's own name is the default, not an override worth storing.
    store.update(node.id, { label: name === node.label ? undefined : name })
    onRenaming(null)
  }

  const allRows = (event: React.KeyboardEvent) =>
    [...(event.currentTarget.closest('[role="tree"]')?.querySelectorAll<HTMLElement>('.vedit-layer') ?? [])]

  const onRowKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'F2') {
      event.preventDefault()
      onRenaming(node.id)
      return
    }
    if (event.key === 'ArrowRight') {
      if (!hasChildren) return
      event.preventDefault()
      if (folded) onCollapse(node.id, false)
      else {
        const rows = allRows(event)
        rows[rows.indexOf(event.currentTarget as HTMLElement) + 1]?.focus()
      }
      return
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      if (hasChildren && !folded) onCollapse(node.id, true)
      else if (node.parentId) allRows(event).find((row) => row.dataset.id === node.parentId)?.focus()
      return
    }
    onKeyDown(event)
  }

  const toggle = hasChildren ? (
    <span
      className="vedit-layer-toggle"
      role="button"
      tabIndex={-1}
      aria-label={folded ? `Expand ${label}` : `Collapse ${label}`}
      data-expanded={folded ? 'false' : 'true'}
      onClick={(event) => {
        event.stopPropagation()
        onCollapse(node.id, !folded)
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <IconChevron width={10} height={10} />
    </span>
  ) : (
    <span className="vedit-layer-gap" aria-hidden="true" />
  )

  const shared = {
    className: 'vedit-layer',
    role: 'treeitem',
    'aria-selected': selected,
    'aria-level': depth + 1,
    ...(hasChildren ? { 'aria-expanded': !folded } : {}),
    'data-id': node.id,
    'data-selected': selected ? 'true' : 'false',
    'data-hidden': hidden ? 'true' : 'false',
    style: { paddingLeft: 10 + depth * 12 },
  } as const

  return (
    <>
      {editing ? (
        <div {...shared}>
          {toggle}
          <span className="vedit-layer-kind">
            <KindIcon kind={node.kind} />
          </span>
          <input
            className="vedit-layer-rename"
            aria-label={`Name for ${label}`}
            defaultValue={label}
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                refocus.current = true
                commit(event.currentTarget.value)
              } else if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                refocus.current = true
                onRenaming(null)
              }
            }}
            onBlur={(event) => {
              if (renaming === node.id) commit(event.currentTarget.value)
            }}
          />
        </div>
      ) : (
        <button
          {...shared}
          type="button"
          ref={button}
          tabIndex={focusedId === node.id ? 0 : -1}
          onKeyDown={onRowKeyDown}
          onFocus={() => store.hover(node.id)}
          onBlur={() => store.hover(null)}
          onClick={(event) => {
            store.select(node.id, { additive: event.shiftKey })
            node.element.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
          }}
          onDoubleClick={() => onRenaming(node.id)}
          onMouseEnter={() => store.hover(node.id)}
          onMouseLeave={() => store.hover(null)}
        >
          {toggle}
          <span className="vedit-layer-kind">
            <KindIcon kind={node.kind} />
          </span>
          <span className="vedit-layer-name">{label}</span>
          {edited ? <span title="Edited" style={{ color: 'var(--vedit-accent)' }}>•</span> : null}
          <span
            className="vedit-layer-eye"
            role="button"
            tabIndex={-1}
            title={hidden ? 'Show' : 'Hide'}
            onClick={(event) => {
              event.stopPropagation()
              store.update(node.id, { hidden: !hidden })
            }}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            {hidden ? <IconEyeOff width={12} height={12} /> : <IconEye width={12} height={12} />}
          </span>
        </button>
      )}
      {folded
        ? null
        : entry.children.map((child) => (
            <LayerRow
              key={child.node.id}
              entry={child}
              depth={depth + 1}
              focusedId={focusedId}
              collapsed={collapsed}
              onCollapse={onCollapse}
              renaming={renaming}
              onRenaming={onRenaming}
              onKeyDown={onKeyDown}
            />
          ))}
    </>
  )
}
