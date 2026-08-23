/**
 * `transform` has to hold several independent ideas at once — the drag offset, a
 * rotation, a scale — so the editor parses it into parts, edits one, and puts it
 * back together rather than overwriting whatever was there.
 */
export interface TransformParts {
  translateX: number
  translateY: number
  rotate: number
  scaleX: number
  scaleY: number
}

export const IDENTITY: TransformParts = { translateX: 0, translateY: 0, rotate: 0, scaleX: 1, scaleY: 1 }

export function parseTransform(value: string | number | undefined): TransformParts {
  const parts = { ...IDENTITY }
  if (typeof value !== 'string') return parts

  const translate = /translate\(\s*(-?[\d.]+)px\s*(?:,\s*(-?[\d.]+)px\s*)?\)/.exec(value)
  if (translate) {
    parts.translateX = Number(translate[1])
    parts.translateY = translate[2] === undefined ? 0 : Number(translate[2])
  }
  const rotate = /rotate\(\s*(-?[\d.]+)deg\s*\)/.exec(value)
  if (rotate) parts.rotate = Number(rotate[1])

  const scale = /scale\(\s*(-?[\d.]+)\s*(?:,\s*(-?[\d.]+)\s*)?\)/.exec(value)
  if (scale) {
    parts.scaleX = Number(scale[1])
    parts.scaleY = scale[2] === undefined ? Number(scale[1]) : Number(scale[2])
  }
  const scaleX = /scaleX\(\s*(-?[\d.]+)\s*\)/.exec(value)
  if (scaleX) parts.scaleX = Number(scaleX[1])
  const scaleY = /scaleY\(\s*(-?[\d.]+)\s*\)/.exec(value)
  if (scaleY) parts.scaleY = Number(scaleY[1])

  return parts
}

export function serializeTransform(parts: TransformParts): string | undefined {
  const pieces: string[] = []
  const round = (value: number) => Math.round(value * 1000) / 1000
  if (parts.translateX || parts.translateY) {
    pieces.push(`translate(${round(parts.translateX)}px, ${round(parts.translateY)}px)`)
  }
  if (parts.rotate) pieces.push(`rotate(${round(parts.rotate)}deg)`)
  if (parts.scaleX !== 1 || parts.scaleY !== 1) {
    pieces.push(
      parts.scaleX === parts.scaleY
        ? `scale(${round(parts.scaleX)})`
        : `scale(${round(parts.scaleX)}, ${round(parts.scaleY)})`,
    )
  }
  return pieces.length ? pieces.join(' ') : undefined
}

/** Change some parts, keeping the rest of an existing transform intact. */
export function withTransform(
  current: string | number | undefined,
  patch: Partial<TransformParts>,
): string | undefined {
  return serializeTransform({ ...parseTransform(current), ...patch })
}
