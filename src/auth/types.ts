import type { CollectionSpec, VeditUser } from '../content/types'
import type { VeditContentStore } from '../content-server/types'

export interface AuthOptions {
  /** Where the `_users` records live. Build it with `usersCollection` in its spec. */
  store: VeditContentStore
  /** Signs session tokens. At least 16 characters; keep it out of the repo. */
  secret: string
  /** How long a sign-in lasts. Default seven days. */
  sessionTtlMs?: number
  cookie?: {
    /** Default `'vedit_session'`. */
    name?: string
    /** `'auto'` (default) sets `Secure` when the request came over https. */
    secure?: boolean | 'auto'
    /** Default `'/'`. */
    path?: string
  }
  /** Created on the first request when the store has no users at all. */
  bootstrap?: {
    email: string
    password: string
    name?: string
    /** Default `'admin'`. */
    role?: VeditUser['role']
  }
  /**
   * Failed sign-ins allowed per address and email before a `429`. Default 10
   * in 15 minutes. Counted in memory, so per process — or per isolate on an
   * edge runtime, where it slows an attacker rather than stopping one.
   */
  loginLimit?: { attempts?: number; windowMs?: number }
}

/** What a request is trying to do, as `authorize` sees it. */
export type AuthAction = 'read' | 'write' | 'publish' | 'upload' | 'data:write' | 'data:delete'

export interface AuthorizeContext {
  action: AuthAction
  /** The content source involved, when there is one. */
  source?: string
}

export interface NewUser {
  email: string
  password: string
  name?: string
  role: VeditUser['role']
}

/**
 * Sessions and permissions over users kept in the content store. `authorize`
 * takes the same `(request, context)` shape the document and realtime handlers
 * accept, so one instance can guard all of them.
 */
export interface VeditAuth {
  session(request: Request): Promise<VeditUser | null>
  /** Without a context the question is "may this request write?", which is all the document and realtime handlers ask. */
  authorize(request: Request, ctx?: AuthorizeContext): Promise<boolean>
  /** Answers the `/v1/auth/*` routes; `null` for anything else. */
  handle(request: Request): Promise<Response | null>
  createUser(user: NewUser): Promise<VeditUser>
  setPassword(id: string, password: string): Promise<void>
  /** The `_users` collection, for the host to merge into its own spec. */
  users: CollectionSpec
}
