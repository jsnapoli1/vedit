/**
 * `vedit/auth` — sign-in for the editor: password hashing, signed session
 * cookies and a role → permission map over users kept in the content store.
 * Deliberately without `'use client'`, and without any Node-only module:
 * everything goes through the global `crypto.subtle`, so it runs on Workers as it is.
 */

export { AuthError, cookieSessionAllowed, createAuth } from './auth/index'
export { hashPassword, verifyPassword } from './auth/password'
export { signToken, verifyToken } from './auth/token'
export { USERS_SOURCE, isUserRecord, publicUser, usersCollection } from './auth/users'
export type { SessionPayload } from './auth/token'
export type { UserRecord } from './auth/users'
export type { AuthAction, AuthOptions, AuthorizeContext, NewUser, VeditAuth } from './auth/types'
export type { VeditUser } from './content/types'
