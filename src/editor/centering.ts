/**
 * Centring a box inside whatever its parent happens to be.
 *
 * There is no one declaration that does it: a block parent centres its child
 * with auto margins, a flex line centres across itself with `align-self`, and a
 * grid cell has a `*-self` per axis. So the properties are chosen from the
 * parent, and an axis CSS cannot centre on — the vertical one in a block — is
 * not offered at all rather than written and left doing nothing.
 *
 * Where both would work, auto margins win. `VeditStore.setStyle` pins a sized
 * flex child with `align-self: flex-start`, and an auto margin beats
 * `align-self` whichever order the two are written in.
 */

import type { StyleMap } from '../core/types'

/** The part of the parent's computed style that decides how a child is centred. */
export interface ParentLayout {
  display: string
  flexDirection: string
}

export type CenterAxis = 'horizontal' | 'vertical'

/** One offered button: what it writes, on every node it would write to. */
export interface CenterAction {
  axis: CenterAxis
  /** The button's text. */
  label: string
  /** Its accessible name, since the text alone says only the axis. */
  name: string
  /** What it writes, for the tooltip. */
  title: string
  /** Every target with its own parent-appropriate declarations. */
  entries: Array<[string, StyleMap]>
}

/** A node the inspector would write to, with the parent it sits in. */
export interface CenterTarget {
  id: string
  parent: ParentLayout | null
}

/**
 * The parent's layout, read off the live element the way the store's flex pin
 * does. Null when there is no parent, or no window to ask.
 */
export function parentLayout(element: HTMLElement | null | undefined): ParentLayout | null {
  const parent = element?.parentElement
  const view = parent?.ownerDocument?.defaultView
  if (!parent || !view || typeof view.getComputedStyle !== 'function') return null
  const style = view.getComputedStyle(parent)
  return { display: style.display, flexDirection: style.flexDirection }
}

/**
 * What to write on a child to centre it on one axis of `parent`, or null when
 * that parent gives CSS no way to do it. Longhands only: the inspector's
 * per-side margin fields read `marginLeft` and its friends, and a `margin`
 * shorthand beside them would be a second declaration saying something else.
 */
export function centeringStyles(parent: ParentLayout | null, axis: CenterAxis): StyleMap | null {
  if (!parent) return null
  const horizontal = axis === 'horizontal'
  if (parent.display.includes('grid')) {
    return horizontal ? { justifySelf: 'center' } : { alignSelf: 'center' }
  }
  if (parent.display.includes('flex')) {
    // Across the line is `align-self`'s axis; along it, the free space is the
    // margins' to take.
    const column = parent.flexDirection.startsWith('column')
    return horizontal === column ? { alignSelf: 'center' } : autoMargins(axis)
  }
  // A block or inline parent centres horizontally and has no vertical answer:
  // an auto top margin resolves to zero there.
  return horizontal ? autoMargins(axis) : null
}

function autoMargins(axis: CenterAxis): StyleMap {
  return axis === 'horizontal'
    ? { marginLeft: 'auto', marginRight: 'auto' }
    : { marginTop: 'auto', marginBottom: 'auto' }
}

/**
 * The centring buttons to offer for a selection. An axis appears only when at
 * least one selected node can be centred on it, and each node carries the
 * declarations its own parent calls for — two boxes in different containers
 * both end up centred, rather than one of them styled for the other's parent.
 */
export function centerActions(targets: CenterTarget[]): CenterAction[] {
  const actions: CenterAction[] = []
  for (const axis of ['horizontal', 'vertical'] as const) {
    const entries: Array<[string, StyleMap]> = []
    for (const target of targets) {
      const styles = centeringStyles(target.parent, axis)
      if (styles) entries.push([target.id, styles])
    }
    if (!entries.length) continue
    actions.push({
      axis,
      label: axis === 'horizontal' ? 'Horizontally' : 'Vertically',
      name: axis === 'horizontal' ? 'Center horizontally' : 'Center vertically',
      title: describe(entries),
      entries,
    })
  }
  return actions
}

/** The tooltip: what the button is about to write, in CSS's own words. */
function describe(entries: Array<[string, StyleMap]>): string {
  const shapes = new Set(entries.map(([, styles]) => Object.keys(styles).sort().join()))
  if (shapes.size > 1) return 'Centers each one the way its own parent allows'
  const declarations = Object.entries(entries[0][1]).map(([property, value]) => `${kebab(property)}: ${value}`)
  return `Sets ${declarations.join(' and ')}`
}

function kebab(property: string): string {
  return property.replace(/([A-Z])/g, '-$1').toLowerCase()
}
