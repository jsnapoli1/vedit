import {
  DEFAULT_BREAKPOINTS,
  type Breakpoint,
  type BreakpointWidths,
  type StyleMap,
  type VeditDocument,
} from '../core/types'

/** Properties whose bare numbers are *not* pixel lengths. */
const UNITLESS = new Set([
  'opacity',
  'zIndex',
  'fontWeight',
  'lineHeight',
  'flexGrow',
  'flexShrink',
  'order',
  'flex',
  'zoom',
  'aspectRatio',
])

export function toKebab(property: string): string {
  return property.startsWith('--') ? property : property.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
}

export function toCssValue(property: string, value: string | number): string {
  if (typeof value === 'number' && !UNITLESS.has(property) && value !== 0) return `${value}px`
  return String(value)
}

export function declarations(style: StyleMap): string {
  return Object.entries(style)
    .filter(([, value]) => value !== '' && value !== undefined && value !== null)
    .map(([property, value]) => `${toKebab(property)}:${toCssValue(property, value)}`)
    .join(';')
}

/** Escape a node id for use inside an attribute selector. */
function escapeId(id: string): string {
  return id.replace(/["\\]/g, '\\$&')
}

/**
 * Overrides are emitted as a stylesheet rather than inline styles so that
 * responsive breakpoints work with real media queries (and so server rendering
 * produces the same paint as the client). The selector is repeated to raise
 * specificity above ordinary site CSS without resorting to `!important`.
 */
function selector(id: string, weight: number): string {
  return `[data-vedit-id="${escapeId(id)}"]`.repeat(weight)
}

export function documentToCss(
  doc: VeditDocument,
  breakpoints: BreakpointWidths = DEFAULT_BREAKPOINTS,
): string {
  const base: string[] = []
  const media = new Map<Exclude<Breakpoint, 'base'>, string[]>()

  for (const [id, override] of Object.entries(doc.nodes)) {
    if (override.hidden) {
      // Hidden nodes stay in the layout while editing (dimmed) so they can be
      // found and brought back; visitors never see them at all.
      base.push(`html:not(.vedit-editing) ${selector(id, 3)}{display:none !important}`)
      base.push(
        `html.vedit-editing ${selector(id, 3)}{opacity:.35;outline:1px dashed var(--vedit-accent,#4f46e5)}`,
      )
    }
    if (override.style && Object.keys(override.style).length) {
      base.push(`${selector(id, 2)}{${declarations(override.style)}}`)
    }
    for (const [bp, style] of Object.entries(override.responsive ?? {})) {
      if (!style || !Object.keys(style).length) continue
      const key = bp as Exclude<Breakpoint, 'base'>
      const bucket = media.get(key) ?? []
      bucket.push(`${selector(id, 3)}{${declarations(style)}}`)
      media.set(key, bucket)
    }
  }

  const ordered = (Object.keys(breakpoints) as Array<Exclude<Breakpoint, 'base'>>).sort(
    (a, b) => breakpoints[a] - breakpoints[b],
  )
  const queries = ordered
    .filter((bp) => media.has(bp))
    .map((bp) => `@media (min-width:${breakpoints[bp]}px){${media.get(bp)!.join('')}}`)

  return [...base, ...queries].join('\n')
}
