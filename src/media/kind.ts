import type { MediaAsset } from './types'

/** Images get thumbnails, videos get a player, everything else is a download. */
export function assetKind(mime: string): MediaAsset['kind'] {
  const type = mime.toLowerCase()
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('video/')) return 'video'
  return 'file'
}

/**
 * What an upload may be unless the host says otherwise: the things a site
 * actually links to. Nothing executable, nothing a browser would run as HTML.
 */
export const DEFAULT_ACCEPT: string[] = [
  'image/*',
  'video/mp4',
  'video/webm',
  'application/pdf',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
]

/** `accept` entries are exact mimes or `type/*` wildcards, like an `<input accept>`. */
export function matchesAccept(mime: string, accept: string[]): boolean {
  // Parameters (`; charset=utf-8`) never decide whether a type is allowed.
  const type = mime.split(';')[0].trim().toLowerCase()
  return accept.some((entry) => {
    const pattern = entry.trim().toLowerCase()
    if (pattern === '*/*') return true
    if (pattern.endsWith('/*')) return type.startsWith(pattern.slice(0, -1))
    return type === pattern
  })
}
