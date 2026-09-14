import { fromBase64Url, timingSafeEqual, toBase64Url, utf8 } from './bytes'

const ALGORITHM = 'pbkdf2-sha256'
/**
 * The most Cloudflare Workers allow. Argon2 or a higher count would be
 * nicer, but this has to run wherever the content handler does, and PBKDF2
 * over WebCrypto is the one thing every runtime agrees on.
 */
const ITERATIONS = 100_000
const SALT_BYTES = 16
const KEY_BYTES = 32

/** `pbkdf2-sha256$<iterations>$<salt>$<hash>`, salt and hash in base64url. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const hash = await derive(password, salt, ITERATIONS)
  return [ALGORITHM, String(ITERATIONS), toBase64Url(salt), toBase64Url(hash)].join('$')
}

/**
 * Whether `password` is the one `stored` was made from. The iteration count
 * comes from the stored string, so raising `ITERATIONS` later keeps every
 * existing hash verifying. Anything that is not one of our hashes is simply
 * "no" — this never throws, because a caller compares against a dummy hash for
 * unknown users and the two paths must look the same from outside.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored)
  if (!parsed) return false
  const hash = await derive(password, parsed.salt, parsed.iterations)
  return timingSafeEqual(hash, parsed.hash)
}

function parseHash(stored: string): { iterations: number; salt: Uint8Array<ArrayBuffer>; hash: Uint8Array<ArrayBuffer> } | null {
  if (typeof stored !== 'string') return null
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== ALGORITHM) return null
  const iterations = Number(parts[1])
  // A count outside this range is not something we ever wrote; refusing it
  // also keeps a corrupted row from turning into a multi-minute derivation.
  if (!/^\d+$/.test(parts[1]) || !Number.isSafeInteger(iterations) || iterations < 1 || iterations > 10_000_000) return null
  const salt = fromBase64Url(parts[2])
  const hash = fromBase64Url(parts[3])
  if (!salt || !hash || salt.length === 0 || hash.length === 0) return null
  return { iterations, salt, hash }
}

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', utf8(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, KEY_BYTES * 8)
  return new Uint8Array(bits)
}
