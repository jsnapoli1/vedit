const ALLOWED_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'br', 'span', 'a', 'code', 'mark', 'sup', 'sub'])

/**
 * Rich text typed into the editor is stored as HTML. Editors are trusted, but a
 * compromised overrides store should not be able to run script on your site, so
 * strip everything outside a small formatting whitelist.
 */
export function sanitizeHtml(html: string): string {
  if (typeof document === 'undefined') {
    // Server side: fall back to a conservative regex pass.
    return html
      .replace(/<\s*(script|style|iframe|object|embed)[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/javascript:/gi, '')
  }
  const template = document.createElement('template')
  template.innerHTML = html
  const walk = (node: Element) => {
    for (const child of [...node.children]) {
      if (!ALLOWED_TAGS.has(child.tagName.toLowerCase())) {
        child.replaceWith(...child.childNodes)
        continue
      }
      for (const attribute of [...child.attributes]) {
        const name = attribute.name.toLowerCase()
        const isSafeHref = name === 'href' && !/^\s*javascript:/i.test(attribute.value)
        if (!isSafeHref) child.removeAttribute(attribute.name)
      }
      walk(child)
    }
  }
  walk(template.content as unknown as Element)
  return template.innerHTML
}

/**
 * Schemes that execute rather than navigate. A URL in an override comes from the
 * stored document, so it is only as trustworthy as whoever can write to it —
 * treat it like any other piece of user data reaching the page.
 */
const EXECUTABLE_SCHEME = /^[\u0000-\u0020]*(javascript|vbscript|data)[\u0000-\u0020]*:/i
const DATA_IMAGE = /^[\u0000-\u0020]*data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)[,;]/i

export interface SafeUrlOptions {
  /**
   * Allow inline image data. Safe for `src`, where an SVG's scripts never run;
   * never for `href`, where the browser would navigate to it as a document.
   */
  allowDataImage?: boolean
}

/** The URL if it is safe to put on the page, otherwise undefined. */
export function safeUrl(value: unknown, options: SafeUrlOptions = {}): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (!EXECUTABLE_SCHEME.test(trimmed)) return trimmed
  return options.allowDataImage && DATA_IMAGE.test(trimmed) ? trimmed : undefined
}

/* -------------------------------------------------------------------- SVG */

/**
 * The SVG elements an import may keep: structure, drawing, gradients, and the
 * filter primitives.
 *
 * An allow-list rather than a deny-list, because the interesting attacks are
 * always the element nobody thought of. Notably absent: `script`, `style`,
 * `foreignObject`, `image`, `a`, `animate*`, `set`, `iframe`. `<style>` is worth
 * naming — a `<style>` inside an inline SVG applies to the *whole page*, which
 * makes an import a CSS injection through the document.
 */
const SVG_TAGS = new Set([
  'g',
  'defs',
  'symbol',
  'use',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'title',
  'desc',
  'lineargradient',
  'radialgradient',
  'stop',
  'clippath',
  'mask',
  'pattern',
  'filter',
  'feblend',
  'fecolormatrix',
  'fecomponenttransfer',
  'fecomposite',
  'feconvolvematrix',
  'fediffuselighting',
  'fedisplacementmap',
  'fedistantlight',
  'fedropshadow',
  'feflood',
  'fefunca',
  'fefuncb',
  'fefuncg',
  'fefuncr',
  'fegaussianblur',
  'femerge',
  'femergenode',
  'femorphology',
  'feoffset',
  'fepointlight',
  'fespecularlighting',
  'fespotlight',
  'fetile',
  'feturbulence',
])

/** Tag names the server-side pass strips along with their subtree. */
const SVG_DANGEROUS = 'script|style|foreignObject|image|a|animate|animateMotion|animateTransform|set|iframe'

