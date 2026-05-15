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
  /**
   * Compensation gain node inserted between the crossfade mixer and the EQ chain.
   * The fade loop sets this to 1/(gainA+gainB) so the summed signal never exceeds
   * the individual track level — eliminates the "double-loud" pumping effect.
   */
  crossfadeCompGainRef: React.RefObject<GainNode | null>
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
    crossfadeCompGainRef,
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
  // Timestamp of the most recent fade completion (performance.now()).
  // Shared between runFadeLoop and the checkTime RAF so the polling loop knows
  // to back off for a short window after a crossfade, preventing the stale
  // effect instance from re-triggering a fade against the just-started Song B.
  const fadeCompletedAtRef = useRef(0)

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
    if (crossfadeCompGainRef.current) crossfadeCompGainRef.current.gain.value = 1
    nextTrackIdRef.current = null
    setIsBpmMatchState(false)
  }, [playerBRef, crossfadeGainARef, crossfadeGainBRef, crossfadeCompGainRef])

  // The main RAF fade loop. Runs each animation frame until t >= 1.
  const runFadeLoop = useCallback(() => {
    const now = performance.now()
    const elapsed = now - fadeStartTimeRef.current
    const t = Math.min(elapsed / fadeDurationMsRef.current, 1)

    const { gainA, gainB } = equalPowerGain(t)
    if (crossfadeGainARef.current) crossfadeGainARef.current.gain.value = gainA
    if (crossfadeGainBRef.current) crossfadeGainBRef.current.gain.value = gainB
    // Loudness compensation: cos(θ)+sin(θ) peaks at √2 at the crossfade midpoint,
    // making the summed output ~3 dB louder. Dividing by the sum keeps the total
    // amplitude constant throughout the fade (equals 1 at t=0 and t=1).
    if (crossfadeCompGainRef.current) {
      crossfadeCompGainRef.current.gain.value = 1 / (gainA + gainB)
    }

    if (t < 1) {
      fadeRafRef.current = requestAnimationFrame(runFadeLoop)
    } else {
      // ── Deck swap ─────────────────────────────────────────────────────────────
      // Player B is already playing Song 2 continuously at gain 1. Instead of
      // copying audio into Player A (which triggers a browser media-reload),
      // we swap which element is the "active" deck:
      //
      //   • playerARef.current  ← old playerB (playing Song 2, gain currently 1)
      //   • playerBRef.current  ← old playerA (silence, becomes standby)
      //   • crossfadeGainARef   ← old cfGainB (routes the new primary)
      //   • crossfadeGainBRef   ← old cfGainA (routes the new standby, stays at 0)
      //
      // The Web Audio graph connections (MediaElementSourceNode → GainNode) are
      // PERMANENT and unchanged. Only the ref pointers are swapped so that all
      // downstream logic (onEnded, audioSrc effect, checkTime, startFade) follows
      // the correct element and gain node without any .src changes or reloads.
      const finished = finishedTrackIdRef.current
      const next     = nextTrackIdRef.current
      const nextSrc  = next ? buildStreamUrl(next, directStreamUrlRef) : ''

      // Gains are already at their post-fade values (gainA=0, gainB=1 from equal-power).
      // Reset comp gain — we're back to a single active source.
      if (crossfadeCompGainRef.current) crossfadeCompGainRef.current.gain.value = 1

      // Silence + clear the old primary (Song 1) — no longer needed.
      const oldPrimary = playerARef.current
      if (oldPrimary) {
        oldPrimary.pause()
        oldPrimary.src = ''
        oldPrimary.playbackRate = 1
      }
      // Song 2 (old Player B) keeps playing — do NOT touch it.
      if (playerBRef.current) playerBRef.current.playbackRate = 1

      // Swap player refs.
      ;(playerARef as React.MutableRefObject<HTMLAudioElement | null>).current = playerBRef.current
      ;(playerBRef as React.MutableRefObject<HTMLAudioElement | null>).current = oldPrimary

      // Swap gain node refs to maintain invariant: crossfadeGainARef routes playerARef.
      const tmpGain = crossfadeGainARef.current
      ;(crossfadeGainARef as React.MutableRefObject<GainNode | null>).current = crossfadeGainBRef.current
      ;(crossfadeGainBRef as React.MutableRefObject<GainNode | null>).current = tmpGain
      // After swap: gainA (new primary) = 1 ✓   gainB (new standby) = 0 ✓

      isFadingRef.current = false
      fadeLoadingRef.current = false
      fadeCompletedAtRef.current = performance.now() // cooldown for checkTime
      setIsFadingState(false)
      setIsBpmMatchState(false)
      fadeRafRef.current = undefined
      nextTrackIdRef.current = null
      finishedTrackIdRef.current = null

      if (finished && next) {
        onFadeComplete(finished, next, nextSrc)
      }
    }
  }, [playerARef, playerBRef, crossfadeGainARef, crossfadeGainBRef, crossfadeCompGainRef, directStreamUrlRef, onFadeComplete])

  // Start the crossfade toward the given next track.
  // Returns true if the fade was started, false if it was aborted (e.g. Player B 404).
  const startFade = useCallback(async (nextId: string, nextBpm: number = 0): Promise<boolean> => {
    if (isFadingRef.current || fadeLoadingRef.current) return false // Already fading or loading
    const playerB = playerBRef.current
    const audioCtx = audioContextRef.current
    if (!playerB || !audioCtx) return false

    fadeLoadingRef.current = true // Guard against concurrent calls during async preload

    // Defensive reset — playbackRate persists across src changes on the same element.
    playerB.playbackRate = 1

    // Pre-load Player B
    const url = buildStreamUrl(nextId, directStreamUrlRef)
    playerB.src = url
    playerB.volume = 1 // volume controlled by gain node, not element volume
    playerB.load()

    // Wait for enough data to start playing (or fail fast on error)
    let loadError = false
    await new Promise<void>((resolve) => {
      const onCanPlay = () => { resolve() }
      const onError   = () => { loadError = true; resolve() }
      playerB.addEventListener('canplay', onCanPlay, { once: true })
      playerB.addEventListener('error', onError, { once: true })
      // Fallback: start anyway after 3s if canplay never fires
      setTimeout(resolve, 3000)
    })

    if (!isFadingRef.current) {
      // If Player B failed to load (404 etc.), abort the fade gracefully so the
      // normal track-ended path handles queue advancement instead of fading to silence.
      if (loadError) {
        fadeLoadingRef.current = false
        playerB.pause()
        playerB.src = ''
        return false
      }

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
      return true
    } else {
      fadeLoadingRef.current = false // Was cancelled while loading — release guard
      return false
    }
  }, [playerBRef, audioContextRef, crossfadeGainBRef, directStreamUrlRef, currentTrackId, crossfadeSeconds, runFadeLoop, tempoMatchEnabled, maxTempoAdjustPercent, currentTrackBpm])

  // Watch Player A's time and trigger the crossfade when close to end.
  useEffect(() => {
    if (!autoDjEnabled || !isActivePlayer || isCasting) return

    let cancelled = false
    let fetchedForTrackId: string | null = null
    let scheduledNextId: string | null = null
    let scheduledNextBpm: number = 0
    const FADE_COOLDOWN_MS = 3000

    const checkTime = async () => {
      const playerA = playerARef.current
      if (!playerA || cancelled) return
      if (isFadingRef.current) return // Already in a fade

      // Cooldown after a completed fade: the effect still runs with the OLD
      // currentTrackId for a few frames until React re-renders with the new track.
      // During this window Player A is playing Song B near its start (currentTime
      // ≈ crossfadeSeconds) so remaining is small and would trigger another fade.
      if (performance.now() - fadeCompletedAtRef.current < FADE_COOLDOWN_MS) return

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
          const ok = await startFade(scheduledNextId, scheduledNextBpm)
          // If the track failed to load (404 etc.) stop retrying it — normal
          // track-ended will advance the queue to a working track instead.
          if (!ok) scheduledNextId = null
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
          const ok = await startFade(scheduledNextId, scheduledNextBpm)
          if (!ok) scheduledNextId = null
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
