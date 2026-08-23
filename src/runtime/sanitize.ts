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
