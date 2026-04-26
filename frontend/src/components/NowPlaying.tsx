import { useRef, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { CoverArt } from '@/components/CoverArt'
import { playbackApi } from '@/api/client'
import { PlaybackState } from '@/api/client'
import { SkipForward, Pause, Play } from 'lucide-react'

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
  const [audioSrc, setAudioSrc] = useState<string | null>(null)
  const [needsInteraction, setNeedsInteraction] = useState(false)

  const track = state?.current_track

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
