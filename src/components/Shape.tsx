import { createElement, useMemo } from 'react'
import { Editable } from './Editable'
import { useVeditState } from '../core/context'
import { sanitizeSvg } from '../runtime/sanitize'
import { parseShape, shapeElements } from '../runtime/shape'
import type { InsertedNode, ShapeSpec } from '../core/types'

/**
 * A shape the editor placed: an inline `<svg>` carrying `data-vedit-id`, so
 * selection, outlines, drag-to-move, resize handles, the layer tree and every
 * style control work on it unchanged.
 *
 * Fill, stroke and stroke width are *inherited* SVG properties set on the root
 * by the ordinary stylesheet, which is why the children below carry none of
 * them.
 */
export function ShapeView({ node }: { node: InsertedNode }) {
  const stored = useVeditState((state) => state.doc.nodes[node.id]?.shape)
  const shape = useMemo(() => parseShape(stored), [stored])

  // Sanitised again here and not only at import: the document is data, and it
  // can arrive from a store, a script or an agent that never went near the
  // import path. Scoped with the node id because ids in inline SVG are
  // page-global — two copies of one logo would otherwise share a gradient.
  const custom = useMemo(
    () => (shape?.type === 'custom' ? sanitizeSvg(shape.svg, { scope: node.id, viewBox: shape.viewBox }) : null),
    [shape, node.id],
  )

  if (!shape) {
    // A broken override draws nothing rather than throwing, and stays
    // selectable so whoever finds it can delete it.
    return <Editable id={node.id} as="svg" kind="shape" label="Shape" viewBox="0 0 100 100" />
  }

  if (shape.type === 'custom') {
    return (
      <Editable
        id={node.id}
        as="svg"
        kind="shape"
        label="Shape"
        viewBox={shape.viewBox}
        // Imported artwork keeps its proportions; a logo squashed by a box of
        // the wrong shape is not what anyone meant.
        preserveAspectRatio="xMidYMid meet"
        xmlns="http://www.w3.org/2000/svg"
        // Not `override.html`: that path runs `sanitizeHtml`, whose allow-list is
        // for rich text and strips every SVG tag there is.
        dangerouslySetInnerHTML={{ __html: custom?.svg ?? '' }}
      />
    )
  }

  return (
    <Editable
      id={node.id}
      as="svg"
      kind="shape"
      label={labelFor(shape)}
      viewBox="0 0 100 100"
      // The element's CSS width and height are the whole story of how big a
      // preset is: a circle in a 200 × 100 box is an ellipse, which is what
      // dragging a corner handle is meant to do.
      preserveAspectRatio="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {shapeElements(shape).map((element, index) =>
        createElement(element.tag, { key: index, ...element.attrs }),
      )}
    </Editable>
  )
}

function labelFor(shape: ShapeSpec): string {
  switch (shape.type) {
    case 'rect':
      return 'Rectangle'
    case 'circle':
      return 'Circle'
    case 'line':
      return 'Line'
    case 'polygon':
      return 'Polygon'
    default:
      return 'Shape'
  }
}
