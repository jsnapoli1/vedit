/**
 * Motion is a closed set of presets, written and audited here.
 *
 * User-typed `@keyframes` were rejected for the reason user-typed regexes were:
 * they are stored data that runs on every visitor's page, and keyframe text is a
 * CSS injection surface. These bodies are constants in the source, so nothing in
 * a document ever reaches a `@keyframes` block — only the choice of which of the
 * six to emit does.
 */
export type AnimationPreset = 'spin' | 'pulse' | 'float' | 'fadeIn' | 'draw' | 'wiggle'

export interface AnimationPresetDefinition {
  label: string
  /** The body of the `@keyframes` block, without the name or the outer braces. */
  keyframes: string
  /** Milliseconds. */
  duration: number
  easing: string
  loops: boolean
}

export const ANIMATION_PRESETS: Record<AnimationPreset, AnimationPresetDefinition> = {
  spin: {
    label: 'Spin',
    keyframes: 'from{transform:rotate(0deg)}to{transform:rotate(360deg)}',
    duration: 2000,
    easing: 'linear',
    loops: true,
  },
  pulse: {
    label: 'Pulse',
    keyframes: '0%{transform:scale(1)}50%{transform:scale(1.06)}100%{transform:scale(1)}',
    duration: 1600,
    easing: 'ease-in-out',
    loops: true,
  },
  float: {
    label: 'Float',
    keyframes: '0%{transform:translateY(0)}50%{transform:translateY(-8px)}100%{transform:translateY(0)}',
    duration: 3000,
    easing: 'ease-in-out',
    loops: true,
  },
  fadeIn: {
    label: 'Fade in',
    keyframes: 'from{opacity:0}to{opacity:1}',
    duration: 600,
    easing: 'ease-out',
    loops: false,
  },
  draw: {
    // The from-frame sets the dasharray as well as the offset: every preset shape
    // carries `pathLength="1"`, so one turn of dash covers the whole outline and
    // nobody has to set `stroke-dasharray` by hand for this to draw.
    label: 'Draw',
    keyframes: 'from{stroke-dasharray:1;stroke-dashoffset:1}to{stroke-dasharray:1;stroke-dashoffset:0}',
    duration: 1200,
    easing: 'ease-in-out',
    loops: false,
  },
  wiggle: {
    label: 'Wiggle',
    keyframes:
      '0%{transform:rotate(0deg)}25%{transform:rotate(3deg)}75%{transform:rotate(-3deg)}100%{transform:rotate(0deg)}',
    duration: 500,
    easing: 'ease-in-out',
    loops: true,
  },
}

const PRESET_NAMES = Object.keys(ANIMATION_PRESETS) as AnimationPreset[]

/** Namespaced so a preset can never collide with an animation the host site already has. */
export function animationName(preset: AnimationPreset): string {
  return `vedit-${preset}`
}

export interface AnimationParts {
  preset: AnimationPreset
  /** Milliseconds. */
  duration: number
  easing: string
  loops: boolean
}

/**
 * Which presets a declaration value references. The word boundary matters: a host
 * stylesheet's `vedit-spinner` is not our `vedit-spin`.
 */
export function presetsIn(value: string): AnimationPreset[] {
  if (typeof value !== 'string' || !value) return []
  return PRESET_NAMES.filter((preset) => new RegExp(`(^|[^\\w-])${animationName(preset)}([^\\w-]|$)`).test(value))
}

/**
 * Reads the `animation` shorthand back into parts. Order is not significant in the
 * shorthand, so neither is it here: whichever token looks like a preset name, a
 * time, or a repeat count is taken as that. Anything not naming one of the six is
 * null — a host's own animation is left alone rather than mangled.
 */
export function parseAnimation(value: string | number | undefined): AnimationParts | null {
  if (typeof value !== 'string') return null
  const tokens = value.trim().split(/[\s,]+/).filter(Boolean)
  const preset = PRESET_NAMES.find((name) => tokens.includes(animationName(name)))
  if (!preset) return null

  const definition = ANIMATION_PRESETS[preset]
  const parts: AnimationParts = {
    preset,
    duration: definition.duration,
    easing: definition.easing,
    loops: definition.loops,
  }

  for (const token of tokens) {
    const time = /^(-?[\d.]+)(ms|s)$/.exec(token)
    if (time) {
      const amount = Number(time[1])
      if (Number.isFinite(amount)) parts.duration = time[2] === 's' ? amount * 1000 : amount
      continue
    }
    if (token === 'infinite') {
      parts.loops = true
      continue
    }
    if (/^\d+(\.\d+)?$/.test(token)) {
      parts.loops = false
      continue
    }
    if (token === animationName(preset)) continue
    // Whatever is left that isn't a name, a time or a count is the timing function.
    if (/^[a-zA-Z][\w-]*$/.test(token) || token.startsWith('cubic-bezier') || token.startsWith('steps')) {
      parts.easing = token
    }
  }
  return parts
}

export function serializeAnimation(parts: AnimationParts): string {
  const duration = Math.round(parts.duration)
  return `${animationName(parts.preset)} ${duration}ms ${parts.easing} ${parts.loops ? 'infinite' : '1'}`
}

/** The `@keyframes` blocks for exactly the presets given, each emitted once. */
export function keyframesFor(presets: Iterable<AnimationPreset>): string {
  const wanted = new Set(presets)
  // Iterate the preset table rather than the caller's set, so the output order is
  // stable no matter what order the emitter happened to find them in.
  return PRESET_NAMES.filter((preset) => wanted.has(preset))
    .map((preset) => `@keyframes ${animationName(preset)}{${ANIMATION_PRESETS[preset].keyframes}}`)
    .join('\n')
}

/**
 * The single `!important` in the codebase, and it is on the visitor's side: a
 * vestibular preference beats a design choice. `fadeIn` and `draw` end in their
 * final frame, so shortening them leaves nothing invisible.
 */
export const REDUCED_MOTION_RULE =
  '@media (prefers-reduced-motion:reduce){[data-vedit-id]{animation-duration:.01ms!important;animation-iteration-count:1!important}}'
