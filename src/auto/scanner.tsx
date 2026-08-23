import { useEffect } from 'react'
import { useVeditContext, useVeditState } from '../core/context'
import type { VeditStore } from '../core/store'
import type { NodeKind, RegisteredNode } from '../core/types'
import { sanitizeHtml } from '../runtime/sanitize'
import { computeAutoId } from './ids'

const TEXT_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'li', 'label', 'blockquote', 'figcaption', 'td', 'th', 'strong', 'em', 'small',
])

const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'head', 'meta', 'link', 'title'])

function kindOf(element: HTMLElement): NodeKind {
  const tag = element.tagName.toLowerCase()
  if (tag === 'img' || tag === 'picture' || tag === 'svg') return 'image'
  if (tag === 'a') return 'link'
  if (tag === 'button') return 'button'
  if (TEXT_TAGS.has(tag)) return 'text'
  return 'box'
}

function directText(element: HTMLElement): string {
  let text = ''
  for (const child of element.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) text += child.textContent ?? ''
  }
  return text.trim()
}

/** Only nodes whose text is theirs alone can have their copy safely replaced. */
function isLeafText(element: HTMLElement): boolean {
  return element.children.length === 0 && (element.textContent ?? '').trim().length > 0
}

function labelFor(element: HTMLElement, kind: NodeKind): string {
  const tag = element.tagName.toLowerCase()
  if (kind === 'text' || kind === 'link' || kind === 'button') {
    const text = (element.textContent ?? '').trim().replace(/\s+/g, ' ')
    if (text) return text.length > 32 ? `${text.slice(0, 32)}…` : text
  }
  if (kind === 'image') {
    const alt = element.getAttribute('alt')
    if (alt) return alt
  }
  const className = typeof element.className === 'string' ? element.className.split(/\s+/)[0] : ''
  return className ? `${tag}.${className}` : tag
}

export interface ScanOptions {
  root: HTMLElement
  selector: string
  /** Skip containers smaller than this many pixels in either direction. */
  minBoxSize?: number
}

/** Walk the DOM and describe every element the editor could plausibly target. */
export function scanDom({ root, selector, minBoxSize = 8 }: ScanOptions): RegisteredNode[] {
  const found: RegisteredNode[] = []
  const elements = root.querySelectorAll<HTMLElement>(selector)

  for (const element of elements) {
    const tag = element.tagName.toLowerCase()
    if (SKIP_TAGS.has(tag)) continue
    if (element.closest('[data-vedit-ui]')) continue
    // Nodes wrapped in <Editable> register themselves with richer metadata.
    if (element.hasAttribute('data-vedit-id') && element.dataset.veditAuto !== 'true') continue

    const kind = kindOf(element)
    if (kind === 'text' && !isLeafText(element)) continue
    if (kind === 'box') {
      const rect = element.getBoundingClientRect()
      if (rect.width < minBoxSize || rect.height < minBoxSize) continue
    }

    const id = element.dataset.veditId && element.dataset.veditAuto === 'true'
      ? element.dataset.veditId
      : computeAutoId(element, root)

    element.dataset.veditId = id
    element.dataset.veditAuto = 'true'
    element.dataset.veditKind = kind

    const parent = element.parentElement?.closest<HTMLElement>('[data-vedit-id]') ?? null
    found.push({
      id,
      kind,
      label: labelFor(element, kind),
      element,
      parentId: parent?.getAttribute('data-vedit-id') ?? null,
      auto: true,
      container: kind === 'box',
      sourceText: kind === 'text' ? directText(element) : undefined,
    })
  }
  return found
}

/**
 * Scanner-found nodes are not rendered by React, so text and attribute overrides
 * have to be written straight onto the DOM — and rewritten whenever the host app
 * re-renders over them.
 */
export function applyAutoOverrides(store: VeditStore, root: HTMLElement): void {
  for (const [id, override] of Object.entries(store.getState().doc.nodes)) {
    if (!id.startsWith('auto:')) continue
    const element = root.querySelector<HTMLElement>(`[data-vedit-id="${cssEscape(id)}"]`)
    if (!element) continue
    if (store.getState().inlineEditing === id) continue
    if (override.html !== undefined) {
      const html = sanitizeHtml(override.html)
      if (element.innerHTML !== html) element.innerHTML = html
    } else if (override.text !== undefined) {
      if (element.textContent !== override.text) element.textContent = override.text
    }
    if (override.src !== undefined && element instanceof HTMLImageElement && element.src !== override.src) {
      element.src = override.src
    }
    if (override.alt !== undefined && element instanceof HTMLImageElement) element.alt = override.alt
    if (override.href !== undefined && element instanceof HTMLAnchorElement) element.href = override.href
    if (override.className) {
      for (const name of override.className.split(/\s+/).filter(Boolean)) element.classList.add(name)
    }
  }
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&')
}

/**
 * Keeps the registry and the DOM in sync with the document. Mounted by the
 * provider whenever `auto` is on — including in view mode, because visitors need
 * to see edited copy too.
 */
export function AutoScanner() {
  const { store, config } = useVeditContext()
  const editing = useVeditState((state) => state.editing)
  const doc = useVeditState((state) => state.doc)

  useEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.body
    let frame = 0
    let applying = false

    const run = () => {
      applying = true
      try {
        const nodes = scanDom({ root, selector: config.autoSelector })
        if (editing) store.syncAutoNodes(nodes)
        applyAutoOverrides(store, root)
      } finally {
        // Let our own mutations settle before listening again.
        requestAnimationFrame(() => {
          applying = false
        })
      }
    }

    const schedule = () => {
      if (applying || frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        run()
      })
    }

    run()
    const observer = new MutationObserver(schedule)
    observer.observe(root, { subtree: true, childList: true, characterData: true })
    window.addEventListener('resize', schedule)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', schedule)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [store, config.autoSelector, editing, doc])

  return null
}
