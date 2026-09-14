import type { CollectionSpec, VeditRecord, VeditUser } from '../content/types'

/** The content source users live in. The underscore keeps it off a host's own names. */
export const USERS_SOURCE = '_users'

const ROLES: ReadonlyArray<VeditUser['role']> = ['admin', 'editor', 'author']

/**
 * The `_users` collection. The host merges this into its own spec (or the
 * content handler does it for them) so users get the same store, Data panel
 * and versions as everything else. `password` is write-only: the handler hashes
 * it into `passwordHash` and reads never return either.
 */
export const usersCollection: CollectionSpec = {
  label: 'Users',
  fields: {
    email: { type: 'text', required: true },
    name: 'text',
    role: { type: 'select', required: true, options: [...ROLES] },
    password: { type: 'password', help: 'Stored hashed. Leave blank to keep the current one.' },
  },
  titleField: 'email',
  // A user is either live or not; a "draft" account would be a way to sign in
  // that nobody had approved.
  drafts: false,
  versions: 5,
  access: { read: 'admin', create: 'admin', update: 'admin', delete: 'admin', publish: 'admin' },
}

/** A `_users` row as it sits in the store. */
export interface UserRecord extends VeditRecord {
  email: string
  name?: string
  role: VeditUser['role']
  passwordHash: string
}

export function isRole(value: unknown): value is VeditUser['role'] {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}

/** Whether a row has everything a sign-in needs. A malformed row is nobody. */
export function isUserRecord(record: VeditRecord | null | undefined): record is UserRecord {
  return (
    !!record &&
    typeof record.email === 'string' &&
    isRole(record.role) &&
    typeof record.passwordHash === 'string' &&
    (record.name === undefined || typeof record.name === 'string')
  )
}

/**
 * The user as the rest of the system may see it: id, email, name and role,
 * and nothing else — not the hash, not the store's own `_status` and
 * `_updatedAt`. Picks fields rather than deleting them so a new column added
 * later is not leaked by default.
 */
export function publicUser(record: VeditRecord): VeditUser {
  if (typeof record.email !== 'string' || !isRole(record.role)) {
    throw new TypeError(`Record ${record.id} in ${USERS_SOURCE} is not a user`)
  }
  const user: VeditUser = { id: record.id, email: record.email, role: record.role }
  if (typeof record.name === 'string') user.name = record.name
  return user
}

/** Lower-cased and trimmed, so `Ann@Example.com` and `ann@example.com` are one account. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}
