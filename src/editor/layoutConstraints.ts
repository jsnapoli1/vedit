/**
 * Why an edit to a box's size or place might not take, read off the live
 * element. The editor never hides a container that shapes the page; it says
 * what the container does and offers the one change that frees the box.
 */
export interface LayoutConstraint {
  kind: 'flex-child' | 'absolute' | 'capped' | 'fixed-height' | 'clipped-by'
  message: string
  /** The style to write to lift the constraint, when there is one. */
  fix?: { label: string; styles: Record<string, string> }
  /** For `clipped-by`: the ancestor doing the clipping. */
  by?: HTMLElement
}

const px = (value: string) => `${Math.round(parseFloat(value))}px`

export function layoutConstraints(element: HTMLElement): LayoutConstraint[] {
  const view = element.ownerDocument.defaultView
  if (!view) return []
  const style = view.getComputedStyle(element)
  const parent = element.parentElement
  const found: LayoutConstraint[] = []

  if (style.position === 'absolute' || style.position === 'fixed') {
    found.push({
      kind: 'absolute',
      message:
        style.position === 'fixed'
          ? 'Fixed to the screen: it floats over the page and never moves other content.'
          : 'Positioned absolutely: it floats over the page and does not push other content when it grows.',
      fix: { label: 'Place in flow', styles: { position: 'static' } },
    })
  }

  if (parent && style.position !== 'absolute' && style.position !== 'fixed') {
    const parentStyle = view.getComputedStyle(parent)
    const grows = parseFloat(style.flexGrow) > 0
    if (parentStyle.display.includes('flex') && grows) {
      const row = parentStyle.flexDirection.startsWith('column') ? 'column' : 'row'
      found.push({
        kind: 'flex-child',
        message: `Its ${row === 'row' ? 'width' : 'height'} is decided by the ${row} it sits in (flex-grow). A width or height set here pins it to that size.`,
        fix: { label: 'Pin size', styles: { flex: '0 0 auto' } },
      })
    }
  }

  const overflowing = element.scrollHeight > element.clientHeight + 2
  const clips = /hidden|clip/.test(style.overflowY)
  if (style.maxHeight !== 'none' && overflowing) {
    const inline = element.style.maxHeight !== ''
    found.push({
      kind: 'capped',
      message: `Height is capped at ${px(style.maxHeight)}${inline ? " by the page's own inline style (usually an animation)" : " by the site's styling"}; content past it is cut off.`,
      // Only an important declaration beats an inline style, so the unpin is one.
      fix: { label: 'Unpin height', styles: { maxHeight: 'none !important' } },
    })
  } else if (clips && overflowing && style.height !== 'auto') {
    found.push({
      kind: 'fixed-height',
      message: `Height is fixed at ${px(style.height)} and the content inside is taller; the rest is cut off.`,
      fix: { label: 'Grow with content', styles: { height: 'auto !important', minHeight: px(style.height) } },
    })
  }

  const rect = element.getBoundingClientRect()
  for (let node = parent; node && node !== element.ownerDocument.body; node = node.parentElement) {
    const nodeStyle = view.getComputedStyle(node)
    if (!/hidden|clip/.test(nodeStyle.overflowX + nodeStyle.overflowY)) continue
    const box = node.getBoundingClientRect()
    const over = Math.max(rect.bottom - box.bottom, box.top - rect.top, rect.right - box.right, box.left - rect.left)
    if (over > 2) {
      found.push({ kind: 'clipped-by', message: `Cut off by a box above it (${Math.round(over)}px hidden).`, by: node })
    }
    break
  }

  return found
}
