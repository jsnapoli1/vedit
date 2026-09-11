/**
 * The library's own workings, exported so tests, tooling and the occasional host
 * site can reach them.
 *
 * **These are not part of the supported API.** They can change shape in any
 * minor release; nothing here is covered by the promise the version number makes.
 * The main entry, `vedit`, is.
 */

export {
  readLayer,
  readStyles,
  readStyleValue,
  mergeStyles,
  replaceStyles,
  deleteStyles,
  pruneOverride,
} from './core/layers'
export { INSERTED_DEFAULTS, newInsertedId } from './core/operations'

export { RealtimeSession, diffDocuments } from './core/session'
export type { SessionSnapshot, DocumentPatch } from './core/session'
export { anonymousPeer, colorForPeer, initialsOf } from './core/realtime'

export { sanitizeHtml, safeUrl, sanitizeSvg, SVG_LIMIT } from './runtime/sanitize'
export type { SanitizedSvg, SanitizeSvgOptions } from './runtime/sanitize'
export { shapeElements } from './runtime/shape'
export type { ShapeElement } from './runtime/shape'
export { parseTransform, serializeTransform, withTransform } from './runtime/transform'
export type { TransformParts } from './runtime/transform'
export { parseGradient, serializeGradient, DEFAULT_GRADIENT } from './runtime/gradient'
export { itemId, parseItemId, itemKey, mergeOverrides, ITEM_SEPARATOR } from './runtime/repeat'
export type { Gradient, GradientStop } from './runtime/gradient'
export { parseFilter, serializeFilter, withFilter, FILTER_IDENTITY } from './runtime/filter'
export type { FilterParts } from './runtime/filter'
export {
  parseAnimation,
  serializeAnimation,
  animationName,
  keyframesFor,
  presetsIn,
  ANIMATION_PRESETS,
  REDUCED_MOTION_RULE,
} from './runtime/animation'
export type { AnimationParts, AnimationPreset } from './runtime/animation'

export { warnOnce, resetWarnings, isProductionLike } from './core/env'
export { scanDom } from './auto/scanner'
export { computeAutoId } from './auto/ids'
export { auditPage, contrastRatio, effectiveBackground, parseColor, luminance } from './editor/a11y'
export type { A11yIssue } from './editor/a11y'
