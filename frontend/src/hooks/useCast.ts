/**
 * useCast — Phase 4: Google Cast support
 *
 * Wraps the Cast Application Framework (CAF) sender SDK.
 * Only available in Chrome with the Cast extension installed.
 *
 * We use the Default Media Receiver app ID ('CC1AD845') so no custom
 * Cast receiver app needs to be deployed. This plays the stream URL
 * directly on the Chromecast device.
 *
 * Requirements:
 *  - HTTPS (Cast sender API refuses on plain HTTP)
 *  - Chrome browser with Cast extension
 *  - The Chromecast and the server must be able to reach each other
 *    (same LAN, or the stream URL must be publicly accessible)
 */

import { useState, useEffect, useRef, useCallback } from 'react'

// Default Media Receiver — no custom receiver needed
const CAST_APP_ID = 'CC1AD845'

type CastState = 'unavailable' | 'idle' | 'connecting' | 'casting'

interface UseCastOptions {
  /** Current stream URL (changes when track changes) */
  streamUrl: string | null
  /** Track title for Cast metadata */
  title?: string
  /** Artist name for Cast metadata */
  artist?: string
  /** Cover art URL for Cast metadata */
  coverUrl?: string
}

// Typed access to global Cast/Chrome APIs (declared in cast.d.ts)
const w = window as Window & {
  __onGCastApiAvailable?: (available: boolean) => void
  cast?: typeof cast
  chrome?: { cast: typeof chrome.cast }
}

export function useCast({ streamUrl, title, artist, coverUrl }: UseCastOptions) {
  const [castState, setCastState] = useState<CastState>('unavailable')
  const initializedRef = useRef(false)

  // Always-current ref for Cast options. The SESSION_STARTED event listener is
  // registered once (inside useEffect([], [])) and would otherwise capture the
  // initial values via closure — at that point streamUrl is typically null because
  // the track hasn't loaded yet. Using a ref breaks the stale-closure problem.
  const optsRef = useRef({ streamUrl, title, artist, coverUrl })
  optsRef.current = { streamUrl, title, artist, coverUrl }

  useEffect(() => {
    if (initializedRef.current) return

    const initializeCast = (available: boolean) => {
      if (!available || !w.cast || !w.chrome?.cast) return
      if (initializedRef.current) return
      initializedRef.current = true

      const castContext = w.cast.framework.CastContext.getInstance()
      castContext.setOptions({
        receiverApplicationId: CAST_APP_ID,
        autoJoinPolicy: w.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
      })

      castContext.addEventListener(
        w.cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
        (ev: cast.framework.SessionStateEventData) => {
          switch (ev.sessionState) {
            case w.cast!.framework.SessionState.SESSION_STARTED:
            case w.cast!.framework.SessionState.SESSION_RESUMED: {
              setCastState('casting')
              // Read from ref — not from closure — to always get the current track URL.
              const { streamUrl: url, title: t, artist: a, coverUrl: c } = optsRef.current
              if (url) _loadMedia(url, t, a, c)
              break
            }
            case w.cast!.framework.SessionState.SESSION_ENDED:
              setCastState('idle')
              break
          }
        },
      )

      setCastState('idle')
    }

    // The Cast SDK may have already loaded and fired __onGCastApiAvailable before
    // this React component mounted (async script race). Check if it's already ready.
    if (w.cast?.framework?.CastContext) {
      initializeCast(true)
      return
    }

    // SDK not yet loaded — set callback for when it fires.
    w.__onGCastApiAvailable = initializeCast
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // When stream URL changes while casting, reload the track on the receiver.
  useEffect(() => {
    if (castState !== 'casting') return
    const { streamUrl: url, title: t, artist: a, coverUrl: c } = optsRef.current
    if (!url) return
    _loadMedia(url, t, a, c)
  }, [streamUrl, castState]) // eslint-disable-line react-hooks/exhaustive-deps

  function _loadMedia(url: string, trackTitle?: string, trackArtist?: string, cover?: string) {
    const session = w.cast?.framework?.CastContext?.getInstance()?.getCurrentSession()
    if (!session || !w.chrome?.cast) return

    const mediaInfo = new w.chrome.cast.media.MediaInfo(url, 'audio/mp4')
    mediaInfo.metadata = new w.chrome.cast.media.MusicTrackMediaMetadata()
    mediaInfo.metadata.title = trackTitle ?? ''
    mediaInfo.metadata.artist = trackArtist ?? ''
    if (cover) {
      mediaInfo.metadata.images = [new w.chrome.cast.Image(cover)]
    }

    const request = new w.chrome.cast.media.LoadRequest(mediaInfo)
    session.loadMedia(request).catch(console.error)
  }

  const startCasting = useCallback(() => {
    if (castState === 'unavailable' || !w.cast) return
    setCastState('connecting')
    w.cast.framework.CastContext.getInstance()
      .requestSession()
      .catch(() => setCastState('idle'))
  }, [castState])

  const stopCasting = useCallback(() => {
    const session = w.cast?.framework?.CastContext?.getInstance()?.getCurrentSession()
    if (session) session.endSession(true)
    setCastState('idle')
  }, [])

  return {
    castState,
    isCastAvailable: castState !== 'unavailable',
    isCasting: castState === 'casting',
    startCasting,
    stopCasting,
  }
}
