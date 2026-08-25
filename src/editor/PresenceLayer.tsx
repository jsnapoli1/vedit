import { useEffect, useState } from 'react'
import { useVeditSession, useVeditStore } from '../core/context'
import type { Peer } from '../core/realtime'
import { toScreen, useEditorTarget, type EditorTarget, type Rect } from './target'

/**
 * Everyone else, drawn over the page: their pointer where it is, and an outline
 * in their colour around whatever they have selected — so you can see someone
 * working on an element before you start changing it too.
 */
export function PresenceLayer() {
  const store = useVeditStore()
  const target = useEditorTarget()
  const { peers } = useVeditSession()
  const [, setTick] = useState(0)

  // The peers list changes rarely; their rects move with scroll, zoom and reflow.
  useEffect(() => {
    let frame = 0
    const loop = () => {
      setTick((value) => (value + 1) % 1_000_000)
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [])

  if (!peers.length) return null

  const path = pathOf(target)
  const viewport = target.getViewport()
  const here = peers.filter((peer) => !peer.path || !path || peer.path === path)

  return (
    <div className="vedit-presence">
      {here.map((peer) => (
        <PeerMarks key={peer.id} peer={peer} store={store} viewport={viewport} />
      ))}
    </div>
  )
}

function PeerMarks({
  peer,
  store,
  viewport,
}: {
  peer: Peer
  store: ReturnType<typeof useVeditStore>
  viewport: { originX: number; originY: number; zoom: number }
}) {
  const rects: Rect[] = []
  for (const id of peer.selection ?? []) {
    const element = store.getNode(id)?.element
    if (element?.isConnected) rects.push(toScreen(element.getBoundingClientRect(), viewport))
  }

  const cursor = peer.cursor
    ? toScreen({ top: peer.cursor.y, left: peer.cursor.x, width: 0, height: 0 }, viewport)
    : null

  return (
    <>
      {rects.map((rect, index) => (
        <div
          key={index}
          className="vedit-peer-rect"
          style={{ ...rect, outlineColor: peer.color, ['--peer' as string]: peer.color }}
        >
          <span className="vedit-peer-tag" style={{ background: peer.color }}>
            {peer.name}
          </span>
        </div>
      ))}
      {cursor ? (
        <div className="vedit-peer-cursor" style={{ top: cursor.top, left: cursor.left }}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill={peer.color}>
            <path d="M2 1l12 6.5-5.2 1.2L6.6 15z" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
          <span style={{ background: peer.color }}>{peer.name}</span>
        </div>
      ) : null}
    </>
  )
}

function pathOf(target: EditorTarget): string | null {
  try {
    return target.getDocument().location?.pathname ?? null
  } catch {
    return null
  }
}
