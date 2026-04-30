import { useRef, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { CoverArt } from '@/components/CoverArt'
import { adminApi, playbackApi } from '@/api/client'
import { PlaybackState } from '@/api/client'
import { Pause, Play, SkipForward } from 'lucide-react'
import { useSSE } from '@/hooks/useSSE'
import { useSession } from '@/hooks/useSession'
import { RetroDial, RetroPushButton } from '@/components/RetroDial'

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
  const { isAdmin } = useSession()
  const audioRef = useRef<HTMLAudioElement>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null)
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
  })

  const track = state?.current_track

  // Load settings from API — always needed for direct_stream_url.
  // Audio settings fall back to localStorage if present.
  useEffect(() => {
    adminApi.settings()
      .then((settings) => {
        const url = (settings.direct_stream_url ?? '').trim()
        directStreamUrlRef.current = url
        setDirectStreamUrl(url)

        // Audio settings: localStorage overrides API defaults
        try {
          const stored = localStorage.getItem('cj_audio_settings')
          if (stored) {
            const parsed = JSON.parse(stored)
            // Migrate balance from old -100..100 range to new -10..10
            if (typeof parsed.balance === 'number' && (parsed.balance > 10 || parsed.balance < -10)) {
              parsed.balance = Math.round(parsed.balance / 10)
            }
            setAudioSettings(prev => ({ ...prev, ...parsed }))
            return
          }
        } catch {}
        setAudioSettings({
          volume: Number(settings.audio_volume ?? settings.volume ?? '85'),
          bass: Number(settings.audio_bass ?? '0'),
          treble: Number(settings.audio_treble ?? '0'),
          balance: Number(settings.audio_balance ?? '0'),
          loudness: (settings.audio_loudness ?? '0') === '1',
        })
      })
      .catch(() => {})
  }, [])

  function updateAudioSetting<K extends keyof typeof audioSettings>(key: K, value: (typeof audioSettings)[K]) {
    setAudioSettings(prev => {
      const next = { ...prev, [key]: value }
      try { localStorage.setItem('cj_audio_settings', JSON.stringify(next)) } catch {}
      return next
    })
  }

  useSSE({
    settings_changed: (data) => {
      const next = data as Record<string, string>
      setAudioSettings((current) => ({
        volume: Number(next.audio_volume ?? next.volume ?? current.volume),
        bass: Number(next.audio_bass ?? current.bass),
        treble: Number(next.audio_treble ?? current.treble),
        balance: Number(next.audio_balance ?? current.balance),
        loudness: (next.audio_loudness ?? (current.loudness ? '1' : '0')) === '1',
      }))
      if ('direct_stream_url' in next) {
        const url = (next.direct_stream_url ?? '').trim()
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
  })

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    if (sourceNodeRef.current) return

    const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextCtor) return

    const context = new AudioContextCtor()
    const source = context.createMediaElementSource(audio)
    const bass = context.createBiquadFilter()
    bass.type = 'lowshelf'
    bass.frequency.value = 180

    const treble = context.createBiquadFilter()
    treble.type = 'highshelf'
    treble.frequency.value = 3200

    const gain = context.createGain()
    const panner = context.createStereoPanner()

    source.connect(bass)
    bass.connect(treble)
    treble.connect(gain)
    gain.connect(panner)
    panner.connect(context.destination)

    audioContextRef.current = context
    sourceNodeRef.current = source
    bassFilterRef.current = bass
    trebleFilterRef.current = treble
    gainNodeRef.current = gain
    pannerNodeRef.current = panner
  }, []) // Only create once, never recreate

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
  useEffect(() => {
    setNeedsInteraction(false)
    if (!track?.id) {
      setAudioSrc(null)
      return
    }
    const token = sessionStorage.getItem('cj_token') ?? ''
    const streamPath = `/api/playback/stream/${track.id}?token=${encodeURIComponent(token)}`
    const base = directStreamUrlRef.current.replace(/\/+$/, '')
    setAudioSrc(base ? `${base}${streamPath}` : streamPath)
  }, [track?.id, audioKey]) // eslint-disable-line react-hooks/exhaustive-deps

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
    }
  }, [state?.is_playing, audioSrc])

  // Report position to server every 5s
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const id = setInterval(() => {
      if (!audio.paused) {
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
      // Bump audioKey BEFORE the API call so that even if the backend selects
      // the same track ID again, the audioSrc useEffect re-runs and restarts audio.
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
    audio.addEventListener('canplay', onCanPlay)
    return () => {
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('canplay', onCanPlay)
    }
  }, [audioSrc, track?.id])

  const duration  = audioDuration > 0 ? audioDuration : (track?.duration_secs ?? 0)
  const position  = currentTime
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

      {/* Hidden audio element — ALWAYS at this tree position, never moved */}
      <audio ref={audioRef} src={audioSrc ?? undefined} preload="auto" style={{ display: 'none' }} />

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

          {/* Controls */}
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', justifyContent: 'center' }}>
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
          </div>

          {/* Audio Controls */}
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
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', justifyItems: 'center' }}>
              <RetroDial label="Volumen" value={audioSettings.volume}  min={0}   max={100} step={1} unit="%"   accent="purple" onChange={v => updateAudioSetting('volume', v)} />
              <RetroDial label="Bas"     value={audioSettings.bass}    min={-12} max={12}  step={1} unit=" dB" accent="green"  onChange={v => updateAudioSetting('bass', v)} />
              <RetroDial label="Diskant" value={audioSettings.treble}  min={-12} max={12}  step={1} unit=" dB" accent="orange" onChange={v => updateAudioSetting('treble', v)} />
              <RetroDial label="L  Balance  R" value={audioSettings.balance} min={-10} max={10} step={1} accent="purple" onChange={v => updateAudioSetting('balance', v)} formatValue={v => v === 0 ? '0' : v < 0 ? `L${Math.abs(v)}` : `R${v}`} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
