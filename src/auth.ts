/**
 * `vedit/auth` — sign-in for the editor: password hashing, signed session
 * cookies and a role → permission map over users kept in the content store.
 * Deliberately without `'use client'`.
 */

export type { AuthAction, AuthorizeContext, NewUser, VeditAuth } from './auth/types'
export type { VeditUser } from './content/types'
