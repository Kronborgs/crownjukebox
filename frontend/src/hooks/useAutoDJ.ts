/**
 * useAutoDJ — crossfade engine for the CrownJukebox Auto DJ feature.
 *
 * Etape 1: pure audio crossfade.
 * Etape 2: BPM-aware tempo adjustment (playbackRate) layered on top.
 *
 * Design principles:
 * - All state is local to the hook instance → one per jukebox session, never global.
 * - Does NOT replace existing trackEnded/queue logic.
 *   When the fade completes, it calls `onFadeComplete(nextTrackId)` and
 *   NowPlaying.tsx calls the normal `trackEnded` + `refreshState`.
 * - If anything is not ready (Auto DJ off, no next track, player not active),
 *   the hook is a no-op and existing behaviour is unchanged.
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import { queueApi } from '@/api/client'

// Equal-power crossfade coefficients for time t ∈ [0,1].
// gainA fades out, gainB fades in. Equal power preserves perceived loudness.
function equalPowerGain(t: number): { gainA: number; gainB: number } {
  const angle = (t * Math.PI) / 2
  return {
    gainA: Math.cos(angle),
    gainB: Math.sin(angle),
  }
}

function buildStreamUrl(trackId: string, directStreamUrlRef: React.RefObject<string>): string {
  const token = sessionStorage.getItem('cj_token') ?? ''
  const path = `/api/playback/stream/${trackId}?token=${encodeURIComponent(token)}`
  const rawBase = (directStreamUrlRef.current ?? '').trim().replace(/\/+$/, '')
  if (rawBase) {
    try { return new URL(rawBase).origin + path } catch { /* ignore */ }
  }
  return path
}

export interface UseAutoDJOptions {
  /** Whether Auto DJ is currently enabled (from audioSettings) */
  autoDjEnabled: boolean
  /** Crossfade duration in seconds */
  crossfadeSeconds: number
  /** Whether this device holds the active player role */
  isActivePlayer: boolean
  /** Whether audio is casting to Chromecast (skip crossfade when casting) */
  isCasting: boolean

  // Audio refs from NowPlaying.tsx
  playerARef: React.RefObject<HTMLAudioElement | null>
  playerBRef: React.RefObject<HTMLAudioElement | null>
  crossfadeGainARef: React.RefObject<GainNode | null>
  crossfadeGainBRef: React.RefObject<GainNode | null>
  audioContextRef: React.RefObject<AudioContext | null>

  /** The stream URL base (for building Player B URL) */
  directStreamUrlRef: React.RefObject<string>

  /** Current track id being played by Player A */
  currentTrackId: string | null

  /** Called when fade is complete. NowPlaying should call trackEnded + refreshState. */
  onFadeComplete: (finishedTrackId: string, nextTrackId: string, nextSrc: string) => void

  /** Whether BPM-based tempo matching is enabled */
  tempoMatchEnabled: boolean
  /** Maximum tempo adjustment in percent (e.g. 8 means ±8%) */
  maxTempoAdjustPercent: number
  /** BPM of the currently playing track. 0 = unknown, disables BPM match. */
  currentTrackBpm: number
}

export interface UseAutoDJResult {
  /** True while a crossfade is in progress */
  isFading: boolean
  /** True while a BPM tempo-match playback rate adjustment is active */
  isBpmMatch: boolean
  /** The track id currently preloaded in Player B */
  nextTrackId: string | null
  /** Cancel an in-progress fade (e.g. on manual skip) */
  cancelFade: () => void
  /**
   * Returns true when Auto DJ is either actively fading OR in the async
   * pre-load phase (waiting for Player B canplay). Use this — not isFading —
   * to guard onEnded/onError handlers, because isFading (React state) lags
   * behind the synchronous fadeLoadingRef during the canplay wait window.
   */
  isBusy: () => boolean
}

