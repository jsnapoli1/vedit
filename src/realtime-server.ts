import type { RealtimeMessage } from './core/realtime'
import { isProductionLike } from './core/env'

interface Subscriber {
  peerId: string
  send(payload: string): void
  close(): void
}

export interface RealtimeHandlerOptions {
  /**
   * Reject a connection or a message — the same place you'd check a session
   * cookie. Required: an open relay lets anyone who finds it read every edit in
   * progress and push messages the editors will act on. Where an open relay is
   * genuinely what you want, say so by name with
   * `createUnsafeLocalRealtimeHandler`.
   */
  authorize: (request: Request) => boolean | Promise<boolean>
  /** How often to send a keep-alive comment, in ms. Proxies tend to cut idle streams. */
  heartbeatMs?: number
}

/**
 * A relay for `sseRealtime`: `GET` opens a stream, `POST` publishes to everyone
 * else in the room. Rooms live in memory, so this is one process's worth of
 * collaboration — plenty for a team, and the point at which you'd swap the
 * fan-out for Redis, a Durable Object or your message bus of choice.
 */
export function createRealtimeHandler(options: RealtimeHandlerOptions) {
  // The types say this already, but a JavaScript caller never hears them, and an
  // open relay fails silently: it works perfectly, for everyone.
  if (typeof options?.authorize !== 'function') {
    throw new TypeError(
      'createRealtimeHandler needs an `authorize` callback: without one anyone can join a room and ' +
        'post to it. Use createUnsafeLocalRealtimeHandler() if an open relay is genuinely what you want.',
    )
  }
  return relay(options.authorize, options.heartbeatMs)
}

/**
 * `createRealtimeHandler` with the authorization opted out of — anyone may join
 * a room, read what is being edited in it, and post to it. For a laptop, a test,
 * or a relay nothing else can reach. The name is the point.
 */
export function createUnsafeLocalRealtimeHandler(options: { heartbeatMs?: number } = {}) {
  if (isProductionLike()) {
    console.warn(
      '[vedit] createUnsafeLocalRealtimeHandler is relaying edits for anyone in a production build. ' +
        'Use createRealtimeHandler({ authorize }) instead.',
    )
  }
  return relay(() => true, options.heartbeatMs)
}

function relay(
  authorize: (request: Request) => boolean | Promise<boolean>,
  heartbeatMsOption?: number,
) {
  const rooms = new Map<string, Set<Subscriber>>()
  const heartbeatMs = heartbeatMsOption ?? 25_000

  const publish = (room: string, message: string, exceptPeer?: string) => {
    for (const subscriber of rooms.get(room) ?? []) {
      if (subscriber.peerId === exceptPeer) continue
      subscriber.send(message)
    }
  }

  return async function handle(request: Request): Promise<Response> {
    if (!(await authorize(request))) {
      return new Response('Not allowed', { status: 403 })
    }

    const url = new URL(request.url)
    const room = url.searchParams.get('room') ?? 'vedit'
    const peerId = url.searchParams.get('peer') ?? 'anonymous'

    if (request.method === 'POST') {
      const body = (await request.text()).slice(0, 512_000)
      try {
        JSON.parse(body) as RealtimeMessage
      } catch {
        return new Response('Malformed message', { status: 400 })
      }
      publish(room, body, peerId)
      return new Response(null, { status: 204 })
    }

    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })

    const encoder = new TextEncoder()
    let heartbeat: ReturnType<typeof setInterval>

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const subscriber: Subscriber = {
          peerId,
          send(payload) {
            try {
              controller.enqueue(encoder.encode(`data: ${payload}\n\n`))
            } catch {
              // The client went away between the check and the write.
            }
          },
          close() {
            try {
              controller.close()
            } catch {
              // Already closed.
            }
          },
        }

        const members = rooms.get(room) ?? new Set<Subscriber>()
        members.add(subscriber)
        rooms.set(room, members)

        controller.enqueue(encoder.encode(': connected\n\n'))
        heartbeat = setInterval(() => subscriber.send('{"type":"ping"}'), heartbeatMs)
        // Never let a keep-alive hold a Node process open on its own.
        ;(heartbeat as unknown as { unref?: () => void }).unref?.()

        request.signal?.addEventListener('abort', () => {
          clearInterval(heartbeat)
          members.delete(subscriber)
          if (!members.size) rooms.delete(room)
          subscriber.close()
        })
      },
      cancel() {
        clearInterval(heartbeat)
        const members = rooms.get(room)
        for (const subscriber of members ?? []) {
          if (subscriber.peerId === peerId) members?.delete(subscriber)
        }
        if (members && !members.size) rooms.delete(room)
      },
    })

    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store, no-transform',
        connection: 'keep-alive',
        // Nginx buffers SSE into uselessness without this.
        'x-accel-buffering': 'no',
      },
    })
  }
}
