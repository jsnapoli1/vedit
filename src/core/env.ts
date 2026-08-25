/**
 * Whether this build looks like production. Node and most bundlers say so
 * through `NODE_ENV`; Workers and Deno simply don't, and an unknown environment
 * is treated as not-production — this only decides whether to warn.
 */
export function isProductionLike(): boolean {
  const runtime = globalThis as { process?: { env?: Record<string, string | undefined> } }
  return runtime.process?.env?.NODE_ENV === 'production'
}
