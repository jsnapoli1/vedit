import { sanitizeSvg } from './sanitize'
import type { ShapePreset, ShapeSpec, StyleMap } from '../core/types'

/**
 * Shapes are geometry in a 100 × 100 box, and nothing else. How big one is on
 * the page is the element's CSS `width` and `height` — the Layout fields, the
 * resize handles — so the box here is a coordinate system and never a size.
 */

/** The six shapes the Insert panel and the MCP server offer by name. */
export const SHAPE_PRESETS: Record<ShapePreset, ShapeSpec> = {
  rect: { type: 'rect' },
  circle: { type: 'circle' },
  line: { type: 'line', x1: 0, y1: 50, x2: 100, y2: 50 },
  triangle: { type: 'polygon', points: [[50, 0], [100, 100], [0, 100]] },
  star: { type: 'polygon', points: starPoints() },
  hexagon: { type: 'polygon', points: hexagonPoints() },
}

/** Fewer than three and it isn't a polygon; more than this and it isn't a shape. */
const MIN_POINTS = 3
const MAX_POINTS = 256

/**
 * The untrusted parser. A stored shape comes from the same place every other
 * override does — a database, a script, an agent — so it gets the same treatment:
 * finite numbers, a bounded point count, and markup that has been through the
 * sanitiser.
 *
 * Always returns a fresh object, never the input, so a caller can't hold a
 * reference into the document and mutate it afterwards.
 */
export function parseShape(value: unknown): ShapeSpec | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  switch (raw.type) {
    case 'rect': {
      if (raw.rx === undefined || raw.rx === null) return { type: 'rect' }
      const rx = finite(raw.rx)
      if (rx === null) return null
      // Beyond half the box a radius is just an ellipse, and a negative one is
      // an error the browser would render as a sharp corner.
      return { type: 'rect', rx: Math.min(50, Math.max(0, rx)) }
    }
    case 'circle':
      return { type: 'circle' }
    case 'line': {
      const x1 = finite(raw.x1)
      const y1 = finite(raw.y1)
      const x2 = finite(raw.x2)
      const y2 = finite(raw.y2)
      if (x1 === null || y1 === null || x2 === null || y2 === null) return null
      return { type: 'line', x1, y1, x2, y2 }
    }
    case 'polygon': {
      if (!Array.isArray(raw.points)) return null
      if (raw.points.length < MIN_POINTS || raw.points.length > MAX_POINTS) return null
      const points: Array<[number, number]> = []
      for (const pair of raw.points) {
        if (!Array.isArray(pair) || pair.length !== 2) return null
        const x = finite(pair[0])
        const y = finite(pair[1])
        if (x === null || y === null) return null
        points.push([x, y])
      }
      return { type: 'polygon', points }
    }
    case 'custom': {
      if (typeof raw.svg !== 'string') return null
      const stored =
        typeof raw.viewBox === 'string' && /^-?[\d.]+( -?[\d.]+){3}$/.test(raw.viewBox) ? raw.viewBox : undefined
      // Unscoped: what is stored stays portable, and the render path scopes with
      // the node id so two copies of one import don't share a gradient. The
      // viewBox goes in because a *stored* shape is inner markup with no root of
      // its own to read one from.
      const cleaned = sanitizeSvg(raw.svg, { viewBox: stored })
      if (!cleaned) return null
      return { type: 'custom', svg: cleaned.svg, viewBox: stored ?? cleaned.viewBox }
    }
    default:
      return null
  }
}

/** The style an inserted shape starts with. */
export function shapeStyleDefaults(shape: ShapeSpec): StyleMap {
  if (shape.type === 'line') {
    // A line has no area to fill, so its colour is its stroke — and a default
    // fill of black would draw a triangle over an open polyline.
    return {
      display: 'block',
      width: '160px',
      height: '24px',
      fill: 'none',
      stroke: '#94a3b8',
      strokeWidth: '2px',
      strokeLinecap: 'round',
    }
  }
  if (shape.type === 'custom') {
    // No fill: imported artwork brings its own colours, and setting one here
    // would repaint every icon set that leaves its paths unfilled on purpose.
    return { display: 'block', width: '160px', height: '160px' }
  }
  return { display: 'block', width: '160px', height: '160px', fill: '#94a3b8' }
}

/** One child element of a preset shape's `<svg>`. */
export interface ShapeElement {
  tag: 'rect' | 'ellipse' | 'line' | 'polygon'
  attrs: Record<string, string>
}

/**
 * Geometry for the preset shapes, as attribute bags per child element.
 *
 * The attribute names are React's SVG prop names — `vectorEffect`, `pathLength`,
 * `strokeWidth` — not the DOM's hyphenated ones, because these go straight into
 * `createElement`. React converts them; a hyphenated name would be passed
 * through verbatim and, for `vector-effect`, silently ignored in development
 * warnings.
 *
 * The children carry no `fill`, `stroke` or `stroke-width`: those are inherited
 * SVG properties, so the stylesheet sets them on the root `<svg>` through the
 * ordinary state × breakpoint matrix and hover states, breakpoints and colour
 * tokens work without a line of new code.
 */
export function shapeElements(shape: Exclude<ShapeSpec, { type: 'custom' }>): ShapeElement[] {
  // `pathLength="1"` on everything so the `draw` animation — stroke-dashoffset
  // 1 → 0 — works whatever the geometry actually measures.
  // `vectorEffect="non-scaling-stroke"` so a stroke stays the width someone
  // chose when the box is stretched by a resize handle.
  const common = { pathLength: '1', vectorEffect: 'non-scaling-stroke' }
  switch (shape.type) {
    case 'rect':
      return [
        {
          tag: 'rect',
          attrs: {
            x: '0',
            y: '0',
            width: '100',
            height: '100',
            ...(shape.rx ? { rx: round(shape.rx) } : {}),
            ...common,
          },
        },
      ]
    case 'circle':
      return [{ tag: 'ellipse', attrs: { cx: '50', cy: '50', rx: '50', ry: '50', ...common } }]
    case 'line':
      return [
        {
          tag: 'line',
          attrs: {
            x1: round(shape.x1),
            y1: round(shape.y1),
            x2: round(shape.x2),
            y2: round(shape.y2),
            ...common,
          },
        },
      ]
    case 'polygon':
      return [
        {
          tag: 'polygon',
          attrs: { points: shape.points.map(([x, y]) => `${round(x)},${round(y)}`).join(' '), ...common },
        },
      ]
  }
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function round(value: number): string {
  return String(Math.round(value * 1000) / 1000)
}

/** A five-point star inscribed in the box, points up. */
function starPoints(): Array<[number, number]> {
  const points: Array<[number, number]> = []
  for (let index = 0; index < 10; index += 1) {
    const radius = index % 2 === 0 ? 50 : 20
    const angle = (Math.PI / 5) * index - Math.PI / 2
    points.push([snap(50 + radius * Math.cos(angle)), snap(50 + radius * Math.sin(angle))])
  }
  return points
}

/** A regular hexagon, flat top and bottom. */
function hexagonPoints(): Array<[number, number]> {
  const points: Array<[number, number]> = []
  for (let index = 0; index < 6; index += 1) {
    const angle = (Math.PI / 3) * index - Math.PI / 2
    points.push([snap(50 + 50 * Math.cos(angle)), snap(50 + 50 * Math.sin(angle))])
  }
  return points
}

function snap(value: number): number {
  return Math.round(value * 100) / 100
}
