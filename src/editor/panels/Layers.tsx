import { useMemo, useRef } from 'react'
import { useVeditNodes, useVeditState, useVeditStore } from '../../core/context'
import type { NodeKind, RegisteredNode } from '../../core/types'
import { moveFocus } from '../focus'
import { IconEye, IconEyeOff, IconImage, IconShape, IconSquare, IconType } from '../icons'

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
  return <IconType width={12} height={12} />
}

/** The tree in the order it is drawn, so arrow keys walk it the way it looks. */
function flatten(tree: TreeNode[]): string[] {
  return tree.flatMap((entry) => [entry.node.id, ...flatten(entry.children)])
}

export function LayersTree() {
  const nodes = useVeditNodes()
  const tree = useMemo(() => buildTree(nodes), [nodes])
  const body = useRef<HTMLDivElement>(null)
  const order = useMemo(() => flatten(tree), [tree])
  const selection = useVeditState((state) => state.selection)

  // One tab stop for the whole tree, arrow keys inside it: tabbing through
  // several hundred layer rows to reach the inspector is not navigation.
  const focused = order.find((id) => selection.includes(id)) ?? order[0]
  const rows = () => [...(body.current?.querySelectorAll<HTMLElement>('.vedit-layer') ?? [])]

  return (
    <div className="vedit-panel-body" ref={body} role="tree" aria-label="Layers">
      {tree.length ? (
        tree.map((entry) => (
          <LayerRow
            key={entry.node.id}
            entry={entry}
            depth={0}
            focusedId={focused}
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
  onKeyDown,
}: {
  entry: TreeNode
  depth: number
  /** The single row that is in the tab order right now. */
  focusedId: string | undefined
  onKeyDown: (event: React.KeyboardEvent) => void
}) {
  const store = useVeditStore()
  const { node } = entry
  const selected = useVeditState((state) => state.selection.includes(node.id))
  const hidden = useVeditState((state) => !!state.doc.nodes[node.id]?.hidden)
  const edited = useVeditState((state) => !!state.doc.nodes[node.id])

  return (
    <>
      <button
        type="button"
        className="vedit-layer"
        role="treeitem"
        aria-selected={selected}
        aria-level={depth + 1}
        tabIndex={focusedId === node.id ? 0 : -1}
        data-selected={selected ? 'true' : 'false'}
        data-hidden={hidden ? 'true' : 'false'}
        style={{ paddingLeft: 10 + depth * 12 }}
        onKeyDown={onKeyDown}
        onFocus={() => store.hover(node.id)}
        onBlur={() => store.hover(null)}
        onClick={(event) => {
          store.select(node.id, { additive: event.shiftKey })
          node.element.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        }}
        onMouseEnter={() => store.hover(node.id)}
        onMouseLeave={() => store.hover(null)}
      >
        <span className="vedit-layer-kind">
          <KindIcon kind={node.kind} />
        </span>
        <span className="vedit-layer-name">{node.label}</span>
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
        >
          {hidden ? <IconEyeOff width={12} height={12} /> : <IconEye width={12} height={12} />}
        </span>
      </button>
      {entry.children.map((child) => (
        <LayerRow
          key={child.node.id}
          entry={child}
          depth={depth + 1}
          focusedId={focusedId}
          onKeyDown={onKeyDown}
        />
      ))}
    </>
  )
}
