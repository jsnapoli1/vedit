import type { RegisteredNode } from '../core/types'

export interface A11yIssue {
  /** The node the issue belongs to, so clicking it can select the element. */
  nodeId: string
  rule: string
  severity: 'error' | 'warning'
  message: string
  detail?: string
}

/* ------------------------------------------------------------------- colour */

export function parseColor(value: string): [number, number, number, number] | null {
  const match = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.%]+))?\s*\)/i.exec(value)
  if (!match) return null
  const alpha = match[4] === undefined ? 1 : match[4].endsWith('%') ? Number.parseFloat(match[4]) / 100 : Number(match[4])
  return [Number(match[1]), Number(match[2]), Number(match[3]), alpha]
}

function channel(value: number): number {
  const sRGB = value / 255
  return sRGB <= 0.03928 ? sRGB / 12.92 : ((sRGB + 0.055) / 1.055) ** 2.4
}

export function luminance([r, g, b]: [number, number, number, number]): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG 2.1 contrast ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(
  foreground: [number, number, number, number],
  background: [number, number, number, number],
): number {
  const a = luminance(foreground)
  const b = luminance(background)
  const [light, dark] = a > b ? [a, b] : [b, a]
  return (light + 0.05) / (dark + 0.05)
}

/** Composite a translucent colour over what is behind it. */
function flatten(
  color: [number, number, number, number],
  behind: [number, number, number, number],
): [number, number, number, number] {
  const alpha = color[3]
  if (alpha >= 1) return color
  return [
    color[0] * alpha + behind[0] * (1 - alpha),
    color[1] * alpha + behind[1] * (1 - alpha),
    color[2] * alpha + behind[2] * (1 - alpha),
    1,
  ]
}

/**
 * The colour actually behind an element: the nearest ancestor with an opaque
 * background, compositing any translucent layers in between. Returns null when a
 * background image makes the answer unknowable from styles alone.
 */
export function effectiveBackground(element: HTMLElement): [number, number, number, number] | null {
  const view = element.ownerDocument.defaultView
  if (!view) return null
  const layers: Array<[number, number, number, number]> = []
  let current: HTMLElement | null = element

  while (current) {
    const style = view.getComputedStyle(current)
    if (style.backgroundImage && style.backgroundImage !== 'none') return null
    const color = parseColor(style.backgroundColor)
    if (color && color[3] > 0) {
      layers.push(color)
      if (color[3] >= 1) break
    }
    current = current.parentElement
  }

  let result: [number, number, number, number] = [255, 255, 255, 1]
  for (const layer of layers.reverse()) result = flatten(layer, result)
  return result
}

/* ------------------------------------------------------------------ audit */

const VAGUE_LINKS = new Set(['click here', 'here', 'read more', 'more', 'link', 'learn more', 'this'])

function textOf(element: HTMLElement): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/** Large text passes at a lower ratio: 24px, or 18.66px when bold. */
function isLargeText(size: number, weight: number): boolean {
  return size >= 24 || (size >= 18.66 && weight >= 700)
}

/**
 * Checks the things an editor can actually cause: contrast you just changed, an
 * image you just swapped without alt text, a heading you re-styled into the wrong
 * level. Not a substitute for a full audit, but it catches the damage in the loop
 * where it was done.
 */
export function auditPage(nodes: RegisteredNode[]): A11yIssue[] {
  const issues: A11yIssue[] = []
  const live = nodes.filter((node) => node.element.isConnected)
  const view = live[0]?.element.ownerDocument.defaultView
  if (!view) return issues

  const isHidden = (element: HTMLElement) => {
    const style = view.getComputedStyle(element)
    return style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0
  }

  for (const node of live) {
    const element = node.element
    if (isHidden(element)) continue
    const tag = element.tagName.toLowerCase()
    const style = view.getComputedStyle(element)

    // Contrast, for elements whose own text is theirs alone.
    const ownText = [...element.childNodes].some(
      (child) => child.nodeType === 3 && (child.textContent ?? '').trim(),
    )
    if (ownText) {
      const foreground = parseColor(style.color)
      const background = effectiveBackground(element)
      if (foreground && background) {
        const ratio = contrastRatio(flatten(foreground, background), background)
        const size = Number.parseFloat(style.fontSize)
        const required = isLargeText(size, Number(style.fontWeight) || 400) ? 3 : 4.5
        if (ratio < required) {
          issues.push({
            nodeId: node.id,
            rule: 'contrast',
            severity: ratio < required - 1 ? 'error' : 'warning',
            message: `Contrast ${ratio.toFixed(2)}:1, needs ${required}:1`,
            detail: `${style.color} on ${rgbString(background)}`,
          })
        }
      }
      const size = Number.parseFloat(style.fontSize)
      if (size && size < 12) {
        issues.push({
          nodeId: node.id,
          rule: 'text-size',
          severity: 'warning',
          message: `Text is ${Math.round(size)}px`,
          detail: 'Below about 12px is hard to read for many people.',
        })
      }
    }

    if (tag === 'img' && element.getAttribute('alt') === null) {
      issues.push({
        nodeId: node.id,
        rule: 'alt-text',
        severity: 'error',
        message: 'Image has no alt text',
        detail: 'Describe it, or set an empty alt if it is decorative.',
      })
    }

    if ((tag === 'a' || tag === 'button') && !textOf(element) && !element.getAttribute('aria-label')) {
      issues.push({
        nodeId: node.id,
        rule: 'empty-control',
        severity: 'error',
        message: `Empty ${tag === 'a' ? 'link' : 'button'}`,
        detail: 'Screen readers will announce it with no name.',
      })
    }

    if (tag === 'a' && VAGUE_LINKS.has(textOf(element).toLowerCase())) {
      issues.push({
        nodeId: node.id,
        rule: 'link-text',
        severity: 'warning',
        message: `Link reads “${textOf(element)}”`,
        detail: 'Link text should make sense read on its own.',
      })
    }
  }

  issues.push(...headingIssues(live, isHidden))
  return issues
}

function headingIssues(nodes: RegisteredNode[], isHidden: (element: HTMLElement) => boolean): A11yIssue[] {
  const issues: A11yIssue[] = []
  const headings = nodes
    .filter((node) => /^h[1-6]$/.test(node.element.tagName.toLowerCase()) && !isHidden(node.element))
    .sort((a, b) =>
      a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    )

  if (!headings.length) return issues
  const level = (node: RegisteredNode) => Number(node.element.tagName[1])

  if (!headings.some((node) => level(node) === 1)) {
    issues.push({
      nodeId: headings[0].id,
      rule: 'heading-order',
      severity: 'warning',
      message: 'The page has no h1',
      detail: 'Every page wants one top-level heading.',
    })
  }

  headings.forEach((node, index) => {
    if (index === 0) return
    const previous = level(headings[index - 1])
    const current = level(node)
    if (current > previous + 1) {
      issues.push({
        nodeId: node.id,
        rule: 'heading-order',
        severity: 'warning',
        message: `Heading jumps from h${previous} to h${current}`,
        detail: 'Levels should step down one at a time.',
      })
    }
  })

  return issues
}

function rgbString([r, g, b]: [number, number, number, number]): string {
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`
}
