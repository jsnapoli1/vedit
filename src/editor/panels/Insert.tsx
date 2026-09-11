import { useMemo, useRef } from 'react'
import { useVeditContext, useVeditNodes, useVeditState, useVeditStore } from '../../core/context'
import type { ComponentSummary } from '../../core/registry'
import type { VeditStore } from '../../core/store'
import type { NodeKind, RegisteredNode, ShapePreset, ShapeSpec } from '../../core/types'
import { SHAPE_PRESETS } from '../../runtime/shape'
import { sanitizeSvg } from '../../runtime/sanitize'
import { containerFor } from '../interactions'
import { startPlacementDrag } from '../dragToPlace'
import { useEditorTarget } from '../target'
import {
  IconCircle,
  IconHexagon,
  IconImage,
  IconLine,
  IconPlus,
  IconShape,
  IconSquare,
  IconStar,
  IconTriangle,
  IconType,
} from '../icons'

const PRIMITIVES: Array<{ kind: Exclude<NodeKind, 'component' | 'shape'>; label: string; icon: JSX.Element }> = [
  { kind: 'text', label: 'Text', icon: <IconType width={12} height={12} /> },
  { kind: 'image', label: 'Image', icon: <IconImage width={12} height={12} /> },
  { kind: 'box', label: 'Box', icon: <IconSquare width={12} height={12} /> },
  { kind: 'button', label: 'Button', icon: <IconSquare width={12} height={12} /> },
  { kind: 'link', label: 'Link', icon: <IconType width={12} height={12} /> },
]

const SHAPES: Array<{ preset: ShapePreset; label: string; icon: JSX.Element }> = [
  { preset: 'rect', label: 'Rectangle', icon: <IconSquare width={12} height={12} /> },
  { preset: 'circle', label: 'Circle', icon: <IconCircle width={12} height={12} /> },
  { preset: 'line', label: 'Line', icon: <IconLine width={12} height={12} /> },
  { preset: 'triangle', label: 'Triangle', icon: <IconTriangle width={12} height={12} /> },
  { preset: 'star', label: 'Star', icon: <IconStar width={12} height={12} /> },
  { preset: 'hexagon', label: 'Hexagon', icon: <IconHexagon width={12} height={12} /> },
]

/** What a refused import says. One sentence, and it names all three reasons. */
export const SVG_REFUSED =
  "That SVG couldn't be imported — it has no <svg> root, nothing drawable is left after cleaning, or it is larger than 64 KB"

/**
 * What can be placed on this page, and where it would go.
 *
 * The list comes from whatever the host registered, so it is the team's own
 * component library rather than a generic set of blocks. That is the whole point:
 * a page built here is built out of components that already have the site's
 * design, behaviour and accessibility in them.
 */
