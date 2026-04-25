import { useState, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { playbackApi, PlaybackState } from '@/api/client'
import { useSSE } from './useSSE'

/**
 * Manages playback state: fetches initial state, listens to SSE for updates,
 * and handles local position tick while playing.
 */
export function usePlayback() {
  const qc = useQueryClient()
  const [state, setState] = useState<PlaybackState | null>(null)
  const tickRef = useRef<ReturnType<typeof setInterval>>()

  // Initial fetch
  useEffect(() => {
    playbackApi.state().then(setState).catch(console.error)
  }, [])

  // Local position ticker
  useEffect(() => {
    clearInterval(tickRef.current)
    if (state?.is_playing) {
      tickRef.current = setInterval(() => {
        setState(s => s ? { ...s, position_secs: s.position_secs + 0.5 } : s)
      }, 500)
    }
    return () => clearInterval(tickRef.current)
  }, [state?.is_playing, state?.current_track?.id])

  useSSE({
    now_playing_changed: (data) => {
      setState(data as PlaybackState)
      qc.invalidateQueries({ queryKey: ['queue'] })
    },
    playback_state_changed: (data) => {
      setState(s => s ? { ...s, ...(data as Partial<PlaybackState>) } : (data as PlaybackState))
    },
    queue_changed: () => {
      qc.invalidateQueries({ queryKey: ['queue'] })
    },
  })

  return state
}
