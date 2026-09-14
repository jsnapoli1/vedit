import type { CollectionSpec, VeditUser } from '../content/types'

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
  authorize(request: Request, ctx: AuthorizeContext): Promise<boolean>
  /** Answers the `/v1/auth/*` routes; `null` for anything else. */
  handle(request: Request): Promise<Response | null>
  createUser(user: NewUser): Promise<VeditUser>
  setPassword(id: string, password: string): Promise<void>
  /** The `_users` collection, for the host to merge into its own spec. */
  users: CollectionSpec
}
