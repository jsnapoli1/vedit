import type { SVGProps } from 'react'

const base = (props: SVGProps<SVGSVGElement>) => ({
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...props,
})

export const IconCursor = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M5 3l6.5 17 2.3-7 7-2.3z" /></svg>
)
export const IconType = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 6V4h16v2M12 4v16M9 20h6" /></svg>
)
export const IconImage = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.5" /><path d="M21 16l-5-5-6 6-3-3-4 4" /></svg>
)
export const IconSquare = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="4" y="4" width="16" height="16" rx="2" /></svg>
)
export const IconUndo = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M9 14L4 9l5-5" /><path d="M4 9h9a7 7 0 010 14h-3" /></svg>
)
export const IconRedo = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M15 14l5-5-5-5" /><path d="M20 9h-9a7 7 0 000 14h3" /></svg>
)
export const IconEye = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>
)
export const IconEyeOff = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M3 3l18 18" /><path d="M10.6 5.2A9.9 9.9 0 0112 5c6.4 0 10 7 10 7a17.6 17.6 0 01-3.5 4.3M6.3 6.7A17.4 17.4 0 002 12s3.6 7 10 7a9.7 9.7 0 004.2-.9" /></svg>
)
export const IconClose = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M6 6l12 12M18 6L6 18" /></svg>
)
export const IconTrash = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" /></svg>
)
export const IconReset = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 12, height: 12, ...p })}><path d="M3 12a9 9 0 109-9 9 9 0 00-6.4 2.7L3 8" /><path d="M3 3v5h5" /></svg>
)
export const IconDesktop = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="2" y="4" width="20" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
)
export const IconTablet = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="5" y="2" width="14" height="20" rx="2" /><path d="M11 18h2" /></svg>
)
export const IconPhone = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></svg>
)
export const IconPanel = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></svg>
)
export const IconChevron = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 12, height: 12, ...p })}><path d="M6 9l6 6 6-6" /></svg>
)

export const IconAlignLeft = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 6h16M4 10h10M4 14h16M4 18h10" /></svg>
)
export const IconAlignCenter = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 6h16M7 10h10M4 14h16M7 18h10" /></svg>
)
export const IconAlignRight = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 6h16M10 10h10M4 14h16M10 18h10" /></svg>
)
export const IconAlignJustify = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
)

export const IconHand = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M8 12V5.5a1.5 1.5 0 013 0V11m0-.5V4.5a1.5 1.5 0 013 0V11m0-.5v-2a1.5 1.5 0 013 0V15a6 6 0 01-6 6h-1a6 6 0 01-6-6v-3a1.5 1.5 0 013 0" /></svg>
)
export const IconMinus = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M5 12h14" /></svg>
)
export const IconPlus = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>
)
export const IconFit = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
)

export const IconComment = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M21 12a8 8 0 01-8 8H8l-5 3 1.4-4.2A8 8 0 1121 12z" /></svg>
)

/* Shapes. Drawn as outlines like everything else here, so a filled preset and an
   empty one look the same in the panel — the icon says which geometry, not what
   colour it will land with. */
export const IconCircle = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="8" /></svg>
)
export const IconLine = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 18L20 6" /></svg>
)
export const IconTriangle = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 4l8 15H4z" /></svg>
)
export const IconStar = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 3l2.7 5.9 6.3.7-4.7 4.3 1.3 6.1L12 17l-5.6 3 1.3-6.1L3 9.6l6.3-.7z" /></svg>
)
export const IconHexagon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z" /></svg>
)
/** The generic one: a custom import in the layer tree, and the Shapes heading. */
export const IconShape = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="8.5" cy="8.5" r="5.5" /><path d="M11 13h9v8h-9z" /></svg>
)