export function useAutoDJ(options: UseAutoDJOptions): UseAutoDJResult {
  const {
    autoDjEnabled,
    crossfadeSeconds,
    isActivePlayer,
    isCasting,
    playerARef,
    playerBRef,
    crossfadeGainARef,
    crossfadeGainBRef,
    audioContextRef,
    directStreamUrlRef,
    currentTrackId,
    onFadeComplete,
    tempoMatchEnabled,
    maxTempoAdjustPercent,
    currentTrackBpm,
  } = options

  // Internal state kept in refs to avoid React re-render overhead in the RAF loop.
  const isFadingRef = useRef(false)
  const nextTrackIdRef = useRef<string | null>(null)
  const fadeRafRef = useRef<number | undefined>(undefined)
  const fadeStartTimeRef = useRef<number>(0)
  const fadeDurationMsRef = useRef<number>(0)
  const finishedTrackIdRef = useRef<string | null>(null)
  // startFade loading guard: prevents concurrent startFade calls during async preload.
  const fadeLoadingRef = useRef(false)

  // React state for UI re-renders (isFading + isBpmMatch indicators in NowPlaying)
  const [isFadingState, setIsFadingState] = useState(false)
  const [isBpmMatchState, setIsBpmMatchState] = useState(false)

  // Abort any running fade and reset both gain nodes.
  const cancelFade = useCallback(() => {
    if (fadeRafRef.current !== undefined) {
      cancelAnimationFrame(fadeRafRef.current)
      fadeRafRef.current = undefined
    }
    isFadingRef.current = false
    fadeLoadingRef.current = false
    setIsFadingState(false)

    // Stop Player B and reset gains
    const playerB = playerBRef.current
    if (playerB) {
      playerB.pause()
      playerB.src = ''
      playerB.playbackRate = 1
    }
    if (crossfadeGainARef.current) crossfadeGainARef.current.gain.value = 1
    if (crossfadeGainBRef.current) crossfadeGainBRef.current.gain.value = 0
    nextTrackIdRef.current = null
    setIsBpmMatchState(false)
  }, [playerBRef, crossfadeGainARef, crossfadeGainBRef])

  // The main RAF fade loop. Runs each animation frame until t >= 1.
  const runFadeLoop = useCallback(() => {
    const now = performance.now()
    const elapsed = now - fadeStartTimeRef.current
    const t = Math.min(elapsed / fadeDurationMsRef.current, 1)

    const { gainA, gainB } = equalPowerGain(t)
    if (crossfadeGainARef.current) crossfadeGainARef.current.gain.value = gainA
    if (crossfadeGainBRef.current) crossfadeGainBRef.current.gain.value = gainB

    if (t < 1) {
      fadeRafRef.current = requestAnimationFrame(runFadeLoop)
    } else {
      // Fade complete — transfer Player B's playback to Player A for seamless continuity.
      // Capturing B's state BEFORE modifying anything.
      const playerB = playerBRef.current
      const playerA = playerARef.current
      const nextSrc  = playerB?.src ?? ''
      const nextTime = playerB?.currentTime ?? 0

      if (playerA && nextSrc) {
        // Hand off: Player A takes over Player B's track at the same position.
        // Setting src while already-loaded causes a seek, not a full reload from 0.
        playerA.src = nextSrc
        playerA.currentTime = nextTime
        playerA.play().catch(() => {})
      } else if (playerA) {
        // No next-track source (shouldn't happen, but safe fallback).
        playerA.pause()
        playerA.src = ''
      }

      // Silence and clear Player B
      if (crossfadeGainARef.current) crossfadeGainARef.current.gain.value = 1
      if (crossfadeGainBRef.current) crossfadeGainBRef.current.gain.value = 0
      if (playerB) {
        playerB.pause()
        playerB.src = ''
        playerB.playbackRate = 1
      }
      if (playerA) playerA.playbackRate = 1

      const finished = finishedTrackIdRef.current
      const next = nextTrackIdRef.current

      isFadingRef.current = false
      fadeLoadingRef.current = false
      setIsFadingState(false)
      setIsBpmMatchState(false)
      fadeRafRef.current = undefined
      nextTrackIdRef.current = null
      finishedTrackIdRef.current = null

      if (finished && next) {
        onFadeComplete(finished, next, nextSrc)
      }
    }
  }, [playerARef, crossfadeGainARef, crossfadeGainBRef, onFadeComplete])

  // Start the crossfade toward the given next track.
  const startFade = useCallback(async (nextId: string, nextBpm: number = 0) => {
    if (isFadingRef.current || fadeLoadingRef.current) return // Already fading or loading
    const playerB = playerBRef.current
    const audioCtx = audioContextRef.current
    if (!playerB || !audioCtx) return

    fadeLoadingRef.current = true // Guard against concurrent calls during async preload

    // Defensive reset — playbackRate persists across src changes on the same element.
    playerB.playbackRate = 1

    // Pre-load Player B
    const url = buildStreamUrl(nextId, directStreamUrlRef)
    playerB.src = url
    playerB.volume = 1 // volume controlled by gain node, not element volume
    playerB.load()

    // Wait for enough data to start playing
    await new Promise<void>((resolve) => {
      const onCanPlay = () => { playerB.removeEventListener('canplay', onCanPlay); resolve() }
      const onError   = () => { playerB.removeEventListener('error', onCanPlay); resolve() }
      playerB.addEventListener('canplay', onCanPlay, { once: true })
      playerB.addEventListener('error', onError, { once: true })
      // Fallback: start anyway after 3s if canplay never fires
      setTimeout(resolve, 3000)
    })

    if (!isFadingRef.current) {
      // Only start if not cancelled in the meantime
      if (crossfadeGainBRef.current) crossfadeGainBRef.current.gain.value = 0
      audioCtx.resume().catch(() => {})
      playerB.currentTime = 0
      playerB.play().catch(() => {})

      // BPM tempo match: adjust playback rate so the next track aligns with the current BPM.
      let bpmMatch = false
      if (tempoMatchEnabled && currentTrackBpm > 0 && nextBpm > 0) {
        const ratio = nextBpm / currentTrackBpm
        const maxAdj = maxTempoAdjustPercent / 100
        if (Math.abs(ratio - 1) <= maxAdj) {
          playerB.playbackRate = ratio
          bpmMatch = true
        }
      }
      setIsBpmMatchState(bpmMatch)

      isFadingRef.current = true
      setIsFadingState(true)
      nextTrackIdRef.current = nextId
      finishedTrackIdRef.current = currentTrackId
      fadeStartTimeRef.current = performance.now()
      fadeDurationMsRef.current = crossfadeSeconds * 1000

      fadeRafRef.current = requestAnimationFrame(runFadeLoop)
    } else {
      fadeLoadingRef.current = false // Was cancelled while loading — release guard
    }
  }, [playerBRef, audioContextRef, crossfadeGainBRef, directStreamUrlRef, currentTrackId, crossfadeSeconds, runFadeLoop, tempoMatchEnabled, maxTempoAdjustPercent, currentTrackBpm])

  // Watch Player A's time and trigger the crossfade when close to end.
  useEffect(() => {
    if (!autoDjEnabled || !isActivePlayer || isCasting) return

    let cancelled = false
    let fetchedForTrackId: string | null = null
    let scheduledNextId: string | null = null
    let scheduledNextBpm: number = 0
    const checkTime = async () => {
      const playerA = playerARef.current
      if (!playerA || cancelled) return
      if (isFadingRef.current) return // Already in a fade

      const duration = playerA.duration
      const current  = playerA.currentTime
      if (!isFinite(duration) || duration <= 0) return

      const remaining = duration - current
      // Start fade when we are within crossfadeSeconds of the end.
      // Add a small buffer (0.5s) so we don't trigger right at the end.
      if (remaining > crossfadeSeconds + 0.5) return

      // Avoid fetching the queue on every frame — only once per track.
      if (fetchedForTrackId === currentTrackId) {
        // Already fetched; if we have a next track, start the fade.
        if (scheduledNextId && !isFadingRef.current) {
          await startFade(scheduledNextId, scheduledNextBpm)
        }
        return
      }

      fetchedForTrackId = currentTrackId

      try {
        const nextItem = await queueApi.nextTrack()
        if (cancelled) return
        if (!nextItem) return // Nothing to play next — normal track-ended will handle it

        scheduledNextId = nextItem.track_id
        scheduledNextBpm = nextItem.track_bpm ?? 0
        if (!isFadingRef.current) {
          await startFade(scheduledNextId, scheduledNextBpm)
        }
      } catch {
        // Network error — fall back to normal track-ended behaviour
      }
    }

    // Poll on RAF — same frequency as position tracking, no extra intervals.
    let rafId: number
    const tick = () => {
      checkTime()
      if (!cancelled) rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)

    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDjEnabled, isActivePlayer, isCasting, currentTrackId, crossfadeSeconds, startFade])

  // Cancel any in-progress fade when the current track changes (e.g. manual skip)
  // so we don't end up with two tracks playing.
  const prevTrackIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (prevTrackIdRef.current !== null && prevTrackIdRef.current !== currentTrackId) {
      if (isFadingRef.current) {
        cancelFade()
      }
    }
    prevTrackIdRef.current = currentTrackId
  }, [currentTrackId, cancelFade])

  // Cleanup on unmount
  useEffect(() => {
    return () => cancelFade()
  }, [cancelFade])

  return {
    isFading: isFadingState,
    isBpmMatch: isBpmMatchState,
    get nextTrackId() { return nextTrackIdRef.current },
    cancelFade,
    isBusy: () => isFadingRef.current || fadeLoadingRef.current,
  }
}
