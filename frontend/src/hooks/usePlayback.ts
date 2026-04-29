import { useState, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { playbackApi, partyApi, PlaybackState } from '@/api/client'
import { useSSE } from './useSSE'

/**
 * Manages playback state: fetches initial state, listens to SSE for updates,
 * and handles local position tick while playing.
 */
export function usePlayback() {
  const qc = useQueryClient()
  const [state, setState] = useState<PlaybackState | null>(null)
  const tickRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  async function refreshState() {
    const next = await playbackApi.state()
    setState(next)
  }

  // Initial fetch — if party mode is stuck from a previous session (page reload / re-login),
  // end it automatically so the jukebox is usable. Audio doesn't survive page load anyway.
  // If nothing is playing, kick off autoplay immediately so the user doesn't have to press Play.
  useEffect(() => {
    playbackApi.state().then(async (next) => {
      if (next?.is_party_mode) {
        try { await partyApi.end() } catch {}
        const clean = await playbackApi.state()
        setState(clean)
      } else if (!next?.is_playing) {
        // Nothing playing on load — auto-start so the jukebox is ready immediately.
        try { await playbackApi.play() } catch {}
        const fresh = await playbackApi.state()
        setState(fresh)
      } else {
        setState(next)
      }
    }).catch(console.error)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
    now_playing_changed: () => {
      refreshState().catch(console.error)
      qc.invalidateQueries({ queryKey: ['queue'] })
    },
    playback_state_changed: () => {
      refreshState().catch(console.error)
    },
    party_started: () => {
      refreshState().catch(console.error)
    },
    party_ended: () => {
      refreshState().catch(console.error)
    },
    queue_changed: () => {
      qc.invalidateQueries({ queryKey: ['queue'] })
    },
  })

  return { state, refreshState }
}
