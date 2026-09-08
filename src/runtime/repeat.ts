/**
 * Repeating a template over host data.
 *
 * The same rule `vars` follows: vedit stores names and shapes, never the host's
 * data. The array is passed in on every render and never written to the
 * document, so a repeat over `products` cannot go stale, cannot leak a price
 * into saved content, and cannot be edited into something the host didn't say.
 *
 * What is stored is overrides, at two levels:
 *
 *   card.title      the template  — applies to every item
 *   card.title~a    one item      — wins over the template, for that item only
 *
 * Editing a card edits the template by default, because "change the heading on
 * all six cards" is the common request and doing it six times is the reason
 * people ask for a repeater in the first place. Scoping an edit to one card is
 * one click, and where an item override shadows a template one the inspector
 * says so — a template edit that silently does nothing is exactly the class of
 * failure 0.5 spent itself removing.
 *
 * There is no expression language here, and there is not going to be one. The
 * host decides what the array contains and in what order; this file only counts.
 */

import type { NodeOverride, StyleLayer, StyleMap } from '../core/types'

/**
 * Separator between a template id and an item key.
 *
 * `:` prefixes scanner ids, `>` joins their path segments, `#` marks a DOM-id
 * anchor and `[n]` disambiguates siblings — all four are spoken for in
 * `auto/ids.ts`, so reusing one would make an id ambiguous to parse.
 */
export const ITEM_SEPARATOR = '~'

/** The id of one item's copy of a template node. */
export function itemId(templateId: string, key: string): string {
  return `${templateId}${ITEM_SEPARATOR}${key}`
}

/**
 * Split an item id back into its template id and key.
 *
 * Returns `null` for an id that names no item, which is the common case — most
 * nodes are not inside a repeat, and callers use this to ask "is it?".
 */
export function parseItemId(id: string): { templateId: string; key: string } | null {
  const at = id.lastIndexOf(ITEM_SEPARATOR)
  if (at <= 0 || at === id.length - 1) return null
  return { templateId: id.slice(0, at), key: id.slice(at + 1) }
}

/**
 * The key identifying one item of a repeat.
 *
 * A stable key from the data is what makes an edit survive the list changing:
 * key on `sku` and inserting a product at the front leaves every existing edit
 * attached to the right card. Falling back to the index is what makes the
 * feature work at all for data that has no id, and it is honest about the
 * trade — those edits are positional and will move if the list does.
 */
export function itemKey(item: unknown, index: number, explicit?: (item: unknown, index: number) => string): string {
  if (explicit) return sanitizeKey(String(explicit(item, index)), index)
  if (item && typeof item === 'object') {
    const record = item as Record<string, unknown>
    for (const candidate of ['id', 'key', 'slug', 'uuid'] as const) {
      const value = record[candidate]
      if (typeof value === 'string' && value) return sanitizeKey(value, index)
      if (typeof value === 'number' && Number.isFinite(value)) return sanitizeKey(String(value), index)
    }
  }
  return String(index)
}

/**
 * Keys become part of an id, so they cannot contain the characters that give an
 * id its structure. A key that is empty once cleaned falls back to the index
 * rather than producing `card.title~`, which `parseItemId` would refuse to read.
 */
function sanitizeKey(raw: string, index: number): string {
  const cleaned = raw.replace(/[~:>#[\]]/g, '-').trim()
  // A key of nothing but structural characters collapses to dashes and carries
  // no information — `card.title~---` names an item as poorly as `card.title~`
  // does. Fall back to the index rather than mint a meaningless id.
  return /[^-]/.test(cleaned) ? cleaned : String(index)
}

/**
 * The override one item renders with: the template's, with the item's own on
 * top.
 *
 * Deep rather than shallow, because an override is a matrix and not a flat bag.
 * A template that sets `:hover` colour at `lg` and an item that sets base text
 * have to both survive; a shallow spread would drop one of them, and the loss
 * would only show up at one breakpoint in one state — the kind of bug that gets
 * found by a customer rather than a test.
 */
export function mergeOverrides(
  template: NodeOverride | undefined,
  item: NodeOverride | undefined,
): NodeOverride {
  if (!template) return item ?? {}
  if (!item) return template

  const merged: NodeOverride = { ...template, ...item }

  // Style layers: the item's declarations win per property, so an item can
  // change the colour of a card without restating the template's padding.
  const style = { ...template.style, ...item.style }
  if (Object.keys(style).length) merged.style = style
  else delete merged.style

  const responsive = mergeByKey(template.responsive, item.responsive)
  if (responsive) merged.responsive = responsive
  else delete merged.responsive

  if (template.states || item.states) {
    const states: NonNullable<NodeOverride['states']> = {}
    const names = new Set([...Object.keys(template.states ?? {}), ...Object.keys(item.states ?? {})])
    for (const name of names) {
      const key = name as keyof NonNullable<NodeOverride['states']>
      const from = template.states?.[key]
      const to = item.states?.[key]
      const layerStyle = { ...from?.style, ...to?.style }
      const layerResponsive = mergeByKey(from?.responsive, to?.responsive)
      const layer: StyleLayer = {}
      if (Object.keys(layerStyle).length) layer.style = layerStyle
      if (layerResponsive) layer.responsive = layerResponsive
      if (Object.keys(layer).length) states[key] = layer
    }
    if (Object.keys(states).length) merged.states = states
    else delete merged.states
  }

  // Props merge per name for the same reason styles do: an item overriding
  // `variant` shouldn't discard the template's `size`.
  if (template.props || item.props) {
    merged.props = { ...template.props, ...item.props }
  }

  return merged
}

/** Merge two breakpoint maps, merging the layers that share a breakpoint. */
function mergeByKey(
  from: Record<string, StyleMap> | undefined,
  to: Record<string, StyleMap> | undefined,
): Record<string, StyleMap> | undefined {
  if (!from && !to) return undefined
  const out: Record<string, StyleMap> = {}
  for (const key of new Set([...Object.keys(from ?? {}), ...Object.keys(to ?? {})])) {
    const merged = { ...from?.[key], ...to?.[key] }
    if (Object.keys(merged).length) out[key] = merged
  }
  return Object.keys(out).length ? out : undefined
}
