import { useEffect, useRef, useCallback } from 'react'
import { getCurrentRoomId } from '@/api/client'

export type SSEEventType =
  | 'now_playing_changed'
  | 'queue_changed'
  | 'playback_state_changed'
  | 'party_started'
  | 'party_ended'
  | 'user_access_revoked'
  | 'user_access_expired'
  | 'settings_changed'
  | 'library_scan_progress'
  | 'artwork_scan_progress'
  | 'artwork_updated'
  | 'missing_artwork_found'

export type SSEHandler = (data: unknown) => void

interface SSEOptions {
  /** token for authentication via query param (EventSource can't set headers) */
  token?: string
  /** room_id to subscribe to (defaults to current room from sessionStorage) */
  roomId?: string
  onReconnect?: () => void
}

/**
 * Subscribe to Server-Sent Events from the CrownJukebox backend.
 * Automatically reconnects on disconnect.
 */
export function useSSE(
  handlers: Partial<Record<SSEEventType, SSEHandler>>,
  options: SSEOptions = {},
) {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>()
  const esRef = useRef<EventSource | null>(null)

  const connect = useCallback(() => {
    const token = options.token ?? sessionStorage.getItem('cj_token') ?? ''
    if (!token) return

    const roomId = options.roomId ?? getCurrentRoomId()
    const url = `/api/events?token=${encodeURIComponent(token)}&room_id=${encodeURIComponent(roomId)}`
    const es = new EventSource(url)
    esRef.current = es

    es.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data) as { type: SSEEventType; data: unknown }
        const handler = handlersRef.current[parsed.type]
        handler?.(parsed.data)
      } catch {}
    }

    es.onerror = () => {
      es.close()
      esRef.current = null
      // Exponential backoff capped at 10s
      reconnectTimeoutRef.current = setTimeout(() => {
        options.onReconnect?.()
        connect()
      }, 3000)
    }
  }, [options.token]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(reconnectTimeoutRef.current)
      esRef.current?.close()
    }
  }, [connect])
}
