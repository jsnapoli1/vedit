import type { VeditAsset } from '../core/types'

/** True for the object shape an asset-typed field stores. */
export function isAsset(value: unknown): value is VeditAsset {
  return Boolean(value) && typeof value === 'object' && typeof (value as { url?: unknown }).url === 'string'
}

/**
 * The URL behind an asset-typed field. Fields written by the media handler hold
 * a `VeditAsset`; ones imported from somewhere older may hold a bare URL, and
 * both should render.
 */
export function assetUrl(value: unknown): string {
  if (typeof value === 'string') return value
  return isAsset(value) ? value.url : ''
}
