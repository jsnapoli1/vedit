/**
 * `vedit/media` — files on the server: stores for memory, disk and R2, and the
 * Fetch handler that uploads, lists and serves them. Deliberately without
 * `'use client'`.
 */

export { DEFAULT_ACCEPT, assetKind, matchesAccept } from './media/kind'
export { isSafeId, newAssetId } from './media/ids'
export { memoryMediaStore } from './media/memory'
export { fsMediaStore } from './media/fs'
export { r2MediaStore } from './media/r2'
export { createMediaHandler } from './media/handler'

export type { MediaAsset, MediaListOptions, MediaMeta, VeditMediaStore } from './media/types'
export type { R2Like } from './media/r2'
export type { MediaAction, MediaHandlerOptions } from './media/handler'
export type { VeditAsset } from './core/types'
