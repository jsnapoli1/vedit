/**
 * An artboard on the canvas is as tall as the page it shows, so a `vh` in the
 * page's own CSS would resolve against the whole page rather than a screen — a
 * `90vh` hero grows the page, which grows the frame, which grows the hero,
 * until the frame hits the browser's size limit. Inside the frame, viewport
 * height units are pinned to a fixed number of pixels instead.
 *
 * The site's rules are not edited in place: Chrome shares a parsed stylesheet
 * between frames that load the same file, and a rule changed in one frame does
 * not reliably stay changed. Every rule that mentions a `vh`-family unit is
 * copied instead — same selector, same `@media`/`@supports`/`@layer` nesting,
 * units replaced with `px` — into a stylesheet appended after the site's own,
 * where the copy wins by order. Inline styles belong to their element and are
 * rewritten directly.
 */

export const CANVAS_VH_PARAM = 'vedit-vh'
const STYLE_ATTRIBUTE = 'data-vedit-vh'

/** A `vh`, `svh`, `lvh` or `dvh` length; the lookahead keeps `1vh` out of `1vhx`. */
const VH_UNIT = /(-?\d*\.?\d+)(?:s|l|d)?vh(?![\w-])/g

export function hasViewportHeightUnit(value: string): boolean {
  VH_UNIT.lastIndex = 0
  const found = VH_UNIT.test(value)
  VH_UNIT.lastIndex = 0
  return found
}

/** `calc(100vh - 80px)` at 900px → `calc(900px - 80px)`. */
export function pinViewportHeightUnits(value: string, viewportPx: number): string {
  return value.replace(VH_UNIT, (_, n: string) => `${Math.round(Number(n) * viewportPx) / 100}px`)
}

/**
 * The height a canvas frame stands in for: the editor's own screen. Fixed for
 * the life of the canvas — it travels in the frame's URL, and changing it would
 * reload the artboard and lose its unsaved edits.
 */
export function referenceViewportHeight(editorHeight: number): number {
  return Math.max(600, Math.round(editorHeight))
}

/** The reference height the parent put in the frame's URL, if any. */
export function viewportHeightFromUrl(search: string): number | null {
  const raw = new URLSearchParams(search).get(CANVAS_VH_PARAM)
  const value = raw === null ? NaN : Number(raw)
  return Number.isFinite(value) && value > 0 ? value : null
}

function pinnedDeclarations(style: CSSStyleDeclaration, viewportPx: number): string {
  const declarations: string[] = []
  for (let i = 0; i < style.length; i++) {
    const property = style[i]
    const value = style.getPropertyValue(property)
    if (!hasViewportHeightUnit(value)) continue
    const priority = style.getPropertyPriority(property)
    declarations.push(`${property}: ${pinViewportHeightUnits(value, viewportPx)}${priority ? ' !important' : ''}`)
  }
  return declarations.join('; ')
}

/** `@media (min-width: 768px) { @layer utilities { … } }` around a rule, outermost first. */
function wrapInAncestors(rule: CSSRule, body: string): string {
  let text = body
  for (let parent = rule.parentRule; parent; parent = parent.parentRule) {
    const prelude = parent.cssText.slice(0, parent.cssText.indexOf('{')).trim()
    text = `${prelude} { ${text} }`
  }
  return text
}

/** The override rules for one stylesheet, or '' when it uses no viewport height units. */
export function pinnedRulesFor(rules: CSSRuleList, viewportPx: number): string {
  const out: string[] = []
  const walk = (list: CSSRuleList) => {
    for (const rule of Array.from(list)) {
      if ('style' in rule && 'selectorText' in rule) {
        const declarations = pinnedDeclarations((rule as CSSStyleRule).style, viewportPx)
        if (declarations) out.push(wrapInAncestors(rule, `${(rule as CSSStyleRule).selectorText} { ${declarations} }`))
      }
      if ('cssRules' in rule) walk((rule as CSSGroupingRule).cssRules)
    }
  }
  walk(rules)
  return out.join('\n')
}

function rewriteInline(style: CSSStyleDeclaration, viewportPx: number): void {
  for (let i = style.length - 1; i >= 0; i--) {
    const property = style[i]
    const value = style.getPropertyValue(property)
    if (!hasViewportHeightUnit(value)) continue
    style.setProperty(property, pinViewportHeightUnits(value, viewportPx), style.getPropertyPriority(property))
  }
}

/**
 * Pin the document's viewport height units to `viewportPx`, and keep doing so
 * as stylesheets load and inline styles change. Returns a stop function.
 */
export function pinViewportHeight(doc: Document, viewportPx: number): () => void {
  const covered = new WeakMap<CSSStyleSheet, number>()
  const emitted = new Set<string>()

  const sweep = () => {
    for (const sheet of Array.from(doc.styleSheets)) {
      if ((sheet.ownerNode as Element | null)?.hasAttribute?.(STYLE_ATTRIBUTE)) continue
      let rules: CSSRuleList
      try {
        rules = sheet.cssRules
      } catch {
        continue // cross-origin: not ours to read
      }
      if (covered.get(sheet) === rules.length) continue
      covered.set(sheet, rules.length)
      const css = pinnedRulesFor(rules, viewportPx)
      if (!css || emitted.has(css)) continue
      emitted.add(css)
      const style = doc.createElement('style')
      style.setAttribute(STYLE_ATTRIBUTE, '')
      style.textContent = css
      doc.head.appendChild(style)
    }
    for (const element of Array.from(doc.querySelectorAll<HTMLElement>('[style*="vh"]'))) {
      rewriteInline(element.style, viewportPx)
    }
  }

  // Animation libraries write inline styles every frame; coalesce rather than
  // sweep on each mutation.
  let pending: ReturnType<typeof setTimeout> | null = null
  const schedule = () => {
    if (pending) return
    pending = setTimeout(() => {
      pending = null
      sweep()
    }, 50)
  }

  sweep()
  const observer = new MutationObserver(schedule)
  observer.observe(doc.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['style'],
  })
  const timer = setInterval(sweep, 1000)

  return () => {
    observer.disconnect()
    clearInterval(timer)
    if (pending) clearTimeout(pending)
    doc.querySelectorAll(`style[${STYLE_ATTRIBUTE}]`).forEach((element) => element.remove())
  }
}
