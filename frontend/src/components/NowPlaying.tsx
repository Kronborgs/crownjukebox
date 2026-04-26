import { useRef, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { CoverArt } from '@/components/CoverArt'
import { adminApi, playbackApi } from '@/api/client'
import { PlaybackState } from '@/api/client'
import { SkipForward, Pause, Play } from 'lucide-react'
import { useSSE } from '@/hooks/useSSE'

interface Props {
  state: PlaybackState | null
}

function formatTime(secs: number) {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function NowPlaying({ state }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null)
  const bassFilterRef = useRef<BiquadFilterNode | null>(null)
  const trebleFilterRef = useRef<BiquadFilterNode | null>(null)
  const gainNodeRef = useRef<GainNode | null>(null)
  const pannerNodeRef = useRef<StereoPannerNode | null>(null)
  const [audioSrc, setAudioSrc] = useState<string | null>(null)
  const [needsInteraction, setNeedsInteraction] = useState(false)
  const [audioSettings, setAudioSettings] = useState({
    volume: 85,
    bass: 0,
    treble: 0,
    balance: 0,
    loudness: false,
  })

  const track = state?.current_track

  useEffect(() => {
    adminApi.settings()
      .then((settings) => {
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

    return () => {
      source.disconnect()
      bass.disconnect()
      treble.disconnect()
      gain.disconnect()
      panner.disconnect()
      context.close().catch(() => {})
      audioContextRef.current = null
      sourceNodeRef.current = null
      bassFilterRef.current = null
      trebleFilterRef.current = null
      gainNodeRef.current = null
      pannerNodeRef.current = null
    }
  }, [audioSrc])

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
      pannerNodeRef.current.pan.value = Math.min(Math.max(audioSettings.balance / 100, -1), 1)
    }
  }, [audioSettings])

  // When track changes, load new audio
  useEffect(() => {
    if (!track?.id) {
      setAudioSrc(null)
      return
    }
    const token = sessionStorage.getItem('cj_token') ?? ''
    setAudioSrc(`/api/playback/stream/${track.id}?token=${encodeURIComponent(token)}`)
  }, [track?.id])

  // Sync play/pause from server state
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !audioSrc) return

    if (state?.is_playing) {
      audioContextRef.current?.resume().catch(() => {})
      audio.play().catch((err) => {
        if (err.name === 'NotAllowedError') {
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

  // Track ended → signal server
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onEnded = () => {
      if (track?.id) {
        playbackApi.trackEnded(track.id)
      }
    }
    audio.addEventListener('ended', onEnded)
    return () => audio.removeEventListener('ended', onEnded)
  }, [audioSrc])

  const duration  = track?.duration_secs ?? 0
  const position  = state?.position_secs ?? 0
  const progress  = duration > 0 ? Math.min((position / duration) * 100, 100) : 0

  const titleText  = track?.title   ?? 'Ingen sang afspilles'
  const artistText = track?.artist  ?? ''
  const albumText  = track?.album   ?? ''
  const coverArtId = track?.cover_art_id ?? ''

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
            position: 'absolute', inset: 0, zIndex: 100,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', borderRadius: 'var(--radius-md)',
            gap: '0.75rem',
          }}
        >
          <Play size={48} color="var(--neon-primary)" />
          <p style={{ color: 'var(--neon-primary)', fontSize: '1.1rem', fontWeight: 700 }}>
            Tryk for at starte afspilning
          </p>
        </div>
      )}

      {/* Hidden audio element */}
      {audioSrc && (
        <audio ref={audioRef} src={audioSrc} preload="auto" />
      )}

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
      <div style={{ width: '100%', textAlign: 'center' }}>
        <div className="marquee-wrap" style={{ marginBottom: '4px' }}>
          <div className="marquee-inner" style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            {titleText}&nbsp;&nbsp;&nbsp;{titleText}&nbsp;&nbsp;&nbsp;
          </div>
        </div>
        <p style={{ color: 'var(--neon-primary)', fontSize: '1rem', marginBottom: '2px' }}>{artistText}</p>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>{albumText}</p>
      </div>

      {/* Progress bar */}
      <div style={{ width: '100%' }}>
        <div className="progress-bar">
          <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', color: 'var(--text-dim)', fontSize: '0.8rem' }}>
          <span>{formatTime(position)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
        <button
          className="btn btn-ghost btn-icon"
          onClick={() => {
            if (state?.is_playing) {
              playbackApi.pause()
            } else {
              playbackApi.play(track?.id)
            }
          }}
          aria-label={state?.is_playing ? 'Pause' : 'Afspil'}
          title={state?.is_playing ? 'Pause' : 'Afspil'}
        >
          {state?.is_playing
            ? <Pause size={24} />
            : <Play size={24} />}
        </button>
        <button
          className="btn btn-ghost btn-icon"
          onClick={() => playbackApi.skip()}
          aria-label="Skip"
          title="Skip"
        >
          <SkipForward size={24} />
        </button>
      </div>
    </div>
  )
}
