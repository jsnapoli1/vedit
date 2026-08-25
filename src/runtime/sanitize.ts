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
