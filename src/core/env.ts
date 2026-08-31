/**
 * Whether this build looks like production. Node and most bundlers say so
 * through `NODE_ENV`; Workers and Deno simply don't, and an unknown environment
 * is treated as not-production — this only decides whether to warn.
 */
export function isProductionLike(): boolean {
  const runtime = globalThis as { process?: { env?: Record<string, string | undefined> } }
  return runtime.process?.env?.NODE_ENV === 'production'
}

const warned = new Set<string>()

/**
 * Say something once, in development, about a misconfiguration the library can
 * see but can't fix. Every one of these exists because the failure it describes
 * is otherwise silent: nothing renders, nothing throws, nothing reaches the
 * console, and the only way to find it is to read this library's source.
 *
 * Deduplicated by `key`, because these fire from render paths that re-run.
 */
export function warnOnce(key: string, message: string, detail?: unknown): void {
  if (isProductionLike() || warned.has(key)) return
  warned.add(key)
  if (detail === undefined) console.warn(`[vedit] ${message}`)
  else console.warn(`[vedit] ${message}`, detail)
}

/** Test seam: forget what has already been warned about. */
export function resetWarnings(): void {
  warned.clear()
}
