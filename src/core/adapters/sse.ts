import type { RealtimeMessage, VeditRealtime } from '../realtime'

export interface SseRealtimeOptions {
  /** Endpoint served by `createRealtimeHandler` — or anything speaking the same protocol. */
  endpoint: string
  /** Extra headers for the outgoing POSTs. `EventSource` cannot carry them, so put auth in the URL or a cookie. */
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>)
  fetch?: typeof fetch
}

/**
 * Server-sent events downstream, `POST` upstream. No WebSocket server needed, so
 * it runs anywhere the Fetch API does — which is the same place your overrides
 * endpoint already runs.
 */
export function sseRealtime(options: SseRealtimeOptions): VeditRealtime {
  const doFetch = options.fetch ?? globalThis.fetch

  return {
    connect(room, onMessage) {
      const peerId = `p-${Math.random().toString(36).slice(2, 10)}`
      const separator = options.endpoint.includes('?') ? '&' : '?'
      const stream =
        typeof EventSource === 'undefined'
          ? null
          : new EventSource(
              `${options.endpoint}${separator}room=${encodeURIComponent(room)}&peer=${peerId}`,
            )

      if (stream) {
        stream.onmessage = (event) => {
          try {
            onMessage(JSON.parse(event.data) as RealtimeMessage)
          } catch {
            // A malformed frame is not worth taking the editor down for.
          }
        }
      }

      let closed = false

      return {
        send(message) {
          if (closed) return
          void (async () => {
            const headers =
              typeof options.headers === 'function' ? await options.headers() : options.headers ?? {}
            await doFetch(
              `${options.endpoint}${separator}room=${encodeURIComponent(room)}&peer=${peerId}`,
              {
                method: 'POST',
                headers: { 'content-type': 'application/json', ...headers },
                body: JSON.stringify(message),
                keepalive: true,
              },
            ).catch(() => undefined)
          })()
        },
        close() {
          closed = true
          stream?.close()
        },
      }
    },
  }
}
