/**
 * `filter`, like `transform`, is one property carrying several independent ideas —
 * a blur, a hue shift, a drop shadow — so the inspector parses it into parts,
 * edits one, and puts it back rather than overwriting whatever was there.
 */
import { splitFunctions } from './tokens'

export interface FilterParts {
  /** px, 0 = none. */
  blur: number
  /** 1 = none. */
  brightness: number
  /** 1 = none. */
  contrast: number
  /** 1 = none. */
  saturate: number
  /** deg, 0 = none. */
  hueRotate: number
  /** 0–1, 0 = none. */
  grayscale: number
  /**
   * The inside of `drop-shadow(…)`. A shape's shadow has to be a filter rather
   * than a `box-shadow`, because a box shadow follows the element's box and not
   * the artwork's outline.
   */
  dropShadow?: string
  /**
   * Filter functions this module doesn't model, kept verbatim and in order so a
   * value someone hand-wrote survives a slider drag. They serialise first, ahead
   * of the known parts, so editing a slider never reshuffles them.
   */
  rest?: string[]
}

export const FILTER_IDENTITY: FilterParts = {
  blur: 0,
  brightness: 1,
  contrast: 1,
  saturate: 1,
  hueRotate: 0,
  grayscale: 0,
}

/** A number, or undefined when the argument isn't one — a malformed part stays in `rest`. */
function numeric(argument: string): number | undefined {
  const match = /^(-?[\d.]+)$/.exec(argument.trim())
  if (!match) return undefined
  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : undefined
}

export function parseFilter(value: string | number | undefined): FilterParts {
  const parts: FilterParts = { ...FILTER_IDENTITY }
  if (typeof value !== 'string') return parts

  const rest: string[] = []
  for (const fn of splitFunctions(value)) {
    if (fn === 'none') continue
    const match = /^([a-zA-Z-]+)\((.*)\)$/s.exec(fn)
    if (!match) {
      rest.push(fn)
      continue
    }
    const [, name, argument] = match
    if (name === 'drop-shadow') {
      parts.dropShadow = argument.trim()
      continue
    }
    // `blur(2px)` and `hue-rotate(90deg)` carry a unit; the rest are bare ratios.
    const stripped = name === 'blur' || name === 'hue-rotate' ? argument.replace(/(px|deg)\s*$/, '') : argument
    const amount = numeric(stripped)
    if (amount === undefined) {
      rest.push(fn)
      continue
    }
    if (name === 'blur') parts.blur = amount
    else if (name === 'brightness') parts.brightness = amount
    else if (name === 'contrast') parts.contrast = amount
    else if (name === 'saturate') parts.saturate = amount
    else if (name === 'hue-rotate') parts.hueRotate = amount
    else if (name === 'grayscale') parts.grayscale = amount
    else rest.push(fn)
  }
  if (rest.length) parts.rest = rest
  return parts
}

export function serializeFilter(parts: FilterParts): string | undefined {
  const round = (value: number) => Math.round(value * 1000) / 1000
  const pieces: string[] = [...(parts.rest ?? [])]
  if (parts.blur) pieces.push(`blur(${round(parts.blur)}px)`)
  if (parts.brightness !== 1) pieces.push(`brightness(${round(parts.brightness)})`)
  if (parts.contrast !== 1) pieces.push(`contrast(${round(parts.contrast)})`)
  if (parts.saturate !== 1) pieces.push(`saturate(${round(parts.saturate)})`)
  if (parts.hueRotate) pieces.push(`hue-rotate(${round(parts.hueRotate)}deg)`)
  if (parts.grayscale) pieces.push(`grayscale(${round(parts.grayscale)})`)
  if (parts.dropShadow) pieces.push(`drop-shadow(${parts.dropShadow})`)
  return pieces.length ? pieces.join(' ') : undefined
}

/** Change some parts, keeping the rest of an existing filter intact. */
export function withFilter(
  current: string | number | undefined,
  patch: Partial<FilterParts>,
): string | undefined {
  return serializeFilter({ ...parseFilter(current), ...patch })
}
