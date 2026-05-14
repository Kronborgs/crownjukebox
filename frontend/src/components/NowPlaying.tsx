import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { motion } from 'framer-motion'
import { CoverArt } from '@/components/CoverArt'
import { adminApi, playbackApi, AudioState } from '@/api/client'
import { PlaybackState } from '@/api/client'
import { Pause, Play, SkipForward, Radio, Cast } from 'lucide-react'
import { useSSE } from '@/hooks/useSSE'
import { useSession } from '@/hooks/useSession'
import { useCast } from '@/hooks/useCast'
import { RetroDial, RetroPushButton } from '@/components/RetroDial'
import { useAutoDJ } from '@/hooks/useAutoDJ'

interface Props {
  state: PlaybackState | null
  refreshState?: () => Promise<void>
}

function formatTime(secs: number) {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

interface LEDScrollingTextProps {
  text: string
  color: string
  size: string
}

function LEDScrollingText({ text, color, size }: LEDScrollingTextProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [shouldScroll, setShouldScroll] = useState(false)

  useEffect(() => {
    if (!containerRef.current || !textRef.current) return
    const containerWidth = containerRef.current.offsetWidth
    const textWidth = textRef.current.scrollWidth
    setShouldScroll(textWidth > containerWidth)
  }, [text])

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        overflow: 'hidden',
        background: 'rgba(0,0,0,0.4)',
        borderRadius: '4px',
        padding: '8px 12px',
        position: 'relative',
        boxShadow: `inset 0 2px 8px rgba(0,0,0,0.5), 0 0 6px ${color}22`,
      }}
    >
      <div
        ref={textRef}
        style={{
          display: 'inline-block',
          whiteSpace: 'nowrap',
          fontSize: size,
          fontWeight: 700,
          color: color,
          textShadow: `0 0 8px ${color}, 0 0 4px ${color}`,
          fontFamily: 'var(--font-display)',
          letterSpacing: '1px',
          animation: shouldScroll ? 'led-scroll 15s linear infinite' : 'none',
        }}
      >
        {text}
        {shouldScroll && (
          <>
            &nbsp;&nbsp;&nbsp;•••&nbsp;&nbsp;&nbsp;
            {text}
            &nbsp;&nbsp;&nbsp;•••&nbsp;&nbsp;&nbsp;
            {text}
          </>
        )}
      </div>
    </div>
  )
}

