import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { libraryApi, Album, Track, queueApi } from '@/api/client'
import { CoverArt } from '@/components/CoverArt'
import { Plus, ChevronLeft, Clock } from 'lucide-react'

function formatTime(secs: number) {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function AlbumBrowser() {
  const qc = useQueryClient()
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null)
  const [addedTrackId, setAddedTrackId] = useState<string | null>(null)

  const { data: albums = [], isLoading } = useQuery({
    queryKey: ['albums'],
    queryFn: () => libraryApi.albums(),
    staleTime: 60_000,
  })

  const { data: tracks = [] } = useQuery({
    queryKey: ['album-tracks', selectedAlbum?.id],
    queryFn: () => libraryApi.albumTracks(selectedAlbum!.id),
    enabled: !!selectedAlbum,
  })

  async function addToQueue(track: Track) {
    await queueApi.add(track.id)
    setAddedTrackId(track.id)
    setTimeout(() => setAddedTrackId(null), 1200)
    qc.invalidateQueries({ queryKey: ['queue'] })
  }

  // ─── Track list view ──────────────────────────────────────
  if (selectedAlbum) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Album header */}
        <div style={{ display: 'flex', gap: '16px', padding: '16px', background: 'var(--bg-panel)', alignItems: 'center' }}>
          <button className="btn btn-ghost btn-icon" onClick={() => setSelectedAlbum(null)}>
            <ChevronLeft size={20} />
          </button>
          <div style={{ width: '72px', height: '72px', flexShrink: 0 }}>
            <CoverArt artId={selectedAlbum.cover_art_id} size="small" />
          </div>
          <div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>{selectedAlbum.title}</h2>
            <p style={{ color: 'var(--neon-primary)', fontSize: '0.9rem' }}>{selectedAlbum.artist_name}</p>
            {selectedAlbum.year && (
              <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>{selectedAlbum.year}</p>
            )}
          </div>
        </div>

        {/* Track list */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          <AnimatePresence>
            {(tracks as Track[]).map((track, i) => (
              <motion.div
                key={track.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px 16px',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  cursor: 'pointer',
                }}
                whileHover={{ backgroundColor: 'rgba(191,0,255,0.06)' }}
              >
                <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem', width: '24px', textAlign: 'right', flexShrink: 0 }}>
                  {track.track_number || i + 1}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 600, fontSize: '0.95rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {track.title}
                  </p>
                  {track.artist !== selectedAlbum.artist_name && (
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{track.artist}</p>
                  )}
                </div>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-dim)', fontSize: '0.8rem', flexShrink: 0 }}>
                  <Clock size={12} />
                  {formatTime(track.duration_secs)}
                </span>
                <motion.button
                  className="btn btn-primary btn-icon"
                  style={{ padding: '6px', flexShrink: 0 }}
                  onClick={() => addToQueue(track)}
                  aria-label="Tilføj til kø"
                  animate={addedTrackId === track.id ? { scale: [1, 1.3, 1] } : {}}
                >
                  <Plus size={16} />
                </motion.button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    )
  }

  // ─── Album grid view ──────────────────────────────────────
  return (
    <div style={{ overflowY: 'auto', flex: 1, padding: '12px' }}>
      {isLoading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px' }}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ aspectRatio: '1', borderRadius: 'var(--radius-md)' }} />
          ))}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px' }}>
          <AnimatePresence>
            {(albums as Album[]).map((album, i) => (
              <motion.div
                key={album.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: Math.min(i * 0.02, 0.4) }}
                whileHover={{ scale: 1.04, zIndex: 1 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => setSelectedAlbum(album)}
                style={{ cursor: 'pointer' }}
              >
                <div style={{
                  borderRadius: 'var(--radius-md)',
                  overflow: 'hidden',
                  aspectRatio: '1',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                }}>
                  <CoverArt artId={album.cover_art_id} size="medium" alt={album.title} />
                </div>
                <div style={{ padding: '6px 2px' }}>
                  <p style={{ fontSize: '0.8rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {album.title}
                  </p>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {album.artist_name}
                  </p>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