/** A `style` attribute that fetches, imports or executes rather than paints. */
const STYLE_REACHES_OUT = /url\(\s*['"]?(?!#)|expression\(|@import|javascript:/i

export interface SanitizedSvg {
  svg: string
  viewBox: string
}

export interface SanitizeSvgOptions {
  /** Prefix for every id and reference, so two imports on one page don't share a gradient. */
  scope?: string
  /**
   * The viewBox to report when the markup has no root `<svg>` to take one from.
   *
   * This is what re-sanitising a *stored* shape needs: what the document holds
   * is the inner markup, and the viewBox alongside it.
   */
  viewBox?: string
}

/**
 * How much markup a shape may carry. A document is saved on every edit and
 * diffed for collaborators, so a 2 MB illustration belongs in an image.
 */
export const SVG_LIMIT = 64 * 1024

/**
 * Clean an imported SVG down to markup that only draws.
 *
 * Returns the sanitised *inner* markup of the root `<svg>` and that root's
 * viewBox, or null when there is no usable `<svg>` or the result is over
 * `SVG_LIMIT`. Run at import *and* again at render: the document is data, and it
 * can arrive from a store, a script or an agent that never went through the
 * import path.
 */
export function sanitizeSvg(markup: string, options: SanitizeSvgOptions = {}): SanitizedSvg | null {
  if (typeof markup !== 'string' || !markup.trim()) return null
  if (markup.length > SVG_LIMIT * 4) return null
  // Ids are page-global in inline SVG and every Figma export calls its gradient
  // `paint0_linear`, so a scope is a prefix and not a hope. Reduced to characters
  // that are safe in an id and in a `url(#…)` first.
  const scope = options.scope ? options.scope.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') : ''
  // A stored shape holds the *inner* markup and its viewBox separately, so
  // re-sanitising one at render arrives here without a root. Wrapping is what
  // makes the import path and the render path the same function: the alternative
  // is a second, subtly different sanitiser, which is how one of them ends up
  // being the lenient one.
  const rooted = /<\s*svg[\s>]/i.test(markup)
    ? markup
    : `<svg viewBox="${viewBoxAttribute(options.viewBox)}">${markup}</svg>`
  const result = typeof DOMParser === 'undefined' ? sanitizeSvgText(rooted) : sanitizeSvgDom(rooted)
  if (!result) return null
  // Nothing drawable came out: a file that wasn't a drawing, or one that was
  // nothing *but* the parts that had to go. Either way there is no shape here,
  // and saying so is what lets the import show a notice instead of placing an
  // empty box.
  if (!/<[a-zA-Z]/.test(result.svg)) return null
  const svg = scope ? scopeIds(result.svg, scope) : result.svg
  if (svg.length > SVG_LIMIT) return null
  return { svg, viewBox: result.viewBox }
}

/** The real pass. Runs wherever there is a DOM, which is everywhere it matters. */
function sanitizeSvgDom(markup: string): SanitizedSvg | null {
  const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml')
  if (parsed.getElementsByTagName('parsererror').length) return null
  const root = parsed.documentElement
  if (!root || root.tagName.toLowerCase() !== 'svg') return null

  const walk = (node: Element) => {
    for (const child of [...node.children]) {
      if (!SVG_TAGS.has(child.tagName.toLowerCase())) {
        // Removed with its subtree, not unwrapped: the children of a
        // `<foreignObject>` are HTML, and nothing in them belongs on the page.
        child.remove()
        continue
      }
      for (const attribute of [...child.attributes]) {
        if (!keepSvgAttribute(attribute.name, attribute.value)) child.removeAttribute(attribute.name)
      }
      walk(child)
    }
  }
  walk(root)

  return {
    svg: root.innerHTML,
    viewBox: viewBoxOf(root.getAttribute('viewBox'), root.getAttribute('width'), root.getAttribute('height')),
  }
}

function keepSvgAttribute(name: string, value: string): boolean {
  const lower = name.toLowerCase()
  if (lower.startsWith('on')) return false
  // Only inside the document: an external reference is a fetch on every render,
  // and `xlink:href` to an SVG document is a script vector in older engines.
  if (lower === 'href' || lower === 'xlink:href') return value.trim().startsWith('#')
  if (lower === 'style') return !STYLE_REACHES_OUT.test(value)
  return true
}

/**
 * The server pass: no DOM, so a conservative regex, exactly as `sanitizeHtml`
 * does. It is deliberately blunt — the browser pass above is the authoritative
 * one and always runs before markup reaches a page.
 */
function sanitizeSvgText(markup: string): SanitizedSvg | null {
  const outer = /<svg\b([^>]*)>([\s\S]*)<\s*\/\s*svg\s*>/i.exec(markup)
  if (!outer) return null
  const attributes = outer[1]
  let inner = outer[2]

  const blocks = new RegExp(`<\\s*(${SVG_DANGEROUS})\\b[\\s\\S]*?<\\s*/\\s*\\1\\s*>`, 'gi')
  const empties = new RegExp(`<\\s*/?\\s*(${SVG_DANGEROUS})\\b[^>]*>`, 'gi')
  inner = inner
    .replace(blocks, '')
    .replace(empties, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // Only a same-document reference survives. The unquoted alternative has to
    // exclude a quote as well as a `#`, or it would swallow `"#a"` a character
    // at a time and take the reference with it.
    .replace(/\s(?:xlink:)?href\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*'|[^\s>"'#][^\s>]*)/gi, '')
    .replace(/\sstyle\s*=\s*("[^"]*"|'[^']*')/gi, (match, quoted: string) =>
      STYLE_REACHES_OUT.test(quoted) ? '' : match,
    )
    .replace(/javascript:/gi, '')
    // The same allow-list the browser pass uses, applied to the tags rather than
    // the tree: without a parser the subtree can't be taken with it, so the tag
    // is unwrapped and its text left behind. Blunt on purpose — this pass exists
    // so that markup stored by a server never *contains* the dangerous thing,
    // and the browser pass is what runs before anything reaches a page.
    .replace(/<\s*\/?\s*([a-zA-Z][\w:-]*)\b[^>]*>/g, (match, tag: string) =>
      SVG_TAGS.has(tag.toLowerCase()) ? match : '',
    )

  const viewBox = /\bviewBox\s*=\s*["']([^"']*)["']/i.exec(attributes)?.[1]
  const width = /\bwidth\s*=\s*["']([^"']*)["']/i.exec(attributes)?.[1]
  const height = /\bheight\s*=\s*["']([^"']*)["']/i.exec(attributes)?.[1]
  return { svg: inner.trim(), viewBox: viewBoxOf(viewBox ?? null, width ?? null, height ?? null) }
}

/**
 * A caller-supplied viewBox is document data like anything else, and it is about
 * to be interpolated into an attribute — so it is four numbers or it is the
 * default box, and never a string that could close the tag.
 */
function viewBoxAttribute(viewBox: string | undefined): string {
  return viewBoxOf(viewBox ?? null, null, null)
}

/**
 * The artwork's own coordinate system. Without one an import would be drawn at
 * whatever size the box happens to be, which for an icon means a corner of it.
 */
function viewBoxOf(viewBox: string | null, width: string | null, height: string | null): string {
  if (viewBox && /^\s*-?[\d.]+(\s+|\s*,\s*)-?[\d.]+(\s+|\s*,\s*)-?[\d.]+(\s+|\s*,\s*)-?[\d.]+\s*$/.test(viewBox)) {
    return viewBox.trim().split(/[\s,]+/).join(' ')
  }
  const w = Number.parseFloat(width ?? '')
  const h = Number.parseFloat(height ?? '')
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return `0 0 ${w} ${h}`
  return '0 0 100 100'
}

/** Prefix every id and rewrite every reference to it. */
function scopeIds(svg: string, scope: string): string {
  const ids = new Set<string>()
  for (const match of svg.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)) ids.add(match[1])
  if (!ids.size) return svg

  const scoped = (id: string) => `${scope}-${id}`
  let out = svg.replace(/\bid\s*=\s*["']([^"']+)["']/g, (match, id: string) =>
    ids.has(id) ? `id="${scoped(id)}"` : match,
  )
  out = out.replace(/\b((?:xlink:)?href)\s*=\s*["']#([^"']+)["']/g, (match, name: string, id: string) =>
    ids.has(id) ? `${name}="#${scoped(id)}"` : match,
  )
  out = out.replace(/url\(\s*['"]?#([^)'"]+)['"]?\s*\)/g, (match, id: string) =>
    ids.has(id) ? `url(#${scoped(id)})` : match,
  )
  return out
}
