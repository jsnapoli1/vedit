import type { Breakpoint, NodeOverride, StyleLayer, StyleMap, StyleState } from './types'

/**
 * Overrides are a small matrix: interaction state × breakpoint. These helpers are
 * the only place that knows its shape, so the store and the inspector can talk in
 * terms of "the cell the user is currently editing".
 */

export function readLayer(override: NodeOverride | undefined, state: StyleState): StyleLayer | undefined {
  if (!override) return undefined
  return state === 'default' ? override : override.states?.[state]
}

export function readStyles(
  override: NodeOverride | undefined,
  state: StyleState,
  breakpoint: Breakpoint,
): StyleMap {
  const layer = readLayer(override, state)
  if (!layer) return {}
  return (breakpoint === 'base' ? layer.style : layer.responsive?.[breakpoint]) ?? {}
}

export function readStyleValue(
  override: NodeOverride | undefined,
  state: StyleState,
  breakpoint: Breakpoint,
  property: string,
): string | number | undefined {
  return readStyles(override, state, breakpoint)[property]
}

function writeLayer(
  override: NodeOverride,
  state: StyleState,
  update: (layer: StyleLayer) => StyleLayer,
): NodeOverride {
  if (state === 'default') {
    const { style, responsive } = update({ style: override.style, responsive: override.responsive })
    return { ...override, style, responsive }
  }
  return {
    ...override,
    states: { ...override.states, [state]: update(override.states?.[state] ?? {}) },
  }
}

/** Merge declarations into one cell of the matrix. */
export function mergeStyles(
  override: NodeOverride,
  state: StyleState,
  breakpoint: Breakpoint,
  styles: StyleMap,
): NodeOverride {
  return writeLayer(override, state, (layer) =>
    breakpoint === 'base'
      ? { ...layer, style: { ...layer.style, ...styles } }
      : {
          ...layer,
          responsive: { ...layer.responsive, [breakpoint]: { ...layer.responsive?.[breakpoint], ...styles } },
        },
  )
}

/** Replace one cell of the matrix outright. */
export function replaceStyles(
  override: NodeOverride,
  state: StyleState,
  breakpoint: Breakpoint,
  styles: StyleMap,
): NodeOverride {
  return writeLayer(override, state, (layer) =>
    breakpoint === 'base'
      ? { ...layer, style: styles }
      : { ...layer, responsive: { ...layer.responsive, [breakpoint]: styles } },
  )
}

/** Remove declarations from one cell, falling back to the site's own styling. */
export function deleteStyles(
  override: NodeOverride,
  state: StyleState,
  breakpoint: Breakpoint,
  properties: string[],
): NodeOverride {
  return writeLayer(override, state, (layer) => {
    const target = { ...((breakpoint === 'base' ? layer.style : layer.responsive?.[breakpoint]) ?? {}) }
    for (const property of properties) delete target[property]
    return breakpoint === 'base'
      ? { ...layer, style: target }
      : { ...layer, responsive: { ...layer.responsive, [breakpoint]: target } }
  })
}

/** Strip empty style maps, empty states and blank fields so documents stay small. */
export function pruneOverride(override: NodeOverride): NodeOverride | undefined {
  const next: NodeOverride = { ...override }

  const pruneLayer = (layer: StyleLayer): StyleLayer | undefined => {
    const result: StyleLayer = { ...layer }
    if (result.style && Object.keys(result.style).length === 0) delete result.style
    if (result.responsive) {
      const responsive = { ...result.responsive }
      for (const key of Object.keys(responsive) as Array<Exclude<Breakpoint, 'base'>>) {
        if (!responsive[key] || Object.keys(responsive[key]!).length === 0) delete responsive[key]
      }
      if (Object.keys(responsive).length) result.responsive = responsive
      else delete result.responsive
    }
    return Object.keys(result).length ? result : undefined
  }

  const base = pruneLayer({ style: next.style, responsive: next.responsive })
  next.style = base?.style
  next.responsive = base?.responsive
  if (!next.style) delete next.style
  if (!next.responsive) delete next.responsive

  if (next.states) {
    const states = { ...next.states }
    for (const key of Object.keys(states) as Array<Exclude<StyleState, 'default'>>) {
      const pruned = states[key] ? pruneLayer(states[key]!) : undefined
      if (pruned) states[key] = pruned
      else delete states[key]
    }
    if (Object.keys(states).length) next.states = states
    else delete next.states
  }

  if (next.props && Object.keys(next.props).length === 0) delete next.props

  for (const key of ['text', 'html', 'src', 'alt', 'href', 'target', 'className'] as const) {
    if (next[key] === undefined || next[key] === '') delete next[key]
  }
  if (next.hidden === false) delete next.hidden
  if (next.shape === undefined) delete next.shape

  return Object.keys(next).length ? next : undefined
}
