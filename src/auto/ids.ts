/**
 * Ids for elements the scanner finds. They have to survive a rebuild of the site,
 * so they describe *where* an element sits rather than what it contains: the
 * nearest stable anchor (an `Editable` ancestor or an element with an `id`)
 * followed by a tag/index path down to the element.
 */
export function computeAutoId(element: HTMLElement, root: HTMLElement): string {
  const parts: string[] = []
  let current: HTMLElement | null = element

  while (current && current !== root) {
    const anchor = current !== element ? current.getAttribute('data-vedit-id') : null
    if (anchor) {
      // The anchor may itself be a scanner id; keep exactly one `auto:` prefix.
      parts.unshift(anchor.replace(/^auto:/, ''))
      return `auto:${parts.join('>')}`
    }
    if (current.id) {
      parts.unshift(`#${current.id}`)
      return `auto:${parts.join('>')}`
    }
    parts.unshift(segment(current))
    current = current.parentElement
  }
  return `auto:${parts.join('>')}`
}

function segment(element: HTMLElement): string {
  const tag = element.tagName.toLowerCase()
  const parent = element.parentElement
  if (!parent) return tag
  let index = 0
  for (const sibling of parent.children) {
    if (sibling === element) break
    if (sibling.tagName === element.tagName) index += 1
  }
  return index ? `${tag}[${index}]` : tag
}
