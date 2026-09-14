import type { VeditUser } from '../content/types'
import { fromBase64Url, fromUtf8, timingSafeEqual, toBase64Url, utf8 } from './bytes'

/** What a session token says. `v` lets a later format refuse older tokens. */
export interface SessionPayload {
  /** The user's record id. */
  sub: string
  role: VeditUser['role']
  /** Expiry, in milliseconds since the epoch. */
  exp: number
  /** Issued at, likewise. */
  iat: number
  v: 1
}

const ROLES: ReadonlySet<string> = new Set(['admin', 'editor', 'author'])

/** `base64url(json).base64url(hmac-sha256)` — small, stateless, cookie-safe. */
export async function signToken(payload: SessionPayload, secret: string): Promise<string> {
  const body = toBase64Url(utf8(JSON.stringify(payload)))
  return `${body}.${toBase64Url(await hmac(body, secret))}`
}

/**
 * The payload of a token we signed and that has not run out, or `null`. The
 * signature is checked before the body is even parsed, so a forged token gets
 * nothing but a constant-time compare.
 */
export async function verifyToken(token: string, secret: string, now = Date.now()): Promise<SessionPayload | null> {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [body, signature] = parts
  const given = fromBase64Url(signature)
  if (!given || !timingSafeEqual(given, await hmac(body, secret))) return null

  const bytes = fromBase64Url(body)
  if (!bytes) return null
  let payload: unknown
  try {
    payload = JSON.parse(fromUtf8(bytes))
  } catch {
    // Signed by us, yet not JSON: can only be a bug or a different format,
    // and either way it is not a session.
    return null
  }
  if (!isPayload(payload) || payload.exp <= now) return null
  return payload
}

function isPayload(value: unknown): value is SessionPayload {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.sub === 'string' &&
    record.sub.length > 0 &&
    typeof record.role === 'string' &&
    ROLES.has(record.role) &&
    typeof record.exp === 'number' &&
    Number.isFinite(record.exp) &&
    typeof record.iat === 'number' &&
    Number.isFinite(record.iat) &&
    record.v === 1
  )
}

async function hmac(text: string, secret: string): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8(text)))
}
