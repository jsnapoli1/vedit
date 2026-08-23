/** A gradient the editor can round-trip through its controls. */
export interface GradientStop {
  color: string
  /** Percentage along the gradient. */
  position: number
}

export interface Gradient {
  type: 'linear' | 'radial'
  /** Degrees, for linear gradients. */
  angle: number
  stops: GradientStop[]
}

export const DEFAULT_GRADIENT: Gradient = {
  type: 'linear',
  angle: 180,
  stops: [
    { color: '#6366f1', position: 0 },
    { color: '#22d3ee', position: 100 },
  ],
}

/** Split on commas that aren't inside parentheses — `rgba(0, 0, 0, .5)` is one part. */
function splitTopLevel(value: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of value) {
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (char === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

export function parseGradient(value: string | number | undefined): Gradient | null {
  if (typeof value !== 'string') return null
  const match = /^(linear|radial)-gradient\((.*)\)$/s.exec(value.trim())
  if (!match) return null

  const type = match[1] as Gradient['type']
  const parts = splitTopLevel(match[2])
  let angle = type === 'linear' ? 180 : 0

  if (parts.length && /^-?[\d.]+deg$/.test(parts[0])) {
    angle = Number.parseFloat(parts.shift()!)
  } else if (parts.length && /^(to\s+|circle|ellipse|at\s+)/.test(parts[0])) {
    // Keyword direction: keep the gradient but fall back to a plain angle.
    parts.shift()
  }

  const stops: GradientStop[] = []
  parts.forEach((part, index) => {
    const stop = /^(.*?)(?:\s+(-?[\d.]+)%)?$/.exec(part.trim())
    if (!stop?.[1]) return
    stops.push({
      color: stop[1].trim(),
      position: stop[2] !== undefined ? Number(stop[2]) : (index / Math.max(1, parts.length - 1)) * 100,
    })
  })

  return stops.length >= 2 ? { type, angle, stops } : null
}

export function serializeGradient(gradient: Gradient): string {
  const stops = [...gradient.stops]
    .sort((a, b) => a.position - b.position)
    .map((stop) => `${stop.color} ${Math.round(stop.position)}%`)
    .join(', ')
  return gradient.type === 'linear'
    ? `linear-gradient(${Math.round(gradient.angle)}deg, ${stops})`
    : `radial-gradient(circle, ${stops})`
}

/** A CSS value suitable for a swatch preview. */
export function gradientPreview(gradient: Gradient): string {
  return serializeGradient({ ...gradient, angle: 90 })
}