export function NowPlaying({ state, refreshState }: Props) {
  const { isAdmin, isGuest, sessionId } = useSession()
  const audioRef = useRef<HTMLAudioElement>(null)
  const playerBRef = useRef<HTMLAudioElement>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null)
  const sourceBNodeRef = useRef<MediaElementAudioSourceNode | null>(null)
  const crossfadeGainARef = useRef<GainNode | null>(null)
  const crossfadeGainBRef = useRef<GainNode | null>(null)
  const bassFilterRef = useRef<BiquadFilterNode | null>(null)
  const trebleFilterRef = useRef<BiquadFilterNode | null>(null)
  const gainNodeRef = useRef<GainNode | null>(null)
  const pannerNodeRef = useRef<StereoPannerNode | null>(null)
  const partyVolumeRef = useRef<number | null>(null)
  const resumePositionRef = useRef<number | null>(null)
  const [audioSrc, setAudioSrc] = useState<string | null>(null)
  const [audioKey, setAudioKey] = useState(0) // bumped on track-ended so same-track-ID still re-triggers audio
  const [directStreamUrl, setDirectStreamUrl] = useState<string>('')
  // Ref keeps the latest directStreamUrl without re-triggering the audioSrc effect on load
  const directStreamUrlRef = useRef<string>('')
  const [needsInteraction, setNeedsInteraction] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [audioDuration, setAudioDuration] = useState(0)
  const [audioSettings, setAudioSettings] = useState({
    volume: 85,
    bass: 0,
    treble: 0,
    balance: 0,
    loudness: false,
    // Auto DJ (migration 015)
    autoDjEnabled: false,
    crossfadeSeconds: 12,
    tempoMatchEnabled: false,
    maxTempoAdjustPercent: 6,
  })

  // Phase 2: active player session ID for this room
  const [activePlayerSessionId, setActivePlayerSessionId] = useState<string | null>(null)
  // Phase 3: whether we are syncing audio state to backend
  const audioSyncPendingRef = useRef(false)
  // Debounce timers for each audio setting — prevents a burst of PUT requests while dragging sliders.
  const audioSyncTimers = useRef<Partial<Record<string, ReturnType<typeof setTimeout>>>>({})

  // Ref that always holds the latest state prop — used inside callbacks/intervals
  // that would otherwise capture a stale closure.
  const stateRef = useRef(state)
  useEffect(() => { stateRef.current = state }, [state])

  // Ref that always holds the latest isActivePlayer value — used inside the
  // position-report interval to immediately stop reporting when another device claims.
  const isActivePlayerRef = useRef(false)

  const track = state?.current_track

  // Phase 2: can this session play audio? (owner and holds the player, or no one holds it yet)
  const isOwner = !isGuest
  const isActivePlayer = isOwner && (activePlayerSessionId === null || activePlayerSessionId === sessionId)
  // Keep the ref in sync with the derived value so intervals see current state
  isActivePlayerRef.current = isActivePlayer

  // Phase 4: Google Cast (desktop Chrome + Cast extension)
  // Cast stream URL is computed independently of audioSrc/isActivePlayer so that:
  //  (a) Cast works even if this device hasn't claimed the active-player role yet
  //  (b) No circular dependency between isCasting and audioSrc
  const castStreamUrl = useMemo(() => {
    if (!track?.id) return null
    const token = sessionStorage.getItem('cj_token') ?? ''
    const path = `/api/playback/stream/${track.id}?token=${encodeURIComponent(token)}`
    const rawBase = directStreamUrl.trim().replace(/\/+$/, '')
    if (rawBase) {
      try { return new URL(rawBase).origin + path } catch { /* ignore */ }
    }
    return path
  }, [track?.id, directStreamUrl])

  const { isCastAvailable, isCasting, startCasting, stopCasting } = useCast({
    streamUrl: castStreamUrl,
    title: track?.title,
    artist: track?.artist,
  })

  // Phase 4b: Remote Playback API — works in Chrome for Android (Chromecast, SHIELD, etc.)
  // This is the same API YouTube uses on mobile. Falls back silently on unsupported browsers.
  const [remoteAvailable, setRemoteAvailable] = useState(false)
  const [remoteConnected, setRemoteConnected] = useState(false)
  useEffect(() => {
    if (isGuest) return
    // Defer slightly so the <audio> element has time to mount
    const tid = setTimeout(() => {
      const audio = audioRef.current
      if (!audio) return
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const remote = (audio as any).remote as any
      if (!remote?.watchAvailability) return

      let watchId: number | undefined
      remote.watchAvailability((available: boolean) => {
        setRemoteAvailable(available)
      }).then((id: number) => { watchId = id }).catch(() => {})

      const onConnect    = () => setRemoteConnected(true)
      const onDisconnect = () => setRemoteConnected(false)
      remote.addEventListener('connect', onConnect)
      remote.addEventListener('disconnect', onDisconnect)

      return () => {
        remote.removeEventListener('connect', onConnect)
        remote.removeEventListener('disconnect', onDisconnect)
        if (watchId !== undefined) remote.cancelWatchAvailability(watchId).catch(() => {})
      }
    }, 500)
    return () => clearTimeout(tid)
  }, [isGuest]) // eslint-disable-line react-hooks/exhaustive-deps

  const isCastActive  = isCasting || remoteConnected
  const isCastEnabled = isCastAvailable || remoteAvailable

  function handleCastClick() {
    if (isCastAvailable) {
      // CAF SDK (desktop Chrome + Cast extension) — most reliable for Chromecast.
      // Prefer this over Remote Playback API: CAF handles Chromecast protocol correctly,
      // while Remote Playback API on desktop Chrome doesn't reliably reach Chromecasts.
      isCasting ? stopCasting() : startCasting()
    } else if (remoteAvailable) {
      // Remote Playback API — fallback for mobile Chrome (no CAF SDK there)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(audioRef.current as any)?.remote?.prompt?.().catch(() => {})
    }
  }

  // Load settings from API — only used for direct_stream_url.
  // Audio settings come exclusively from the backend (getAudioState) for Phase 3 sync.
  useEffect(() => {
    adminApi.settings()
      .then((settings) => {
        let url = (settings.direct_stream_url ?? '').trim()
        // Ensure URL is absolute — if no protocol, prepend https://
        if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
          url = 'https://' + url
        }
        directStreamUrlRef.current = url
        setDirectStreamUrl(url)
      })
      .catch(() => {})
  }, [])

  function updateAudioSetting<K extends keyof typeof audioSettings>(key: K, value: (typeof audioSettings)[K]) {
    setAudioSettings(prev => {
      const next = { ...prev, [key]: value }

      // Phase 3: sync to backend for owner sessions
      if (!isGuest) {
        // Map local setting names to backend AudioState field names
        const backendKey: Record<string, keyof AudioState | null> = {
          volume:                'volume',
          bass:                  'tone_bass',
          treble:                'tone_treble',
          balance:               'balance',
          loudness:              'loudness',
          autoDjEnabled:         'auto_dj_enabled',
          crossfadeSeconds:      'crossfade_seconds',
          tempoMatchEnabled:     'tempo_match_enabled',
          maxTempoAdjustPercent: 'max_tempo_adjust_percent',
        }
        const bk = backendKey[key as string]
        if (bk !== null && bk !== undefined) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let backendValue: any
          if (key === 'balance') {
            backendValue = (value as number) * 10
          } else {
            backendValue = value
          }
          audioSyncPendingRef.current = true
          // Debounce: cancel any pending flush for this key and wait 400ms
          // before sending to avoid flooding the server while dragging sliders.
          clearTimeout(audioSyncTimers.current[bk])
          audioSyncTimers.current[bk] = setTimeout(() => {
            playbackApi.updateAudioState({ [bk]: backendValue })
              .finally(() => { setTimeout(() => { audioSyncPendingRef.current = false }, 300) })
              .catch(() => {})
          }, 400)
        }
      }

      return next
    })
  }

  useSSE({
    settings_changed: (data) => {
      const next = data as Record<string, string>
      // Only react to direct_stream_url changes — audio settings are now
      // stored per-room in the DB and managed exclusively via getAudioState() / updateAudioState().
      if ('direct_stream_url' in next) {
        let url = (next.direct_stream_url ?? '').trim()
        if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
          url = 'https://' + url
        }
        directStreamUrlRef.current = url
        setDirectStreamUrl(url)
      }
    },
    party_started: (data) => {
      const d = data as { volume_boost?: number }
      if (d.volume_boost && d.volume_boost > 0) {
        partyVolumeRef.current = audioSettings.volume
        updateAudioSetting('volume', Math.min(100, audioSettings.volume + d.volume_boost))
      }
    },
    party_ended: (data) => {
      if (partyVolumeRef.current !== null) {
        updateAudioSetting('volume', partyVolumeRef.current)
        partyVolumeRef.current = null
      }
      const d = data as { resume_position_secs?: number }
      if (d.resume_position_secs && d.resume_position_secs > 0) {
        resumePositionRef.current = d.resume_position_secs
      }
    },
    // Phase 2: track who holds the active player role
    active_player_changed: (data) => {
      const d = data as { active_player_session_id: string | null }
      const newId = d.active_player_session_id ?? null
      // When WE just became the active player (another device triggered the SSE by releasing,
      // or the claim came from another tab), seek to the server-reported position so we
      // start in sync instead of from position 0.
      if (newId === sessionId && !isActivePlayerRef.current) {
        resumePositionRef.current = stateRef.current?.position_secs ?? 0
      }
      setActivePlayerSessionId(newId)
    },
    // Phase 3: sync audio state from another device
    audio_state_changed: (data) => {
      const d = data as AudioState
      if (audioSyncPendingRef.current) return // Ignore echo of our own update
      setAudioSettings(prev => ({
        ...prev,
        volume:                d.volume                     ?? prev.volume,
        bass:                  d.tone_bass                  ?? prev.bass,
        treble:                d.tone_treble                ?? prev.treble,
        balance:               d.balance != null ? Math.round(d.balance / 10) : prev.balance,
        loudness:              d.loudness                   ?? prev.loudness,
        autoDjEnabled:         d.auto_dj_enabled            ?? prev.autoDjEnabled,
        crossfadeSeconds:      d.crossfade_seconds          ?? prev.crossfadeSeconds,
        tempoMatchEnabled:     d.tempo_match_enabled        ?? prev.tempoMatchEnabled,
        maxTempoAdjustPercent: d.max_tempo_adjust_percent   ?? prev.maxTempoAdjustPercent,
      }))
    },
  })

  // Phase 2: Fetch initial active player session on mount
  useEffect(() => {
    if (isGuest) return
    playbackApi.getAudioState().then((s) => {
      setAudioSettings(prev => ({
        ...prev,
        volume:                s.volume,
        bass:                  s.tone_bass,
        treble:                s.tone_treble,
        balance:               Math.round(s.balance / 10),
        loudness:              s.loudness              ?? prev.loudness,
        autoDjEnabled:         s.auto_dj_enabled       ?? prev.autoDjEnabled,
        crossfadeSeconds:      s.crossfade_seconds     ?? prev.crossfadeSeconds,
        tempoMatchEnabled:     s.tempo_match_enabled   ?? prev.tempoMatchEnabled,
        maxTempoAdjustPercent: s.max_tempo_adjust_percent ?? prev.maxTempoAdjustPercent,
      }))
    }).catch(() => {})
  }, [isGuest]) // eslint-disable-line react-hooks/exhaustive-deps

  // Phase 2: Auto-claim the player role when an owner loads the jukebox —
  // BUT only if no other device is already playing. If someone else holds the
  // player, stay silent (display-only) and let the user decide what to do.
  //
  // We wait for `state` to arrive (it's null on first render while loading)
  // so we can inspect active_player_session_id before deciding.
  const claimAttemptedRef = useRef(false)
  useEffect(() => {
    if (isGuest) return
    if (state === null) return  // wait for state to load
    if (claimAttemptedRef.current) return
    claimAttemptedRef.current = true

    const currentHolder = state.active_player_session_id ?? null

    if (currentHolder === null) {
      // No one is playing — claim automatically.
      playbackApi.claimPlayer()
        .then(res => {
          resumePositionRef.current = stateRef.current?.position_secs ?? 0
          setActivePlayerSessionId(res.active_player_session_id)
        })
        .catch(() => {})
    } else if (currentHolder === sessionId) {
      // We already hold the player (e.g. page refresh) — just reflect that.
      setActivePlayerSessionId(currentHolder)
    } else {
      // Another device is active — stay silent. The UI will offer "Take over"
      // or "Play here too" options.
      setActivePlayerSessionId(currentHolder)
    }
  }, [isGuest, state]) // eslint-disable-line react-hooks/exhaustive-deps

  // Release player on unmount / page close
  useEffect(() => {
    if (isGuest) return
    const release = () => { playbackApi.releasePlayer().catch(() => {}) }
    window.addEventListener('beforeunload', release)
    return () => {
      window.removeEventListener('beforeunload', release)
      release()
    }
  }, [isGuest]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    if (sourceNodeRef.current) return

    const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextCtor) return

    const audioB = playerBRef.current
    if (!audioB) return

    const context = new AudioContextCtor()

    // Crossfade gain nodes: inserted between each source and the shared bass filter.
    // Player A starts at gain 1, Player B at gain 0.
    const cfGainA = context.createGain()
    const cfGainB = context.createGain()
    cfGainA.gain.value = 1
    cfGainB.gain.value = 0

    const source  = context.createMediaElementSource(audio)
    const sourceB = context.createMediaElementSource(audioB)

    const bass = context.createBiquadFilter()
    bass.type = 'lowshelf'
    bass.frequency.value = 180

    const treble = context.createBiquadFilter()
    treble.type = 'highshelf'
    treble.frequency.value = 3200

    const gain = context.createGain()
    const panner = context.createStereoPanner()

    // Graph: sourceA → cfGainA ─┬─▶ bass → treble → gain → panner → dest
    //        sourceB → cfGainB ─┘
    source.connect(cfGainA)
    sourceB.connect(cfGainB)
    cfGainA.connect(bass)
    cfGainB.connect(bass)
    bass.connect(treble)
    treble.connect(gain)
    gain.connect(panner)
    panner.connect(context.destination)

    audioContextRef.current   = context
    sourceNodeRef.current     = source
    sourceBNodeRef.current    = sourceB
    crossfadeGainARef.current = cfGainA
    crossfadeGainBRef.current = cfGainB
    bassFilterRef.current     = bass
    trebleFilterRef.current   = treble
    gainNodeRef.current       = gain
    pannerNodeRef.current     = panner
  }, []) // Only create once, never recreate

  // Auto DJ: stable ref so ended/error handlers can check isFading without stale closure.
  const autoDJRef = useRef<{ isFading: boolean } | null>(null)

  // Called by useAutoDJ when crossfade finishes.
  // We advance the queue as if the track ended normally.
  const onFadeComplete = useCallback((finishedTrackId: string, _nextTrackId: string) => {
    setAudioKey(k => k + 1) // Triggers audioSrc to reload for new track
    playbackApi.trackEnded(finishedTrackId)
      .catch(() => {})
      .finally(() => { refreshState?.().catch(() => {}) })
  }, [refreshState])

  const autoDJ = useAutoDJ({
    autoDjEnabled:         audioSettings.autoDjEnabled,
    crossfadeSeconds:      audioSettings.crossfadeSeconds,
    tempoMatchEnabled:     audioSettings.tempoMatchEnabled,
    maxTempoAdjustPercent: audioSettings.maxTempoAdjustPercent,
    currentTrackBpm:       track?.bpm ?? 0,
    isActivePlayer,
    isCasting:             isCastActive,
    playerARef:            audioRef,
    playerBRef,
    crossfadeGainARef,
    crossfadeGainBRef,
    audioContextRef,
    directStreamUrlRef,
    currentTrackId:        track?.id ?? null,
    onFadeComplete,
  })
  // Keep the ref in sync for the ended/error guards above
  autoDJRef.current = { isFading: autoDJ.isFading }

  useEffect(() => {
    const audio = audioRef.current
    if (audio) {
      audio.volume = Math.min(Math.max(audioSettings.volume / 100, 0), 1)
    }
    if (bassFilterRef.current) {
      bassFilterRef.current.gain.value = audioSettings.bass + (audioSettings.loudness ? 4 : 0)
    }
    if (trebleFilterRef.current) {
      trebleFilterRef.current.gain.value = audioSettings.treble + (audioSettings.loudness ? 3 : 0)
    }
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = audioSettings.loudness ? 1.12 : 1
    }
    if (pannerNodeRef.current) {
      pannerNodeRef.current.pan.value = Math.min(Math.max(audioSettings.balance / 10, -1), 1)
    }
  }, [audioSettings])

  // When track changes (or audioKey is bumped after track-ended), reload audio.
  // audioKey ensures this re-runs even when the same track ID is picked again.
  // directStreamUrl is included so audioSrc updates when settings load (async race fix).
  // Gates: only load audio when this device holds the active-player role AND is not
  // casting (Chromecast plays the stream directly — no local playback needed).
  useEffect(() => {
    setNeedsInteraction(false)
    if (!isActivePlayer || !track?.id || isCasting) {
      // Explicitly pause before clearing src so the position-update interval stops
      // immediately. Without this, the browser may buffer-play briefly and keep
      // reporting positions even after losing the active-player role.
      audioRef.current?.pause()
      setAudioSrc(null)
      return
    }
    const token = sessionStorage.getItem('cj_token') ?? ''
    const streamPath = `/api/playback/stream/${track.id}?token=${encodeURIComponent(token)}`
    const rawBase = directStreamUrlRef.current.trim().replace(/\/+$/, '')
    // Validate that rawBase is an absolute URL before using it
    let resolvedSrc = streamPath
    if (rawBase) {
      try {
        const base = new URL(rawBase)
        resolvedSrc = base.origin + streamPath
      } catch {
        // Not a valid URL — fall back to relative path (same origin)
      }
    }
    setAudioSrc(resolvedSrc)
  }, [track?.id, audioKey, directStreamUrl, isActivePlayer, isCasting]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync play/pause from server state
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !audioSrc) return

    if (state?.is_playing) {
      // Handle resume position for same-track case (party restore)
      if (resumePositionRef.current !== null && audio.readyState >= 2) {
        audio.currentTime = resumePositionRef.current
        resumePositionRef.current = null
      }
      audioContextRef.current?.resume().catch(() => {})
      audio.play().catch((err) => {
        if (err.name === 'NotAllowedError' || err.name === 'NotSupportedError') {
          setNeedsInteraction(true)
        }
      })
    } else {
      audio.pause()
      // Also pause Player B if Auto DJ is mid-fade when playback is paused
      playerBRef.current?.pause()
    }
  }, [state?.is_playing, audioSrc])

  // Report position to server every 5s — ONLY when this device is the active player.
  // Using isActivePlayerRef (not state) so the interval picks up role changes immediately
  // without waiting for the next 5-second tick to fire after a React re-render.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const id = setInterval(() => {
      if (!audio.paused && isActivePlayerRef.current) {
        playbackApi.updatePosition(audio.currentTime).catch(() => {})
      }
    }, 5000)
    return () => clearInterval(id)
  }, [audioSrc])

  // Track audio duration from the element itself (DB duration_secs is unreliable)
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    setAudioDuration(0)
    setCurrentTime(0)
    const onLoaded = () => {
      if (isFinite(audio.duration) && audio.duration > 0) {
        setAudioDuration(audio.duration)
      }
    }
    audio.addEventListener('loadedmetadata', onLoaded)
    if (audio.readyState >= 1 && isFinite(audio.duration) && audio.duration > 0) {
      setAudioDuration(audio.duration)
    }
    return () => audio.removeEventListener('loadedmetadata', onLoaded)
  }, [audioSrc])

  // Track currentTime for smooth progress bar updates
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    let rafId: number
    const updateTime = () => {
      setCurrentTime(audio.currentTime)
      rafId = requestAnimationFrame(updateTime)
    }
    rafId = requestAnimationFrame(updateTime)
    return () => cancelAnimationFrame(rafId)
  }, [audioSrc])

  // Track ended → signal server
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onEnded = () => {
      // Skip natural ended event when Auto DJ fade is in progress:
      // the fade already pauses Player A before it reaches the natural end,
      // so onFadeComplete is the single caller of trackEnded in that path.
      if (autoDJRef.current?.isFading) return
      setAudioKey(k => k + 1)
      if (track?.id) {
        playbackApi.trackEnded(track.id)
          .catch(() => {})
          .finally(() => { refreshState?.().catch(() => {}) })
      }
    }
    const onError = () => {
      // Audio failed to load (e.g. file missing on server — 404).
      // Treat it the same as track-ended so the queue advances automatically.
      if (autoDJRef.current?.isFading) return
      setAudioKey(k => k + 1)
      if (track?.id) {
        playbackApi.trackEnded(track.id)
          .catch(() => {})
          .finally(() => { refreshState?.().catch(() => {}) })
      }
    }
    const onCanPlay = () => {
      if (resumePositionRef.current !== null) {
        audio.currentTime = resumePositionRef.current
        resumePositionRef.current = null
      }
    }
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)
    audio.addEventListener('canplay', onCanPlay)
    return () => {
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
      audio.removeEventListener('canplay', onCanPlay)
    }
  }, [audioSrc, track?.id])

  const duration  = audioDuration > 0 ? audioDuration : (track?.duration_secs ?? 0)
  // Active player: use local audio time (smooth, frame-accurate).
  // Non-active player: fall back to server-reported position (updated every 5 s from active device).
  const position  = (isActivePlayer && currentTime > 0) ? currentTime : (state?.position_secs ?? 0)
  const progress  = duration > 0 ? Math.min((position / duration) * 100, 100) : 0

  const titleText  = track?.title   ?? 'Ingen sang afspilles'
  const artistText = track?.artist  ?? ''
  const albumText  = track?.album   ?? ''
  const coverArtId = track?.cover_art_id ?? ''

  const isParty = !!state?.is_party_mode

  // CRITICAL: <audio> must ALWAYS be at the same tree position.
  // Using an early-return with <audio> in a different JSX branch causes React to
  // unmount/remount the element, which destroys the AudioContext and stops playback.
  // Instead we keep ONE return and hide visual elements with {!isParty && ...}.
  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem', padding: '1.5rem' }}>
      {/* Autoplay-policy overlay — shown when browser blocks autoplay */}
      {needsInteraction && (
        <div
          onClick={() => {
            audioContextRef.current?.resume().catch(() => {})
            audioRef.current?.play().then(() => setNeedsInteraction(false)).catch(() => {})
          }}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.88)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
            gap: '1rem',
          }}
        >
          <Play size={64} color="var(--neon-primary)" />
          <p style={{ color: 'var(--neon-primary)', fontSize: '1.4rem', fontWeight: 700 }}>
            Tryk for at starte afspilning
          </p>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>
            Browseren kræver en handling for at starte lyd
          </p>
        </div>
      )}

      {/* Hidden audio element — only rendered for non-guest sessions (Fase 1) */}
      {!isGuest && (
        <>
          <audio ref={audioRef} src={audioSrc ?? undefined} preload="auto" crossOrigin="anonymous" style={{ display: 'none' }} />
          {/* Player B — used by Auto DJ crossfade; src managed entirely by useAutoDJ */}
          <audio ref={playerBRef} preload="auto" crossOrigin="anonymous" style={{ display: 'none' }} />
        </>
      )}

      {/* All visual UI is hidden during party mode — only audio keeps playing */}
      {!isParty && (
        <>
          {/* Cover art — large */}
          <motion.div
            key={track?.id}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4 }}
            style={{
              width: '100%',
              maxWidth: '320px',
              aspectRatio: '1',
              borderRadius: 'var(--radius-md)',
              overflow: 'hidden',
              boxShadow: '0 8px 40px rgba(0,0,0,0.6), 0 0 30px rgba(191,0,255,0.2)',
            }}
          >
            <CoverArt artId={coverArtId} size="large" alt={titleText} />
          </motion.div>

          {/* Track info */}
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <LEDScrollingText text={titleText} color="var(--neon-primary)" size="1.3rem" />
            <LEDScrollingText text={artistText} color="var(--neon-teal)" size="1rem" />
            <LEDScrollingText text={albumText} color="var(--text-dim)" size="0.85rem" />
          </div>

          {/* Progress bar — retro LED segments */}
          <div style={{ width: '100%' }}>
            {(() => {
              const SEGS = 30
              const filled = duration > 0 ? Math.round((progress / 100) * SEGS) : 0
              return (
                <>
                  <div style={{ display: 'flex', gap: '2px', height: '10px', background: 'rgba(0,0,0,0.5)', borderRadius: '4px', padding: '2px' }}>
                    {Array.from({ length: SEGS }).map((_, i) => {
                      const on = i < filled
                      const hot = i / SEGS > 0.85
                      return (
                        <div key={i} style={{
                          flex: 1, height: '100%', borderRadius: '1px',
                          background: on
                            ? hot ? 'linear-gradient(180deg,#ff9944,#cc3300)' : 'linear-gradient(180deg,#44ffcc,#00ccaa)'
                            : 'rgba(255,255,255,0.07)',
                          boxShadow: on ? `0 0 3px ${hot ? '#ff6600' : '#00ffcc'}` : 'none',
                        }} />
                      )
                    })}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', color: 'var(--text-dim)', fontSize: '0.8rem', fontVariantNumeric: 'tabular-nums' }}>
                    <span>{formatTime(position)}</span>
                    <span>{duration > 0 ? `-${formatTime(Math.max(0, Math.round(duration - position)))}` : '0:00'}</span>
                  </div>
                </>
              )
            })()}
          </div>

          {/* "Another device is playing" banner — shown when we are an owner but not the active player */}
          {isOwner && !isActivePlayer && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              background: 'rgba(0,255,204,0.08)',
              border: '1px solid rgba(0,255,204,0.25)',
              borderRadius: 'var(--radius-sm)',
              padding: '0.5rem 0.9rem',
              fontSize: '0.82rem',
              color: 'var(--text-dim)',
              width: '100%',
            }}>
              <Radio size={14} style={{ flexShrink: 0, color: 'var(--neon-teal)' }} />
              <span>En anden enhed afspiller lyden.&nbsp;
                <button
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--neon-teal)', textDecoration: 'underline', fontSize: 'inherit' }}
                  onClick={async () => {
                    resumePositionRef.current = stateRef.current?.position_secs ?? 0
                    const res = await playbackApi.claimPlayer()
                    setActivePlayerSessionId(res.active_player_session_id)
                  }}
                >Tag over
                </button>
                &nbsp;for at spille lyden her.
              </span>
            </div>
          )}

          {/* Controls — hidden for guests (Fase 1) */}
          {!isGuest && (
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', justifyContent: 'center' }}>
              {/* Phase 2: Another device holds the player — show two choices instead of auto-stealing */}
              {isOwner && !isActivePlayer && (
                <>
                  <button
                    className="btn btn-ghost btn-icon"
                    onClick={async () => {
                      // "Tag over" — steal the active player role and start playing here
                      resumePositionRef.current = stateRef.current?.position_secs ?? 0
                      const res = await playbackApi.claimPlayer()
                      setActivePlayerSessionId(res.active_player_session_id)
                    }}
                    aria-label="Tag over som afspiller"
                    title="Afspil lyden på denne enhed (stopper den anden)"
                    style={{ color: 'var(--neon-teal)' }}
                  >
                    <Radio size={24} />
                  </button>
                </>
              )}
              <button
                className="btn btn-ghost btn-icon"
                onClick={async () => {
                  if (state?.is_playing) {
                    await playbackApi.pause()
                  } else {
                    audioContextRef.current?.resume().catch(() => {})
                    if (audioRef.current && audioSrc) {
                      audioRef.current.play().catch((err) => {
                        if (err.name === 'NotAllowedError' || err.name === 'NotSupportedError') {
                          setNeedsInteraction(true)
                        }
                      })
                    }
                    await playbackApi.play()
                  }
                  refreshState?.().catch(console.error)
                }}
                aria-label={state?.is_playing ? 'Pause' : 'Afspil'}
                title={state?.is_playing ? 'Pause' : 'Afspil'}
              >
                {state?.is_playing
                  ? <Pause size={24} />
                  : <Play size={24} />}
              </button>
              {isAdmin && track && (
                <button
                  className="btn btn-ghost btn-icon"
                  onClick={async () => {
                    autoDJ.cancelFade() // Stop any in-progress crossfade
                    await playbackApi.skip()
                    refreshState?.().catch(console.error)
                  }}
                  aria-label="Spring over"
                  title="Spring over (kun admin)"
                  style={{ color: 'var(--neon-accent)' }}
                >
                  <SkipForward size={24} />
                </button>
              )}
              {/* Phase 4: Cast button — always visible for owners; enabled when Cast SDK or Remote Playback is detected */}
              {!isGuest && (
                <button
                  className="btn btn-ghost btn-icon"
                  onClick={isCastEnabled ? handleCastClick : undefined}
                  disabled={!isCastEnabled}
                  aria-label={isCastActive ? 'Stop casting' : 'Cast til enhed'}
                  title={
                    isCastEnabled
                      ? (isCastActive ? 'Stop casting' : 'Cast til Chromecast / SHIELD')
                      : 'Chromecast kræver Chrome-browser på samme netværk'
                  }
                  style={{
                    color: isCastActive ? 'var(--neon-primary)' : 'var(--text-dim)',
                    opacity: isCastEnabled ? 1 : 0.3,
                  }}
                >
                  <Cast size={24} />
                </button>
              )}
            </div>
          )}

          {/* Audio Controls — hidden for guests (Fase 1) */}
          {!isGuest && (
          <div style={{ width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <span style={{ color: 'var(--text-dim)', fontSize: '0.72rem', letterSpacing: '2px', textTransform: 'uppercase' }}>Lydkontrol</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                  title={directStreamUrl ? `Direkte stream: ${directStreamUrl}` : 'Stream via Cloudflare (ingen direkte URL konfigureret)'}
                  style={{
                    fontSize: '0.7rem', padding: '2px 8px', borderRadius: '999px', cursor: 'default',
                    background: directStreamUrl ? 'rgba(0,255,180,0.1)' : 'rgba(255,255,255,0.07)',
                    border: directStreamUrl ? '1px solid rgba(0,255,180,0.3)' : '1px solid rgba(255,255,255,0.1)',
                    color: directStreamUrl ? 'var(--neon-teal)' : 'var(--text-dim)',
                  }}
                >
                  {directStreamUrl ? '⚡ Direkte' : '☁ Cloudflare'}
                </span>
                <RetroPushButton
                  label="Loudness"
                  active={audioSettings.loudness}
                  onToggle={() => updateAudioSetting('loudness', !audioSettings.loudness)}
                />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', justifyItems: 'center' }}>
              <RetroDial label="Volumen" value={audioSettings.volume}  min={0}   max={100} step={1} unit="%"   accent="purple" onChange={v => updateAudioSetting('volume', v)} />
              <RetroDial label="Bas"     value={audioSettings.bass}    min={-12} max={12}  step={1} unit=" dB" accent="green"  onChange={v => updateAudioSetting('bass', v)} />
              <RetroDial label="Diskant" value={audioSettings.treble}  min={-12} max={12}  step={1} unit=" dB" accent="orange" onChange={v => updateAudioSetting('treble', v)} />
              <RetroDial label="L  Balance  R" value={audioSettings.balance} min={-10} max={10} step={1} accent="purple" onChange={v => updateAudioSetting('balance', v)} formatValue={v => v === 0 ? '0' : v < 0 ? `L${Math.abs(v)}` : `R${v}`} />
            </div>

            {/* Auto DJ — crossfade control */}
            <div style={{ marginTop: '18px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span style={{ color: 'var(--text-dim)', fontSize: '0.72rem', letterSpacing: '2px', textTransform: 'uppercase' }}>Auto DJ</span>
                <RetroPushButton
                  label="Auto DJ"
                  active={audioSettings.autoDjEnabled}
                  onToggle={() => updateAudioSetting('autoDjEnabled', !audioSettings.autoDjEnabled)}
                />
              </div>
              {audioSettings.autoDjEnabled && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>Crossfade:</span>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {[5, 8, 10, 12, 15, 20].map(s => (
                      <button
                        key={s}
                        onClick={() => updateAudioSetting('crossfadeSeconds', s)}
                        style={{
                          padding: '3px 10px',
                          fontSize: '0.8rem',
                          borderRadius: '999px',
                          border: audioSettings.crossfadeSeconds === s
                            ? '1px solid var(--neon-primary)'
                            : '1px solid rgba(255,255,255,0.15)',
                          background: audioSettings.crossfadeSeconds === s
                            ? 'rgba(191,0,255,0.18)'
                            : 'rgba(255,255,255,0.05)',
                          color: audioSettings.crossfadeSeconds === s
                            ? 'var(--neon-primary)'
                            : 'var(--text-dim)',
                          cursor: 'pointer',
                        }}
                      >
                        {s}s
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {audioSettings.autoDjEnabled && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
                  <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>BPM-match</span>
                  <RetroPushButton
                    label="BPM"
                    active={audioSettings.tempoMatchEnabled}
                    onToggle={() => updateAudioSetting('tempoMatchEnabled', !audioSettings.tempoMatchEnabled)}
                  />
                </div>
              )}
              {audioSettings.autoDjEnabled && audioSettings.tempoMatchEnabled && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px' }}>
                  <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>Max ±:</span>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {[4, 6, 8, 10].map(p => (
                      <button
                        key={p}
                        onClick={() => updateAudioSetting('maxTempoAdjustPercent', p)}
                        style={{
                          padding: '3px 10px',
                          fontSize: '0.8rem',
                          borderRadius: '999px',
                          border: audioSettings.maxTempoAdjustPercent === p
                            ? '1px solid var(--neon-teal)'
                            : '1px solid rgba(255,255,255,0.15)',
                          background: audioSettings.maxTempoAdjustPercent === p
                            ? 'rgba(0,255,200,0.12)'
                            : 'rgba(255,255,255,0.05)',
                          color: audioSettings.maxTempoAdjustPercent === p
                            ? 'var(--neon-teal)'
                            : 'var(--text-dim)',
                          cursor: 'pointer',
                        }}
                      >
                        {p}%
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {autoDJ.isFading && (
                <div style={{ marginTop: '8px', fontSize: '0.75rem', color: autoDJ.isBpmMatch ? 'var(--neon-teal)' : 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ animation: 'pulse 1s infinite' }}>◉</span>
                  {autoDJ.isBpmMatch ? 'BPM-match aktiv' : 'Crossfader aktiv…'}
                  {(track?.bpm ?? 0) > 0 && (
                    <span style={{ opacity: 0.6 }}>({track!.bpm} BPM)</span>
                  )}
                </div>
              )}
            </div>
          </div>
          )}
        </>
      )}
    </div>
  )
}
