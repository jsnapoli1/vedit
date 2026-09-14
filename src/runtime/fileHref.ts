/**
 * Extensions that make an `<a>` a download rather than a page: documents,
 * archives, media and installers. Matched on the path only — a query string
 * or a cache-buster after it does not change what the link hands over.
 */
const FILE_EXTENSION = /\.(pdf|zip|docx?|xlsx?|pptx?|csv|txt|mp4|webm|mov|dmg|exe|tar|gz|7z)(\?.*)?$/i

/** True when an anchor's href points at a file the visitor would download. */
export function isFileHref(href: unknown): boolean {
  return typeof href === 'string' && FILE_EXTENSION.test(href.trim())
}
