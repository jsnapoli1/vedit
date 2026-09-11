import { readLayer } from '../core/layers'
import { keyframesFor, presetsIn, REDUCED_MOTION_RULE, type AnimationPreset } from './animation'
import {
  DEFAULT_BREAKPOINTS,
  STYLE_STATES,
  type Breakpoint,
  type BreakpointWidths,
  type DesignToken,
  type StyleLayer,
  type StyleMap,
  type StyleState,
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
  'animationIterationCount',
])

export function toKebab(property: string): string {
  return property.startsWith('--') ? property : property.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
}

export function toCssValue(property: string, value: string | number): string {
  if (typeof value === 'number' && !UNITLESS.has(property) && value !== 0) return `${value}px`
  return String(value)
}

/** Anything that could end a declaration, a rule, or the `<style>` element itself. */
const CSS_BREAKOUT = /[{}<>;@\\]/g
const CSS_PROPERTY = /^-{0,2}[a-zA-Z][\w-]*$/

/**
 * A stored document is data, and it is rendered into a `<style>` element on every
 * visitor's page. A value carrying `}` would close the rule and let the rest
 * inject arbitrary CSS; `</style` would leave CSS altogether. Strip both, and
 * refuse property names that aren't property names.
 */
export function declarations(style: StyleMap): string {
  return Object.entries(style)
    .filter(([property, value]) => CSS_PROPERTY.test(property) && value !== '' && value != null)
    .map(([property, value]) => `${toKebab(property)}:${safeCssValue(property, value)}`)
    .join(';')
}

export function safeCssValue(property: string, value: string | number): string {
  return toCssValue(property, value).replace(CSS_BREAKOUT, '').trim()
}

/** The CSS custom property a token is published as. */
export function tokenVariable(token: Pick<DesignToken, 'id'>): string {
  return `--vedit-${token.id}`
}

/** A value referencing a token, ready to drop into a declaration. */
export function tokenReference(token: Pick<DesignToken, 'id'>): string {
  return `var(${tokenVariable(token)})`
}

/** Escape a node id for use inside an attribute selector. */
function escapeId(id: string): string {
  return id.replace(/["\\]/g, '\\$&')
}

/**
 * Overrides are emitted as a stylesheet rather than inline styles so that
 * responsive breakpoints and interaction states work with real CSS (and so server
 * rendering produces the same paint as the client). The selector is repeated to
 * raise specificity above ordinary site CSS without resorting to `!important`,
 * and state rules repeat it once more so they win over the element's base styles.
 */
function selector(id: string, weight: number, state: StyleState): string {
  const base = `[data-vedit-id="${escapeId(id)}"]`.repeat(weight)
  if (state === 'default') return base
  // The second selector lets the editor force a state on so you can style a hover
  // without having to keep the pointer still on the element.
  return `${base}:${state},${base}[data-vedit-force="${state}"]`
}

const TOKEN_ID = /^[a-zA-Z0-9_-]+$/

function tokensCss(tokens: DesignToken[] | undefined): string {
  if (!tokens?.length) return ''
  const body = tokens
    .filter((token) => token.value !== '' && TOKEN_ID.test(token.id))
    .map((token) => `${tokenVariable(token)}:${safeCssValue(token.id, token.value)}`)
    .join(';')
  return body ? `:root{${body}}` : ''
}

export function documentToCss(
  doc: VeditDocument,
  breakpoints: BreakpointWidths = DEFAULT_BREAKPOINTS,
): string {
  const base: string[] = []
  const media = new Map<Exclude<Breakpoint, 'base'>, string[]>()
  const animating = new Set<AnimationPreset>()

  /**
   * Which motion presets this rule uses. The maps are scanned as they are emitted
   * rather than the finished stylesheet being regexed: a host site's own
   * `vedit-spin` mentioned in some unrelated value shouldn't conjure a keyframes
   * block, and only an `animation`/`animation-name` declaration means motion.
   */
  const collect = (style: StyleMap) => {
    for (const property of ['animation', 'animationName'] as const) {
      const value = style[property]
      if (typeof value !== 'string') continue
      for (const preset of presetsIn(value)) animating.add(preset)
    }
  }

  const emit = (id: string, layer: StyleLayer | undefined, state: StyleState) => {
    if (!layer) return
    // States sit one specificity step above the element's own base styles.
    const weight = state === 'default' ? 2 : 3
    if (layer.style && Object.keys(layer.style).length) {
      collect(layer.style)
      base.push(`${selector(id, weight, state)}{${declarations(layer.style)}}`)
    }
    for (const [bp, style] of Object.entries(layer.responsive ?? {})) {
      if (!style || !Object.keys(style).length) continue
      collect(style)
      const key = bp as Exclude<Breakpoint, 'base'>
      const bucket = media.get(key) ?? []
      bucket.push(`${selector(id, weight + 1, state)}{${declarations(style)}}`)
      media.set(key, bucket)
    }
  }

  for (const [id, override] of Object.entries(doc.nodes)) {
    if (override.hidden) {
      // Hidden nodes stay in the layout while editing (dimmed) so they can be
      // found and brought back; visitors never see them at all.
      base.push(`html:not(.vedit-editing) ${selector(id, 3, 'default')}{display:none !important}`)
      base.push(
        `html.vedit-editing ${selector(id, 3, 'default')}{opacity:.35;outline:1px dashed var(--vedit-accent,#0d99ff)}`,
      )
    }
    for (const state of STYLE_STATES) emit(id, readLayer(override, state), state)
  }

  const ordered = (Object.keys(breakpoints) as Array<Exclude<Breakpoint, 'base'>>).sort(
    (a, b) => breakpoints[a] - breakpoints[b],
  )
  const queries = ordered
    .filter((bp) => media.has(bp))
    .map((bp) => `@media (min-width:${breakpoints[bp]}px){${media.get(bp)!.join('')}}`)

  // Keyframes first, so a preset is defined before anything references it, and the
  // reduced-motion rule last so it wins. Both are dropped entirely when nothing
  // animates, which keeps a page with no motion emitting the CSS it always did.
  const keyframes = animating.size ? keyframesFor(animating) : ''
  const reducedMotion = animating.size ? REDUCED_MOTION_RULE : ''

  return [keyframes, tokensCss(doc.tokens), ...base, ...queries, reducedMotion].filter(Boolean).join('\n')
}
