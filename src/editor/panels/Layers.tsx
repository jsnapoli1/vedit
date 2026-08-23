import { useMemo } from 'react'
import { useVeditNodes, useVeditState, useVeditStore } from '../../core/context'
import type { NodeKind, RegisteredNode } from '../../core/types'
import { IconEye, IconEyeOff, IconImage, IconSquare, IconType } from '../icons'

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
  if (kind === 'box' || kind === 'component') return <IconSquare width={12} height={12} />
  return <IconType width={12} height={12} />
}

export function LayersTree() {
  const nodes = useVeditNodes()
  const tree = useMemo(() => buildTree(nodes), [nodes])

  return (
    <div className="vedit-panel-body">
      {tree.length ? (
        tree.map((entry) => <LayerRow key={entry.node.id} entry={entry} depth={0} />)
      ) : (
        <div className="vedit-section vedit-hint">
          Nothing registered yet. Wrap elements in <code>&lt;Editable&gt;</code> or turn on
          <code> auto</code> scanning.
        </div>
      )}
    </div>
  )
}

function LayerRow({ entry, depth }: { entry: TreeNode; depth: number }) {
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
        data-selected={selected ? 'true' : 'false'}
        data-hidden={hidden ? 'true' : 'false'}
        style={{ paddingLeft: 10 + depth * 12 }}
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
        <LayerRow key={child.node.id} entry={child} depth={depth + 1} />
      ))}
    </>
  )
}
