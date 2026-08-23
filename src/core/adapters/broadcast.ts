import type { RealtimeConnection, RealtimeMessage, VeditRealtime } from '../realtime'

/**
 * Presence and comments between tabs and windows on one machine, with no backend
 * at all. Genuinely useful for trying collaboration out, and for a single person
 * working across two windows — but it never leaves the browser, so two people on
 * two computers need `sseRealtime` or a transport of your own.
 */
export function broadcastChannelRealtime(namespace = 'vedit'): VeditRealtime {
  return {
    connect(room, onMessage) {
      if (typeof BroadcastChannel === 'undefined') return NOOP
      const channel = new BroadcastChannel(`${namespace}:${room}`)
      channel.onmessage = (event: MessageEvent<RealtimeMessage>) => onMessage(event.data)
      return {
        send(message) {
          channel.postMessage(message)
        },
        close() {
          channel.close()
        },
      }
    },
  }
}

const NOOP: RealtimeConnection = { send() {}, close() {} }
