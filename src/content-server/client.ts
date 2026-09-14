import type { AccessLevel, CollectionSpec, GlobalSpec, VeditContentClient, VeditUser } from '../content/types'
import { roleAtLeast, schemaFor } from '../content/schema'
import type { VeditContentStore } from './types'

export interface ContentClientFromStoreOptions {
  /**
   * Who is asking. Left out, the caller is the server itself and may do
   * anything; given as `null`, the caller is a visitor.
   */
  user?: VeditUser | null
  /** The sources to describe. Defaults to what the store was built for. */
  spec?: { collections: Record<string, CollectionSpec>; globals?: Record<string, GlobalSpec> }
}

/**
 * A `VeditContentClient` that talks to a store in the same process — what the
 * MCP server and a script use, and what `localContentClient` builds on. No
 * network, no login: the role is whatever the caller says it is.
 */
export function contentClientFromStore(
  store: VeditContentStore,
  { user, spec }: ContentClientFromStoreOptions = {},
): VeditContentClient {
  const role: AccessLevel = user === null ? 'public' : (user?.role ?? 'admin')
  const sources = spec ?? store.sources()

  return {
    async schema() {
      return schemaFor(sources.collections, sources.globals, role)
    },
    list: (source, query) => store.list(source, query, query?.stage),
    get: (source, id, opts) => store.get(source, id, opts?.stage),
    commit: (changes, opts) => store.commit(changes, opts),
    publish: (records) => store.publish(records),
    versions: (source, id) => store.versions(source, id),
    restoreVersion: (source, id, versionId) => store.restoreVersion(source, id, versionId),
    async capabilities() {
      return {
        user: user ?? null,
        login: false,
        can: {
          write: roleAtLeast(role, 'author'),
          publish: roleAtLeast(role, 'editor'),
          upload: roleAtLeast(role, 'author'),
          data: { write: roleAtLeast(role, 'author'), delete: roleAtLeast(role, 'editor') },
        },
      }
    },
  }
}
