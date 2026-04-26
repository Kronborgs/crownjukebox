import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { libraryApi, Album, Track, queueApi } from '@/api/client'
import { CoverArt } from '@/components/CoverArt'
import { Plus, ChevronLeft, ChevronRight, Clock } from 'lucide-react'

const LETTERS = ['Alle', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'Æ', 'Ø', 'Å']
const PAGE_SIZE = 24

function formatTime(secs: number) {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function AlbumBrowser() {
  const qc = useQueryClient()
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null)
  const [addedTrackId, setAddedTrackId] = useState<string | null>(null)
  const [letterFilter, setLetterFilter] = useState('Alle')
  const [page, setPage] = useState(1)

  const { data: albums = [], isLoading } = useQuery({
    queryKey: ['albums'],
    queryFn: () => libraryApi.albums(undefined, 1, 500),
    staleTime: 60_000,
  })

  const { data: tracks = [] } = useQuery({
    queryKey: ['album-tracks', selectedAlbum?.id],
    queryFn: () => libraryApi.albumTracks(selectedAlbum?.id ?? ''),
    enabled: !!selectedAlbum?.id,
  })

  useEffect(() => {
    setPage(1)
  }, [letterFilter])

  const filteredAlbums = (albums as Album[]).filter((album) => {
    if (letterFilter === 'Alle') return true
    const label = (album.artist_name || album.title || '').trim().toUpperCase()
    return label.startsWith(letterFilter)
  })

  const totalPages = Math.max(1, Math.ceil(filteredAlbums.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const visibleAlbums = filteredAlbums.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  async function addToQueue(track: Track) {
    await queueApi.add(track.id)
    setAddedTrackId(track.id)
    setTimeout(() => setAddedTrackId(null), 1200)
    qc.invalidateQueries({ queryKey: ['queue'] })
  }

  if (selectedAlbum) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
            {selectedAlbum.year && <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>{selectedAlbum.year}</p>}
          </div>
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          <AnimatePresence>
            {(tracks as Track[]).map((track, index) => (
              <motion.div
                key={track.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03 }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px 16px',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                }}
                whileHover={{ backgroundColor: 'rgba(191,0,255,0.06)' }}
              >
                <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem', width: '24px', textAlign: 'right', flexShrink: 0 }}>
                  {track.track_number || index + 1}
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

  return (
    <div style={{ overflowY: 'auto', flex: 1, padding: '12px' }}>
      {isLoading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px' }}>
          {Array.from({ length: 12 }).map((_, index) => (
            <div key={index} className="skeleton" style={{ aspectRatio: '1', borderRadius: 'var(--radius-md)' }} />
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            {LETTERS.map((letter) => (
              <button
                key={letter}
                className={letterFilter === letter ? 'btn btn-primary' : 'btn btn-ghost'}
                style={{ minWidth: letter === 'Alle' ? '64px' : '38px', padding: '8px 10px', fontSize: '0.8rem' }}
                onClick={() => setLetterFilter(letter)}
              >
                {letter}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', color: 'var(--text-secondary)', fontSize: '0.85rem', flexWrap: 'wrap' }}>
            <span>Viser {visibleAlbums.length} album · filter: {letterFilter}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button className="btn btn-ghost btn-icon" style={{ padding: '8px' }} onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={safePage === 1}>
                <ChevronLeft size={16} />
              </button>
              <span>Side {safePage} / {totalPages}</span>
              <button className="btn btn-ghost btn-icon" style={{ padding: '8px' }} onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={safePage === totalPages}>
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px' }}>
            <AnimatePresence>
              {visibleAlbums.map((album, index) => (
                <motion.div
                  key={album.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: Math.min(index * 0.02, 0.4) }}
                  whileHover={{ scale: 1.04, zIndex: 1 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => album.id && setSelectedAlbum(album)}
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
        </div>
      )}
    </div>
  )
}
