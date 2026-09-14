/**
 * Byte helpers the hashing and token code share. Written against `btoa`,
 * `atob` and `TextEncoder` rather than `Buffer` so the same code runs on
 * Cloudflare Workers, Deno, Bun and Node.
 */

export function utf8(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text)
}

export function fromUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

/** Standard base64url: `-` and `_` for the two odd characters, no padding. */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  // A loop rather than `String.fromCharCode(...bytes)`: the spread form throws
  // on inputs beyond the argument limit, and a token is small only by convention.
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** The inverse of `toBase64Url`; `null` for anything that is not base64url. */
export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4)
  let binary: string
  try {
    binary = atob(padded)
  } catch {
    // A length that no byte sequence encodes to (`1 mod 4`) is the only way
    // past the character check, and it is still just "not base64url".
    return null
  }
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * Equal or not, in time that depends on the length and never on where the
 * first difference is — so a caller cannot creep up on a hash or a signature
 * one byte at a time. Lengths must match to begin with; the length of a hash
 * or a signature is public anyway.
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}