export function InsertPanel() {
  const store = useVeditStore()
  const { config } = useVeditContext()
  const editorTarget = useEditorTarget()
  const nodes = useVeditNodes()
  const selection = useVeditState((state) => state.selection)
  const target = useMemo(() => insertionTarget(store, selection, nodes), [store, selection, nodes])

  const grouped = useMemo(() => groupComponents(config.components), [config.components])

  const fileInput = useRef<HTMLInputElement>(null)

  const place = (kind: NodeKind, component?: string) => {
    if (!target) {
      store.notify('Nowhere to put it — select a container, or add a <VeditSlot> to the page')
      return
    }
    store.insert(target.id, kind, { component })
  }

  const placeShape = (shape: ShapeSpec) => {
    if (!target) {
      store.notify('Nowhere to put it — select a container, or add a <VeditSlot> to the page')
      return
    }
    store.insert(target.id, 'shape', { shape })
  }

  // Dragging aims for itself, so unlike clicking it does not need a selection —
  // the drop point comes from wherever the pointer is when it is let go.
  const drag = (event: React.PointerEvent, kind: NodeKind, component?: string) =>
    startPlacementDrag(event, store, editorTarget, { kind, component })

  const dragShape = (event: React.PointerEvent, shape: ShapeSpec) =>
    startPlacementDrag(event, store, editorTarget, { kind: 'shape', shape })

  return (
    <div className="vedit-panel-body">
      <div className="vedit-section">
        <div className="vedit-section-title">Adding to</div>
        <div className="vedit-hint" data-vedit-insert-target="">
          {target ? (
            <>
              <strong>{target.label}</strong>
              {target.reason ? ` — ${target.reason}` : ''}
            </>
          ) : (
            'Nothing on this page accepts new elements. Select a container, or add a <VeditSlot>.'
          )}
        </div>
      </div>

      {grouped.map(([group, items]) => (
        <div className="vedit-section" key={group}>
          <div className="vedit-section-title">{group}</div>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className="vedit-insert-item"
              disabled={!target}
              title={`Click to add to ${target?.label ?? 'the page'}, or drag it where you want it`}
              onPointerDown={(event) => drag(event, 'component', item.id)}
              onClick={() => place('component', item.id)}
            >
              <span className="vedit-insert-name">
                <IconPlus width={11} height={11} />
                {item.name}
              </span>
              {item.description ? <span className="vedit-insert-note">{item.description}</span> : null}
            </button>
          ))}
        </div>
      ))}

      <div className="vedit-section">
        <div className="vedit-section-title">Elements</div>
        {PRIMITIVES.map((item) => (
          <button
            key={item.kind}
            type="button"
            className="vedit-insert-item"
            disabled={!target}
            title={`Click to add to ${target?.label ?? 'the page'}, or drag it where you want it`}
            onPointerDown={(event) => drag(event, item.kind)}
            onClick={() => place(item.kind)}
          >
            <span className="vedit-insert-name">
              {item.icon}
              {item.label}
            </span>
          </button>
        ))}
      </div>

      {/* After Elements rather than beside them: a shape is decoration, and the
          list someone reaches for first is still the site's own components. */}
      <div className="vedit-section">
        <div className="vedit-section-title">Shapes</div>
        {SHAPES.map((item) => (
          <button
            key={item.preset}
            type="button"
            className="vedit-insert-item"
            disabled={!target}
            title={`Click to add to ${target?.label ?? 'the page'}, or drag it where you want it`}
            onPointerDown={(event) => dragShape(event, SHAPE_PRESETS[item.preset])}
            onClick={() => placeShape(SHAPE_PRESETS[item.preset])}
          >
            <span className="vedit-insert-name">
              {item.icon}
              {item.label}
            </span>
          </button>
        ))}
        {/* Import can't be dragged: there is no payload until the file has been
            read, and a drag that placed nothing on drop would be worse than a
            button that opens a picker. */}
        <button
          type="button"
          className="vedit-insert-item"
          disabled={!target}
          title={`Click to choose an SVG file and add it to ${target?.label ?? 'the page'}`}
          onClick={() => fileInput.current?.click()}
        >
          <span className="vedit-insert-name">
            <IconShape width={12} height={12} />
            Import SVG…
          </span>
          <span className="vedit-insert-note">
            Scripts, styles and external references are stripped before it is stored.
          </span>
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".svg,image/svg+xml"
          hidden
          aria-label="Import an SVG file"
          data-vedit-import-svg=""
          onChange={async (event) => {
            const file = event.target.files?.[0]
            // Cleared straight away so choosing the same file twice fires again.
            event.target.value = ''
            if (!file) return
            const cleaned = sanitizeSvg(await file.text())
            if (!cleaned) {
              store.notify(SVG_REFUSED)
              return
            }
            placeShape({ type: 'custom', svg: cleaned.svg, viewBox: cleaned.viewBox })
          }}
        />
      </div>

      {config.components.length === 0 ? (
        <div className="vedit-section vedit-hint">
          No components are registered. Pass <code>components</code> to <code>VeditProvider</code> to
          let people build pages out of your own components.
        </div>
      ) : null}
    </div>
  )
}

interface Target {
  id: string
  label: string
  /** Why this is the target, when it isn't simply what you selected. */
  reason?: string
}

/**
 * Where a new element would land: what you have selected if it can hold children,
 * otherwise the nearest thing above it that can, otherwise the page's first slot.
 *
 * Falling back to a slot matters more than it looks. Someone who opens the editor
 * to build a page has nothing selected yet, and "select a container first" is a
 * poor first instruction.
 */
export function insertionTarget(
  store: VeditStore,
  selection: string[],
  nodes: RegisteredNode[],
): Target | null {
  const selected = selection.length === 1 ? selection[0] : null
  if (selected) {
    const container = containerFor(store, selected)
    if (container) {
      const node = store.getNode(container)
      return {
        id: container,
        label: node?.label ?? container,
        reason: container === selected ? undefined : 'the nearest container above your selection',
      }
    }
  }
  const slot = nodes.find((node) => node.element?.hasAttribute?.('data-vedit-slot'))
  if (slot) {
    return { id: slot.id, label: slot.label, reason: selected ? 'the page slot' : undefined }
  }
  return null
}

function groupComponents(components: ComponentSummary[]): Array<[string, ComponentSummary[]]> {
  const groups = new Map<string, ComponentSummary[]>()
  for (const item of components) {
    const group = item.group ?? 'Components'
    const list = groups.get(group)
    if (list) list.push(item)
    else groups.set(group, [item])
  }
  return [...groups.entries()]
}
