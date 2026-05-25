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
  | 'bpm_scan_progress'
  | 'artwork_updated'
  | 'missing_artwork_found'
  | 'active_player_changed'
  | 'audio_state_changed'

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

  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const esRef = useRef<EventSource | null>(null)

  const connect = useCallback(() => {
    const token = options.token ?? sessionStorage.getItem('cj_token') ?? ''
    if (!token) return

    const roomId = options.roomId ?? getCurrentRoomId()
    const url = `/api/events?token=${encodeURIComponent(token)}&room_id=${encodeURIComponent(roomId)}`
    const es = new EventSource(url)
    esRef.current = es

    // The backend sends typed SSE events (event: TYPE\ndata: ...).
    // Named events are NOT delivered via onmessage — each type needs its own addEventListener.
    // Store named handler references so they can be explicitly removed on reconnect,
    // preventing accumulation of anonymous listeners across reconnection cycles.
    const knownTypes: SSEEventType[] = [
      'now_playing_changed', 'queue_changed', 'playback_state_changed',
      'party_started', 'party_ended', 'user_access_revoked', 'user_access_expired',
      'settings_changed', 'library_scan_progress', 'artwork_scan_progress',
      'bpm_scan_progress', 'artwork_updated', 'missing_artwork_found',
      'active_player_changed', 'audio_state_changed',
    ]
    const namedListeners: Partial<Record<SSEEventType, EventListener>> = {}
    for (const type of knownTypes) {
      const handler: EventListener = (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as unknown
          handlersRef.current[type]?.(data)
        } catch {}
      }
      namedListeners[type] = handler
      es.addEventListener(type, handler)
    }

    es.onerror = () => {
      // Remove all named listeners before closing so they can be GC'd.
      for (const type of knownTypes) {
        const handler = namedListeners[type]
        if (handler) es.removeEventListener(type, handler)
      }
      es.close()
      esRef.current = null
      // Reconnect after 3s
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
